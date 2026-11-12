#!/usr/bin/env python3
"""recover_via_timeline —— TweetDetail 限流(429)时的兜底抓取。

背景：
  `review --replies` 走 TweetDetail 端点，短时间内批量抓会触发 Twitter 会话配额
  （HTTP 429，冷却 15~30 分钟）。Timeline 端点(`opencli twitter tweets <user>`)
  不占 TweetDetail 配额，可以绕开限流继续抓。

原理：
  作者把提示词放在自己帖子的自回复里 → 那些自回复也出现在作者的公开时间线上。
  所以：拉作者时间线 → 按目标 tweet id 找到那条主帖 → 取时间线上紧随其后、
  属于同一作者、且正文 >200 字的那条 = 提示词自回复。

用法：
  python3 tools/recover_via_timeline.py --ids <tid,tid,...> [--timeline-limit 200]
  python3 tools/recover_via_timeline.py --ids-file /tmp/retry_ids.txt

输出：
  把抓到的结果写成 review --replies 同格式的 <out>/<tid>.json，
  之后直接 `python3 tools/prompts.py recover --replies-out <out>` 即可落地。

只读网络 + 只写 /tmp，不改仓库任何内容。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DRAFTS = ROOT / "content/_drafts/prompts"

# 提示词自回复的特征：正文长 + 含分镜/参数特征
PROMPTISH = __import__("re").compile(
    r"(\[?shot\s*\d|镜头\s*\d|\d+\s*[-–]\s*\d+\s*(秒|s\b|sec)|<image\d|"
    r"prompt\s*[:：]|提示词| cinematography | camera | aspect ratio | "
    r"durée|gesamtlänge|descripción|prompt de|duration[:：]|scene\s*\d|"
    r"\d+[-–]\d+\s*秒|分镜|运镜|景别)",
    __import__("re").I,
)


def parse_time(s: str) -> datetime:
    """X 的 created_at 形如 'Sat Sep 26 06:34:37 +0000 2026'。"""
    for fmt in ("%a %b %d %H:%M:%S %z %Y", "%a %b %d %H:%M:%S %Y"):
        try:
            return datetime.strptime(s, fmt)
        except Exception:  # noqa: BLE001
            continue
    return datetime.min


HANDLE = __import__("re").compile(r"^[A-Za-z0-9_]{1,15}$")


def build_author_handle_map() -> dict:
    """草稿 author（可能是显示名）→ X handle 的映射。

    草稿的 author 字段是采集期写的"显示名"（'Zephyra Leigh' / 'Pierrick Chevallier | IA'），
    有时也是 handle（'iamrealsnow'）。显示名不能直接喂给 `opencli twitter tweets`
    （会被拒：rc=2 ARGUMENT，必须是合法 handle）。

    映射来源：已抓到的 thread 数据里 data[0]['author'] 才是真正的 handle，
    而同一个显示名往往对应多条草稿 → 用同显示名的其他条目交叉反查。
    """
    m = {}
    for p in DRAFTS.glob("*/*.json"):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        name = (d.get("author") or "").strip()
        tid = p.name.split("-")[0]
        src = Path("/tmp/thread_replies") / f"{tid}.json"
        if not name or not src.exists():
            continue
        try:
            data = json.loads(src.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        if not data:
            continue
        h = data[0].get("author")
        if h and HANDLE.match(h):
            m.setdefault(name, h)
    return m


def resolve_handle(tid: str, author: str, out: Path, author_map: dict | None = None) -> str | None:
    """拿到作者的 X handle。

    草稿的 author 字段有时是显示名（'@Pierrick Chevallier | IA'）而不是 handle，
    直接喂给 `opencli twitter tweets` 会被拒（rc=2 ARGUMENT）。
    这里按可靠性依次尝试：
      1. author 字段本身就是合法 handle → 直接用
      2. source_url 里带 handle（https://x.com/<handle>/status/...）→ 从 URL 取
      3. 已抓到的 thread 数据里 data[0]['author'] → 那是 handle
    """
    if author and HANDLE.match(author.lstrip("@")):
        return author.lstrip("@")

    # 显示名 → handle 的交叉反查
    if author_map:
        h = author_map.get(author.strip())
        if h:
            return h

    p = draft_path(tid)
    if p:
        d = json.loads(p.read_text(encoding="utf-8"))
        url = d.get("source_url") or ""
        # 注意：source_url 常是 https://x.com/i/status/<id>，i 不是 handle → 必须排除
        m = __import__("re").search(r"x\.com/([A-Za-z0-9_]{1,15})/status/", url)
        if m and m.group(1).lower() != "i":
            return m.group(1)

    src = out / f"{tid}.json"
    if src.exists():
        try:
            data = json.loads(src.read_text(encoding="utf-8"))
            if data:
                h = data[0].get("author")
                if h and HANDLE.match(h):
                    return h
        except Exception:  # noqa: BLE001
            pass
    return None


def draft_path(tid: str) -> Path | None:
    for p in DRAFTS.glob("*/*.json"):
        if p.name.startswith(tid + "-"):
            return p
    return None


def run_timeline(username: str, limit: int, session: str, timeout: int) -> list:
    cmd = ["opencli", "twitter", "tweets", username, "--site-session", session,
           "--limit", str(limit), "-f", "json"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        print(f"  TIMEOUT @{username} limit={limit}", flush=True)
        return []
    if proc.returncode != 0:
        print(f"  FAIL @{username} rc={proc.returncode} {proc.stderr.strip()[:140]}", flush=True)
        return []
    out = proc.stdout.strip()
    try:
        obj = json.loads(out)
    except Exception as exc:  # noqa: BLE001
        print(f"  FAIL @{username} JSON 解析 {exc}", flush=True)
        return []
    data = obj.get("data") if isinstance(obj, dict) else obj
    return data if isinstance(data, list) else []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", default="")
    ap.add_argument("--ids-file", default="")
    ap.add_argument("--out", default="/tmp/thread_replies")
    ap.add_argument("--timeline-limit", type=int, default=400)
    ap.add_argument("--site-session", default="persistent")
    ap.add_argument("--timeout", type=int, default=180)
    ap.add_argument("--sleep", type=float, default=3.0)
    args = ap.parse_args()

    ids = [x.strip() for x in args.ids.split(",") if x.strip()]
    if args.ids_file:
        ids += [x.strip() for x in Path(args.ids_file).read_text(encoding="utf-8").split(",") if x.strip()]
    ids = list(dict.fromkeys(ids))
    if not ids:
        print("!! 需要 --ids 或 --ids-file", file=sys.stderr)
        return 1

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    # 1) 读草稿拿作者 → 解析成 handle
    author_map = build_author_handle_map()
    targets = {}
    for tid in ids:
        p = draft_path(tid)
        if not p:
            print(f"  -- {tid} 草稿缺失")
            continue
        d = json.loads(p.read_text(encoding="utf-8"))
        handle = resolve_handle(tid, d.get("author") or "", out, author_map)
        if not handle:
            print(f"  -- {tid} 无法确定 handle（author={d.get('author')!r}）")
            continue
        targets[tid] = handle

    # 2) 按作者分组，每个作者只拉一次时间线
    by_author = {}
    for tid, handle in targets.items():
        by_author.setdefault(handle, []).append(tid)

    ok = fail = 0
    for author, tids in by_author.items():
        print(f"\n=== @{author}  目标 {len(tids)} 条", flush=True)
        tl = run_timeline(author, args.timeline_limit, args.site_session, args.timeout)
        if not tl:
            fail += len(tids)
            continue
        # 时间线按 id 排序 → 用"主帖之后、同一作者、正文最长"定位自回复
        tl_sorted = sorted(tl, key=lambda t: parse_time(t.get("created_at", "")))
        for tid in tids:
            root = next((t for t in tl_sorted if t.get("id") == tid), None)
            if root is None:
                print(f"  -- {tid} 时间线里没找到主帖（limit={args.timeline_limit} 可能不够深）")
                fail += 1
                continue
            rt = parse_time(root.get("created_at", ""))
            # 主帖之后 30 分钟内、同作者的回复里，正文最长的那条 = 提示词
            cands = [
                t for t in tl_sorted
                if t.get("author") == author
                and t.get("id") != tid
                and 0 <= (parse_time(t.get("created_at", "")) - rt).total_seconds() <= 1800
            ]
            if not cands:
                print(f"  -- {tid} 时间线窗口内无作者回复")
                fail += 1
                continue
            best = max(cands, key=lambda t: len(t.get("text") or ""))
            text = best.get("text") or ""
            if len(text) <= 200:
                print(f"  -- {tid} 最长作者回复仅 {len(text)} 字，不够")
                fail += 1
                continue
            # 写成 review --replies 同格式：首条=主帖，其余=回复
            payload = [root] + [t for t in tl_sorted if t.get("id") in {c.get("id") for c in cands}]
            (out / f"{tid}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            flag = "含提示词特征" if PROMPTISH.search(text) else "无提示特征"
            print(f"  ✓ {tid} reply={best.get('id')} {len(text)}字 [{flag}]")
            ok += 1
        time.sleep(args.sleep)

    print(f"\n兜底抓取: 成功 {ok} 失败 {fail}  → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
