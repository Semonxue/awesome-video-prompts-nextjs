#!/usr/bin/env python3
"""
Markdown 编辑器后端（新流程：Next.js + D1 + R2）

改造点（vs 老 Hugo 版本）：
1. 草稿 MD 永远在 _drafts/，不搬文件；状态用 front matter 区分
2. 新增 /api/publish — multipart POST 到新站 /api/admin/publish
3. 新增 /api/list-prompt — GET 新站 /api/admin/list-prompt?slug=...
4. 新增 /api/cleanup — 一键清理已发布草稿（二次校验 D1）
5. 文件列表按状态分 tab：待编辑 / 已发布 / 失败
6. 数据 YAML（data/models.yaml, data/tags.yaml）保留兼容，但 tag/model 选择现在只走 front matter 数组
7. 不再与 git 耦合，不做 `git status` 检查
"""

import os
import re
import json
import shutil
import sys
import urllib.request
import urllib.parse
import urllib.error
import uuid
from datetime import datetime, timezone
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from typing import Any, Dict, List, Optional, Tuple

import yaml

# ============================================================
# 路径配置
# ============================================================
PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()

# 草稿内容目录（永远不变，不再区分 draft/published 文件夹）
DRAFT_CONTENT_DIR = PROJECT_ROOT / "content" / "_drafts" / "prompts"
# 草稿素材目录
DRAFT_STATIC_DIR = PROJECT_ROOT / "static" / "_drafts" / "prompts"
# 数据目录（models.yaml / tags.yaml 兼容保留，可选）
DATA_DIR = PROJECT_ROOT / "data"

# 临时上传目录（清理已发布草稿前暂存？）
TEMP_DIR = PROJECT_ROOT / "tools" / "md-editor" / ".tmp"

# 新站 publish 端点（在 .dev.vars 里配：NEW_SITE_PUBLISH_URL / NEW_SITE_LIST_PROMPT_URL / NEW_SITE_ADMIN_SECRET）
def _load_dev_vars() -> Dict[str, str]:
    """简易 .dev.vars 加载（KEY=VALUE 格式，# 开头注释）"""
    out: Dict[str, str] = {}
    p = PROJECT_ROOT / ".dev.vars"
    if not p.exists():
        return out
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out

_DEV_VARS = _load_dev_vars()
NEW_SITE_PUBLISH_URL = _DEV_VARS.get(
    "NEW_SITE_PUBLISH_URL",
    "https://awesome-video-prompts-nextjs.semonxue.workers.dev/api/admin/publish",
)
NEW_SITE_LIST_PROMPT_URL = _DEV_VARS.get(
    "NEW_SITE_LIST_PROMPT_URL",
    "https://awesome-video-prompts-nextjs.semonxue.workers.dev/api/admin/list-prompt",
)
NEW_SITE_ADMIN_SECRET = _DEV_VARS.get("NEW_SITE_ADMIN_SECRET", "")


# ============================================================
# 状态判定（解析 front matter）
# ============================================================
def parse_publish_status(content: str) -> str:
    """
    返回草稿状态：
      - "unpublished" — 还没发过（published: false 或没字段）
      - "published"   — 成功发布过（published: true 且 published_error 为空）
      - "failed"      — 发布失败（published_error 不为空）
    """
    fm = parse_fm(content)
    if not fm:
        return "unpublished"
    published = parse_boolish(fm.get("published", False))
    error = fm.get("published_error")
    if error and str(error).strip() and str(error).lower() not in ("null", "none"):
        return "failed"
    if published:
        return "published"
    return "unpublished"


def parse_boolish(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        v = value.strip().lower()
        if v in {"true", "yes", "on", "1"}:
            return True
        if v in {"false", "no", "off", "0", ""}:
            return False
    return bool(value)


def parse_fm(content: str) -> Dict[str, Any]:
    """解析 YAML front matter，front matter 起始为 --- 单独一行"""
    if not content.startswith("---"):
        return {}
    parts = content.split("---", 2)
    if len(parts) < 3:
        return {}
    try:
        fm = yaml.safe_load(parts[1]) or {}
        return fm if isinstance(fm, dict) else {}
    except yaml.YAMLError:
        return {}


def get_published_at(fm: Dict[str, Any]) -> Optional[str]:
    v = fm.get("published_at")
    if v is None or v == "" or (isinstance(v, str) and v.lower() in ("null", "none")):
        return None
    return str(v)


def get_published_slug(fm: Dict[str, Any]) -> Optional[str]:
    v = fm.get("published_slug")
    if v is None or v == "" or (isinstance(v, str) and v.lower() in ("null", "none")):
        return None
    return str(v)


def get_published_error(fm: Dict[str, Any]) -> Optional[str]:
    v = fm.get("published_error")
    if v is None or v == "" or (isinstance(v, str) and v.lower() in ("null", "none")):
        return None
    return str(v)


# ============================================================
# 路径解析
# ============================================================
def get_prompt_path_info(file_path: Path) -> Optional[Tuple[str, str]]:
    """
    从 _drafts 草稿路径提取 (yearMonth, slug)
    例：content/_drafts/prompts/2026-06/foo-bar.md
        → ("2026-06", "foo-bar")
    """
    try:
        rel = file_path.relative_to(DRAFT_CONTENT_DIR)
    except ValueError:
        return None
    parts = rel.parts
    if len(parts) != 2 or not parts[0] or not parts[1].endswith(".md"):
        return None
    year_month = parts[0]
    slug = parts[1][:-3]  # 去 .md
    return year_month, slug


def get_asset_dir(year_month: str, slug: str) -> Path:
    return DRAFT_STATIC_DIR / year_month / slug


# ============================================================
# 写 front matter（保留原 key 顺序，注入状态字段）
# ============================================================
def build_markdown_content(fm: Dict[str, Any], body: str) -> str:
    """序列化 front matter + body 回到 markdown 文本"""

    class CustomDumper(yaml.SafeDumper):
        def represent_scalar(self, tag, value, style=None):
            if isinstance(value, str) and "\n" in value.strip() and not value.startswith("|") and not value.startswith(">"):
                style = "|"
            return super().represent_scalar(tag, value, style)

    yaml_str = yaml.dump(
        fm,
        Dumper=CustomDumper,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
    )
    return f"---\n{yaml_str}---\n\n{body}"


def update_publish_status_in_fm(
    fm: Dict[str, Any],
    *,
    success: bool,
    published_at: Optional[str] = None,
    published_slug: Optional[str] = None,
    error: Optional[str] = None,
) -> Dict[str, Any]:
    """返回更新后的 fm 副本（不修改入参）"""
    out = dict(fm)
    if success:
        out["published"] = True
        out["published_at"] = published_at or datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
        if published_slug:
            out["published_slug"] = published_slug
        out["published_error"] = None
    else:
        out["published"] = False
        out["published_at"] = None
        out["published_error"] = (error or "Unknown error")[:500]  # 截断防爆
    # draft 字段兼容保留：草稿永远是 true，标记给人看
    out["draft"] = True
    return out


# ============================================================
# HTTP 客户端（调新站 API）
# ============================================================
def http_multipart_post(url: str, fields: Dict[str, str], files: Dict[str, Tuple[str, bytes, str]], secret: str) -> Tuple[int, str]:
    """
    用 stdlib urllib 发 multipart POST。
    files: {field_name: (filename, content_bytes, content_type)}
    返回 (status_code, body)
    """
    boundary = f"----md-editor-{uuid.uuid4().hex}"
    body_chunks: List[bytes] = []

    for k, v in fields.items():
        body_chunks.append(f"--{boundary}\r\n".encode())
        body_chunks.append(
            f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode()
        )
        body_chunks.append(v.encode("utf-8"))
        body_chunks.append(b"\r\n")

    for k, (filename, content, content_type) in files.items():
        body_chunks.append(f"--{boundary}\r\n".encode())
        body_chunks.append(
            f'Content-Disposition: form-data; name="{k}"; filename="{filename}"\r\n'.encode()
        )
        body_chunks.append(f"Content-Type: {content_type}\r\n\r\n".encode())
        body_chunks.append(content)
        body_chunks.append(b"\r\n")

    body_chunks.append(f"--{boundary}--\r\n".encode())
    body = b"".join(body_chunks)

    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Authorization": f"Bearer {secret}",
            # CF Bot Detection 会拦截 Python-urllib，改成真实浏览器 UA
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as e:
        return 0, f"Network error: {e.reason}"
    except Exception as e:
        return 0, f"Unknown error: {e}"


def http_get_json(url: str, secret: str) -> Tuple[int, Any]:
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {secret}",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, {"error": e.reason}
    except urllib.error.URLError as e:
        return 0, {"error": f"Network error: {e.reason}"}
    except Exception as e:
        return 0, {"error": f"Unknown error: {e}"}


def http_post_json(url: str, payload: Any, secret: str) -> Tuple[int, Any]:
    """发 POST JSON 请求，返回 (status_code, parsed_body)"""
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {secret}",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, {"raw": e.read().decode("utf-8", errors="replace")}
    except urllib.error.URLError as e:
        return 0, {"error": f"Network error: {e.reason}"}
    except Exception as e:
        return 0, {"error": f"Unknown error: {e}"}


# ============================================================
# HTTP 服务
# ============================================================
class EditorHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PROJECT_ROOT), **kwargs)

    # 抑制默认 access log（太多噪音）
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path.startswith("/media/"):
            self.handle_media(path[7:])
        elif path == "/api/files":
            self.handle_list_files()
        elif path == "/api/metadata":
            self.handle_metadata(query.get("type", [""])[0])
        elif path == "/api/file":
            self.handle_read_file(query.get("path", [""])[0])
        elif path == "/api/online-prompt":
            self.handle_online_prompt(query.get("slug", [""])[0])
        elif path == "/api/health":
            self.handle_health()
        elif path.startswith("/templates/"):
            super().do_GET()
        else:
            self.serve_index()

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/file":
            self.handle_save_file()
        else:
            self.send_error(404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/publish":
            self.handle_publish()
        elif path == "/api/cleanup":
            self.handle_cleanup()
        elif path == "/api/load-online":
            self.handle_load_online()
        elif path == "/api/delete-online":
            self.handle_delete_online()
        else:
            self.send_error(404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/file":
            self.handle_delete_file()
        else:
            self.send_error(404)

    # -------------------- 通用响应 --------------------
    def send_json(self, data, status: int = 200):
        body = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_index(self):
        p = PROJECT_ROOT / "tools" / "md-editor" / "templates" / "index.html"
        if not p.exists():
            self.send_error(500, "index.html not found")
            return
        body = p.read_bytes()
        self.send_response(200)
        self.send_header("Content-type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_health(self):
        self.send_json({
            "ok": True,
            "project_root": str(PROJECT_ROOT),
            "publish_url": NEW_SITE_PUBLISH_URL,
            "has_secret": bool(NEW_SITE_ADMIN_SECRET),
        })

    # -------------------- 媒体代理（与原版一致） --------------------
    def handle_media(self, media_path: str):
        mime_map = {
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
            ".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4",
            ".webm": "video/webm",
        }
        relative = Path(media_path.lstrip("/"))
        for root in (DRAFT_STATIC_DIR,):
            # fm.image 形如 /prompts/2026-06/xxx/cover.jpg
            # 实际文件在 DRAFT_STATIC_DIR/2026-06/xxx/cover.jpg
            # 所以要从 relative 中剥掉 'prompts/' 前缀
            parts = relative.parts
            if parts and parts[0] == "prompts":
                relative = Path(*parts[1:]) if len(parts) > 1 else Path()
            candidate = root / relative
            if candidate.exists() and candidate.is_file():
                ext = candidate.suffix.lower()
                self.send_response(200)
                self.send_header("Content-type", mime_map.get(ext, "application/octet-stream"))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Length", str(candidate.stat().st_size))
                self.end_headers()
                with open(candidate, "rb") as f:
                    self.wfile.write(f.read())
                return
        self.send_error(404, "media not found")

    # -------------------- 文件列表（按状态分类） --------------------
    def handle_list_files(self):
        files_by_status: Dict[str, List[Dict[str, Any]]] = {
            "unpublished": [],
            "published": [],
            "failed": [],
        }
        if DRAFT_CONTENT_DIR.exists():
            for mf in sorted(DRAFT_CONTENT_DIR.rglob("*.md")):
                try:
                    content = mf.read_text(encoding="utf-8")
                except Exception:
                    continue
                status = parse_publish_status(content)
                fm = parse_fm(content)
                stat = mf.stat()
                files_by_status[status].append({
                    "path": str(mf.relative_to(PROJECT_ROOT)),
                    "name": mf.name,
                    "date": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
                    "status": status,
                    "published_at": get_published_at(fm),
                    "published_slug": get_published_slug(fm),
                    "published_error": get_published_error(fm),
                    "title": fm.get("title", ""),
                })
        # 各自按时间倒序
        for k in files_by_status:
            files_by_status[k].sort(key=lambda x: x["date"], reverse=True)

        self.send_json({
            "files": files_by_status,
            "counts": {k: len(v) for k, v in files_by_status.items()},
            "total": sum(len(v) for v in files_by_status.values()),
        })

    # -------------------- 读取单个文件 --------------------
    def handle_read_file(self, file_path: str):
        if not file_path:
            self.send_error(400, "missing path")
            return
        full = (PROJECT_ROOT / file_path.lstrip("/")).resolve()
        # 安全检查：必须在 DRAFT_CONTENT_DIR 下
        try:
            full.relative_to(DRAFT_CONTENT_DIR)
        except ValueError:
            self.send_error(403, "file not in drafts dir")
            return
        if not full.exists():
            self.send_error(404, "file not found")
            return
        try:
            content = full.read_text(encoding="utf-8")
            fm = parse_fm(content)
            body = content
            if content.startswith("---"):
                parts = content.split("---", 2)
                if len(parts) >= 3:
                    body = parts[2].lstrip()

            # tags/models 兼容
            if "tags" in fm and isinstance(fm["tags"], str):
                fm["tags"] = [t.strip() for t in fm["tags"].split(",")]
            if "models" in fm and isinstance(fm["models"], str):
                fm["models"] = [m.strip() for m in fm["models"].split(",")]

            self.send_json({
                "path": file_path,
                "frontmatter": fm,
                "raw": content,
                "body": body,
                "status": parse_publish_status(content),
            })
        except Exception as e:
            self.send_error(500, str(e))

    # -------------------- 保存文件（不搬文件夹，留在 _drafts/） --------------------
    def handle_save_file(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            rel_path = body.get("path", "").lstrip("/")
            if not rel_path:
                self.send_error(400, "missing path")
                return
            full = (PROJECT_ROOT / rel_path).resolve()
            try:
                full.relative_to(DRAFT_CONTENT_DIR)
            except ValueError:
                self.send_error(403, "file not in drafts dir")
                return

            if "frontmatter" in body and "body" in body:
                fm = body["frontmatter"]
                content = build_markdown_content(fm, body["body"])
            elif "content" in body:
                content = body["content"]
            else:
                self.send_error(400, "missing frontmatter+body or content")
                return

            full.parent.mkdir(parents=True, exist_ok=True)
            # 原子写：先写 tmp 再 rename
            tmp = full.with_suffix(full.suffix + f".tmp.{uuid.uuid4().hex[:8]}")
            tmp.write_text(content, encoding="utf-8")
            tmp.replace(full)

            self.send_json({
                "success": True,
                "path": str(full.relative_to(PROJECT_ROOT)),
                "status": parse_publish_status(content),
            })
        except Exception as e:
            self.send_error(500, str(e))

    # -------------------- 删除文件（清理用） --------------------
    def handle_delete_file(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except Exception:
            body = {}
        rel_path = body.get("path", "").lstrip("/")
        if not rel_path:
            self.send_error(400, "missing path")
            return
        full = (PROJECT_ROOT / rel_path).resolve()
        try:
            full.relative_to(DRAFT_CONTENT_DIR)
        except ValueError:
            self.send_error(403, "file not in drafts dir")
            return
        if not full.exists():
            self.send_error(404, "file not found")
            return
        try:
            info = get_prompt_path_info(full)
            full.unlink()
            # 顺手删素材
            deleted_assets = False
            if info:
                ym, slug = info
                ad = get_asset_dir(ym, slug)
                if ad.exists():
                    shutil.rmtree(ad)
                    deleted_assets = True
            self.send_json({
                "success": True,
                "deleted": str(full.relative_to(PROJECT_ROOT)),
                "deleted_assets": deleted_assets,
            })
        except Exception as e:
            self.send_error(500, str(e))

    # -------------------- 发布 --------------------
    def handle_publish(self):
        if not NEW_SITE_ADMIN_SECRET:
            self.send_json({"success": False, "error": "NEW_SITE_ADMIN_SECRET not configured in .dev.vars"}, 500)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception as e:
            self.send_json({"success": False, "error": f"bad request: {e}"}, 400)
            return

        rel_path = body.get("path", "").lstrip("/")
        if not rel_path:
            self.send_json({"success": False, "error": "missing path"}, 400)
            return
        full = (PROJECT_ROOT / rel_path).resolve()
        try:
            full.relative_to(DRAFT_CONTENT_DIR)
        except ValueError:
            self.send_json({"success": False, "error": "file not in drafts dir"}, 403)
            return
        if not full.exists():
            self.send_json({"success": False, "error": "file not found"}, 404)
            return

        info = get_prompt_path_info(full)
        if not info:
            self.send_json({"success": False, "error": "invalid path layout"}, 400)
            return
        year_month, slug = info

        # 读 front matter
        try:
            content = full.read_text(encoding="utf-8")
            fm = parse_fm(content)
        except Exception as e:
            self.send_json({"success": False, "error": f"read failed: {e}"}, 500)
            return

        # 构造 multipart 字段（处理 date 对象）
        def to_jsonable(v):
            if v is None or isinstance(v, (str, int, float, bool)):
                return v
            if isinstance(v, (datetime,)):
                return v.isoformat()
            try:
                # yaml 解析的 date 对象（没有时间）
                import datetime as _dt
                if isinstance(v, _dt.date):
                    return v.isoformat()
            except Exception:
                pass
            if isinstance(v, list):
                return [to_jsonable(x) for x in v]
            return str(v)

        fm_payload = {
            "title": to_jsonable(fm.get("title")),
            "description": to_jsonable(fm.get("description")),
            "author": to_jsonable(fm.get("author")),
            "source_url": to_jsonable(fm.get("source_url")),
            "post_date": to_jsonable(fm.get("post_date") or fm.get("date")),
            "tags": to_jsonable(fm.get("tags")) if isinstance(fm.get("tags"), list) else None,
            "models": to_jsonable(fm.get("models")) if isinstance(fm.get("models"), list) else None,
        }
        # 清掉 None 字段
        fm_payload = {k: v for k, v in fm_payload.items() if v is not None}

        fields = {
            "slug": slug,
            "frontmatter": json.dumps(fm_payload, ensure_ascii=False),
        }

        # 找素材
        files: Dict[str, Tuple[str, bytes, str]] = {}
        asset_dir = get_asset_dir(year_month, slug)
        cover_path = asset_dir / "cover.jpg"
        video_path = asset_dir / "video.mp4"
        if cover_path.exists():
            files["cover"] = ("cover.jpg", cover_path.read_bytes(), "image/jpeg")
        if video_path.exists():
            files["video"] = ("video.mp4", video_path.read_bytes(), "video/mp4")

        # 调新站 API
        status, resp_text = http_multipart_post(
            NEW_SITE_PUBLISH_URL, fields, files, NEW_SITE_ADMIN_SECRET
        )
        try:
            resp = json.loads(resp_text)
        except Exception:
            resp = {"raw": resp_text}

        success = status == 200 and resp.get("ok") is True
        if success:
            # 更新 front matter 状态字段
            new_fm = update_publish_status_in_fm(
                fm,
                success=True,
                published_at=datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
                published_slug=resp.get("slug", slug),
            )
            # 取 body
            parts = content.split("---", 2)
            body_text = parts[2].lstrip() if len(parts) >= 3 else ""
            new_content = build_markdown_content(new_fm, body_text)
            try:
                full.write_text(new_content, encoding="utf-8")
            except Exception as e:
                # 线上成功但本地写失败：返回成功但提示
                return self.send_json({
                    "success": True,
                    "warning": f"online updated but local status write failed: {e}",
                    "remote_response": resp,
                })
            return self.send_json({
                "success": True,
                "operation": resp.get("operation"),
                "slug": resp.get("slug"),
                "uploaded": resp.get("uploaded"),
                "revalidated": resp.get("revalidated"),
            })
        else:
            # 失败：记录错误到 front matter
            err_msg = resp.get("error") or f"HTTP {status}"
            new_fm = update_publish_status_in_fm(fm, success=False, error=err_msg)
            parts = content.split("---", 2)
            body_text = parts[2].lstrip() if len(parts) >= 3 else ""
            new_content = build_markdown_content(new_fm, body_text)
            try:
                full.write_text(new_content, encoding="utf-8")
            except Exception:
                pass
            return self.send_json({
                "success": False,
                "error": err_msg,
                "status": status,
                "remote_response": resp,
            }, 200)  # 200 让前端处理（不是 transport 错误）

    # -------------------- 清理已发布草稿 --------------------
    def handle_cleanup(self):
        """
        清理 published: true && published_error: null 的草稿
        二次校验：调新站 list-prompt 确认线上真的存在
        """
        if not DRAFT_CONTENT_DIR.exists():
            self.send_json({"ok": True, "deleted": [], "skipped": [], "total": 0})
            return

        candidates: List[Path] = []
        for mf in DRAFT_CONTENT_DIR.rglob("*.md"):
            try:
                content = mf.read_text(encoding="utf-8")
            except Exception:
                continue
            if parse_publish_status(content) == "published":
                candidates.append(mf)

        deleted: List[Dict[str, str]] = []
        skipped: List[Dict[str, str]] = []
        errors: List[Dict[str, str]] = []

        for mf in candidates:
            try:
                content = mf.read_text(encoding="utf-8")
                fm = parse_fm(content)
                remote_slug = get_published_slug(fm)
                if not remote_slug:
                    skipped.append({"path": str(mf.relative_to(PROJECT_ROOT)), "reason": "no published_slug"})
                    continue
                # 二次校验：调 list-prompt 确认线上有
                if not NEW_SITE_ADMIN_SECRET:
                    skipped.append({"path": str(mf.relative_to(PROJECT_ROOT)), "reason": "no admin secret"})
                    continue
                url = f"{NEW_SITE_LIST_PROMPT_URL}?slug={urllib.parse.quote(remote_slug)}"
                code, resp = http_get_json(url, NEW_SITE_ADMIN_SECRET)
                if code != 200 or not (isinstance(resp, dict) and resp.get("ok")):
                    skipped.append({
                        "path": str(mf.relative_to(PROJECT_ROOT)),
                        "reason": f"remote check failed: HTTP {code}",
                    })
                    continue
                # 校验通过：删
                info = get_prompt_path_info(mf)
                mf.unlink()
                deleted_assets = False
                if info:
                    ad = get_asset_dir(info[0], info[1])
                    if ad.exists():
                        shutil.rmtree(ad)
                        deleted_assets = True
                deleted.append({
                    "path": str(mf.relative_to(PROJECT_ROOT)),
                    "remote_slug": remote_slug,
                    "deleted_assets": deleted_assets,
                })
            except Exception as e:
                errors.append({"path": str(mf.relative_to(PROJECT_ROOT)), "error": str(e)})

        self.send_json({
            "ok": True,
            "deleted": deleted,
            "skipped": skipped,
            "errors": errors,
            "total": len(candidates),
        })

    # -------------------- 从线上加载 --------------------
    def handle_load_online(self):
        """
        body: { slug: "..." }
        从线上 D1 拉一条 → 写到 _drafts/prompts/<post_date YYYY-MM>/<slug>.md
        注意：素材 url 走 R2 公网 URL，md-editor 媒体代理能直接拉
        """
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception as e:
            self.send_json({"success": False, "error": f"bad request: {e}"}, 400)
            return

        slug = (body.get("slug") or "").strip()
        if not slug:
            self.send_json({"success": False, "error": "missing slug"}, 400)
            return
        if not NEW_SITE_ADMIN_SECRET:
            self.send_json({"success": False, "error": "no admin secret"}, 500)
            return

        url = f"{NEW_SITE_LIST_PROMPT_URL}?slug={urllib.parse.quote(slug)}"
        code, resp = http_get_json(url, NEW_SITE_ADMIN_SECRET)
        if code != 200 or not (isinstance(resp, dict) and resp.get("ok")):
            return self.send_json({
                "success": False,
                "error": resp.get("error") if isinstance(resp, dict) else f"HTTP {code}",
            }, 200)

        prompt = resp.get("prompt", {})
        # 写 _drafts/
        post_date = prompt.get("prompt_date") or ""
        ym_match = re.match(r"^(\d{4}-\d{2})", str(post_date))
        year_month = ym_match.group(1) if ym_match else datetime.now().strftime("%Y-%m")

        # 已有？覆盖
        target_dir = DRAFT_CONTENT_DIR / year_month
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / f"{slug}.md"
        if target_path.exists():
            return self.send_json({
                "success": False,
                "error": f"draft already exists: {target_path.relative_to(PROJECT_ROOT)}",
            }, 200)

        fm = {
            "title": prompt.get("title", ""),
            "description": prompt.get("description", ""),
            "models": prompt.get("models", []),
            "tags": prompt.get("tags", []),
            "author": prompt.get("author"),
            "source_url": prompt.get("source_url"),
            "post_date": post_date,
            "image": prompt.get("cover_url"),
            "video": prompt.get("video_url"),
            "draft": True,
            "published": True,
            "published_at": prompt.get("updated_at"),
            "published_slug": slug,
            "published_error": None,
        }
        # 去掉空值
        fm = {k: v for k, v in fm.items() if v not in (None, "", [])}
        body_text = ""  # 编辑时填

        content = build_markdown_content(fm, body_text)
        target_path.write_text(content, encoding="utf-8")

        # 媒体代理能直接走 R2 公网 URL（/media/prompts/...），不用本地缓存
        self.send_json({
            "success": True,
            "path": str(target_path.relative_to(PROJECT_ROOT)),
            "slug": slug,
        })

    # -------------------- 删除线上 prompt --------------------
    def handle_delete_online(self):
        if not NEW_SITE_ADMIN_SECRET:
            self.send_json({"ok": False, "error": "NEW_SITE_ADMIN_SECRET not configured"}, 500)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception as e:
            self.send_json({"ok": False, "error": f"bad request: {e}"}, 400)
            return
        slug = (body.get("slug") or "").strip()
        if not slug:
            self.send_json({"ok": False, "error": "slug is required"}, 400)
            return

        url = f"{NEW_SITE_PUBLISH_URL.rsplit('/', 1)[0]}/delete"
        status, resp = http_post_json(url, {"slug": slug}, NEW_SITE_ADMIN_SECRET)

        if status == 200 and isinstance(resp, dict) and resp.get("ok") is True:
            self.send_json({
                "ok": True,
                "slug": slug,
                "deleted": resp.get("deleted", {}),
                "revalidated": resp.get("revalidated", []),
            })
        elif status == 404 or (isinstance(resp, dict) and "Not found" in str(resp.get("error", ""))):
            self.send_json({"ok": False, "error": f"线上不存在「{slug}」"}, 404)
        elif status == 401:
            self.send_json({"ok": False, "error": "Unauthorized"}, 401)
        else:
            err = (isinstance(resp, dict) and resp.get("error")) or (isinstance(resp, str) and resp) or f"HTTP {status}"
            self.send_json({"ok": False, "error": err}, status)

    # -------------------- 单独查线上（前端 preview 用） --------------------
    def handle_online_prompt(self, slug: str):
        if not slug:
            self.send_error(400, "missing slug")
            return
        if not NEW_SITE_ADMIN_SECRET:
            self.send_json({"ok": False, "error": "no admin secret"}, 500)
            return
        url = f"{NEW_SITE_LIST_PROMPT_URL}?slug={urllib.parse.quote(slug)}"
        code, resp = http_get_json(url, NEW_SITE_ADMIN_SECRET)
        self.send_json(resp if isinstance(resp, dict) else {"ok": False, "error": "bad response"}, 200 if code == 200 else 502)

    # -------------------- metadata 兼容（models 字典） --------------------
    def handle_metadata(self, mtype: str):
        if mtype == "models":
            self.send_json(self.parse_models(DATA_DIR / "models.yaml"))
        elif mtype == "tags":
            self.send_json(self.parse_tags(DATA_DIR / "tags.yaml"))
        else:
            self.send_json({})

    def parse_models(self, yaml_path: Path) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        if not yaml_path.exists():
            return out
        try:
            data = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
            for slug, meta in data.items():
                if isinstance(meta, dict):
                    out[slug] = {"name": meta.get("name", slug)}
                else:
                    out[slug] = {"name": slug}
        except Exception:
            pass
        return out

    def parse_tags(self, yaml_path: Path) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        if not yaml_path.exists():
            return out
        try:
            data = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
            for slug, meta in data.items():
                if isinstance(meta, dict):
                    out[slug] = {"en": meta.get("en", slug)}
                else:
                    out[slug] = {"en": slug}
        except Exception:
            pass
        return out


def _verify_new_site() -> bool:
    """启动时测一次 list-prompt，提前暴露 secret 未配/URL 写错等问题"""
    if not NEW_SITE_ADMIN_SECRET:
        print("⚠ ADMIN_SECRET 未配置（.dev.vars 里 NEW_SITE_ADMIN_SECRET 为空）")
        return False
    url = f"{NEW_SITE_LIST_PROMPT_URL}?slug=__startup_test__"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {NEW_SITE_ADMIN_SECRET}",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode(errors="replace")
            if resp.status == 200:
                print("✅ 新站连接正常 + Secret 验证通过")
                return True
            else:
                print(f"⚠ 新站返回意外状态 {resp.status}: {body[:200]}")
                return False
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:200]
        if e.code == 401:
            print("❌ Secret 验证失败（401 Unauthorized）")
            print(f"   请检查 Cloudflare Dashboard Workers → Settings → Variables 里 admin-secret 是否已设")
            print(f"   提示：Dashboard 里的 secret 名字要对应代码里的 binding（现在是 admin-secret）")
            return False
        elif e.code == 403:
            print("⚠ 新站返回 403（可能被 Cloudflare 安全策略拦截，或网络 proxy 问题）")
            print(f"   详情: {body}")
            print("   md-editor 将正常启动，请在浏览器里手动测一次 publish 确认是否正常")
            return False
        elif e.code == 404:
            # 路由存在 + auth 通过，只是 slug 不存在（正常）
            print("✅ 新站连接正常 + Secret 验证通过（slug 不存在符合预期）")
            return True
        else:
            print(f"⚠ 新站 HTTP {e.code}: {e.reason}")
            print(f"   body: {body}")
            return False
    except urllib.error.URLError as e:
        print(f"❌ 无法连接新站: {e.reason}")
        return False
    except Exception as e:
        print(f"⚠ 验证过程异常: {e}")
        return False


def run_server(port: int = 3000):
    DRAFT_CONTENT_DIR.mkdir(parents=True, exist_ok=True)
    DRAFT_STATIC_DIR.mkdir(parents=True, exist_ok=True)
    print(f"🚀 Markdown 编辑器（新流程）启动 http://localhost:{port}")
    print(f"   项目根: {PROJECT_ROOT}")
    print(f"   草稿目录: {DRAFT_CONTENT_DIR}")
    print(f"   Publish URL: {NEW_SITE_PUBLISH_URL}")
    print(f"   Admin Secret: {'✓ configured' if NEW_SITE_ADMIN_SECRET else '✗ MISSING (set NEW_SITE_ADMIN_SECRET in .dev.vars)'}")
    _verify_new_site()
    server = HTTPServer(("localhost", port), EditorHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 已停止")
        server.shutdown()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    run_server(port)
