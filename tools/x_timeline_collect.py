#!/usr/bin/env python3
"""
x_timeline_collect.py - 从 @semonxue 时间线自适应收录 5-10 条视频提示词

设计原则（容错优先）：
- 每个 opencli 调用 30s 硬超时 + 单步重试 1 次（绝不无限重试，避免触发 X 风控/账号掉线）
- 账号异常（LOGGED_OUT / 连续超时 / 限流）立即退出本次 run，下个 tick 自然恢复
- 单条 download 失败：跳过本条 + 清理 temp 目录，继续下一条
- like 失败：记录但不阻塞本批（已收录的草稿依然有效）
- watchdog: 全程 5min 硬上限（subprocess 外部用 bash 杀）

用法:
    # 主模式：跑一次完整流程
    python3 tools/x_timeline_collect.py run

    # 干跑：只 fetch + dedup + pick，不下载/不写草稿/不 like
    python3 tools/x_timeline_collect.py dryrun

    # 单条处理（复用 run 逻辑）
    python3 tools/x_timeline_collect.py process <tweet_id>

环境变量:
    XTC_TARGET_COUNT - 目标条数（默认自适应 5-10）
    XTC_MAX_COUNT    - 硬上限（默认 10）
    XTC_MIN_COUNT    - 软下限（默认 5）
    XTC_LIKE_AFTER   - 1/0，写完草稿后是否点赞（默认 1）
    XTC_LLM_TITLE    - 1/0，是否走 LLM 生成 title（默认 0，title 走启发式）
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import shutil
import signal
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path("/Users/semonxue/Workplace/Works/ai-dev/awesome-video-prompts-nextjs")
TEMP_DIR = ROOT / "temp"
LOG_DIR = ROOT / "logs" / "x_timeline_cron"
LOG_DIR.mkdir(parents=True, exist_ok=True)

LOG_FILE = LOG_DIR / "cron.log"
STATE_FILE = LOG_DIR / "state.json"  # 失败/跳过的 ID 黑名单，避免下个 tick 立刻再试
# 黑名单保留窗口：失败后 4 小时内不再尝试（避免每 2h 重复撞同一个坏 ID）
STATE_TTL_HOURS = 4

# ---- tunables ----
TARGET_COUNT = int(os.environ.get("XTC_TARGET_COUNT", "0"))  # 0 = 自适应
MAX_COUNT = int(os.environ.get("XTC_MAX_COUNT", "10"))
MIN_COUNT = int(os.environ.get("XTC_MIN_COUNT", "5"))
LIKE_AFTER = os.environ.get("XTC_LIKE_AFTER", "1") == "1"
LLM_TITLE = os.environ.get("XTC_LLM_TITLE", "0") == "1"

# 已知账号（hard-code，避免 like 时切错号）
ACCOUNT_HANDLE = "semonxue"

# ---- 容错配置 ----
OPENCLI_TIMEOUT = 30  # 单次 opencli 调用超时（秒）
OPENCLI_RETRY = 1     # 单步重试 1 次（不无限重试）
DOWNLOAD_TIMEOUT = 600  # 单条 download 超时（秒）
PROCESS_TIMEOUT = 60    # 单条 process（compress+write）超时


# ============================================================
# Utilities
# ============================================================

def log(level: str, msg: str) -> None:
    """统一日志：写到 LOG_FILE + stderr"""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] [{level}] {msg}"
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line, file=sys.stderr, flush=True)


def run_opencli(args: list[str], timeout: int = OPENCLI_TIMEOUT) -> tuple[int, str, str]:
    """
    Run opencli with timeout + single-step retry.
    Returns (returncode, stdout, stderr).
    """
    cmd = ["opencli", "twitter"] + args
    last_err = ""
    for attempt in range(OPENCLI_RETRY + 1):
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            out = proc.stdout
            err = proc.stderr
            if proc.returncode == 0:
                return 0, out, err
            last_err = err.strip() or out.strip()
            log("WARN", f"opencli {args[0] if args else '?'} exit={proc.returncode} (try {attempt+1}/{OPENCLI_RETRY+1}): {last_err[:200]}")
        except subprocess.TimeoutExpired:
            log("WARN", f"opencli {args[0] if args else '?'} TIMEOUT after {timeout}s (try {attempt+1}/{OPENCLI_RETRY+1})")
            last_err = "TIMEOUT"
        if attempt < OPENCLI_RETRY:
            time.sleep(3)  # retry 前等 3s
    return 124 if last_err == "TIMEOUT" else 1, "", last_err


def strip_warnings(text: str) -> str:
    """去掉 opencli 的 [UNDICI-EHPA] warning 行和尾部 'Update available' 块"""
    lines = text.split("\n")
    out = []
    started = False
    for line in lines:
        # 跳过 node warning 行
        if line.startswith("(node:") or line.startswith("[UNDICI-EHPA]") or line.startswith("Use `node"):
            continue
        # 跳过尾部 update 块
        if "Update available:" in line or "Download:" in line or "Extension update available:" in line or "npm install -g" in line:
            continue
        # 在第一个 '{' 或 '[' 之前，可能还有 (node:) 等噪声
        if not started:
            stripped = line.lstrip()
            if stripped.startswith("{") or stripped.startswith("["):
                started = True
                out.append(stripped)
                continue
            # 还没到 JSON 起点，跳过
            continue
        out.append(line)
    return "\n".join(out).strip()


def safe_loads(stdout: str) -> Any:
    """Strip warnings + load JSON（容忍尾部多余字符）"""
    cleaned = strip_warnings(stdout)
    if not cleaned:
        return None
    # 找第一个 { 或 [ 开始
    start_idx = 0
    for i, ch in enumerate(cleaned):
        if ch in "[{":
            start_idx = i
            break
    # 找匹配的结束位置（更稳：尝试用 raw_decode 找第一个合法对象）
    try:
        obj, _ = json.JSONDecoder().raw_decode(cleaned, start_idx)
        return obj
    except json.JSONDecodeError as e:
        log("WARN", f"JSON parse failed: {e}; first 200 chars: {cleaned[start_idx:start_idx+200]}")
        return None


# ============================================================
# State (黑名单)
# ============================================================

def load_state() -> dict:
    if not STATE_FILE.exists():
        return {"blacklist": {}, "last_run": None, "totals": {"succeeded": 0, "failed": 0, "skipped": 0}}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"blacklist": {}, "last_run": None, "totals": {"succeeded": 0, "failed": 0, "skipped": 0}}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def add_to_blacklist(state: dict, tweet_id: str, reason: str) -> None:
    state["blacklist"][tweet_id] = {
        "reason": reason,
        "added_at": datetime.now().isoformat(),
    }


def is_blacklisted(state: dict, tweet_id: str) -> bool:
    """检查是否在黑名单（且未过期）"""
    info = state["blacklist"].get(tweet_id)
    if not info:
        return False
    try:
        added = datetime.fromisoformat(info["added_at"])
    except Exception:
        return False
    age_hours = (datetime.now() - added).total_seconds() / 3600
    if age_hours > STATE_TTL_HOURS:
        # 过期，从黑名单移除
        del state["blacklist"][tweet_id]
        return False
    return True


def clean_blacklist(state: dict) -> None:
    """清理过期黑名单"""
    now = datetime.now()
    expired = []
    for tid, info in state["blacklist"].items():
        try:
            added = datetime.fromisoformat(info["added_at"])
            if (now - added).total_seconds() / 3600 > STATE_TTL_HOURS:
                expired.append(tid)
        except Exception:
            expired.append(tid)
    for tid in expired:
        del state["blacklist"][tid]


# ============================================================
# Phase 1: Fetch & Filter
# ============================================================

def fetch_timeline(limit: int = 80) -> list[dict] | None:
    """抓 for-you 时间线；失败返回 None（不要 partial）"""
    rc, out, err = run_opencli(
        ["timeline", "--type", "for-you", "--site-session", "persistent", "--limit", str(limit), "-f", "json"],
        timeout=OPENCLI_TIMEOUT,
    )
    if rc != 0:
        log("ERROR", f"timeline fetch failed: exit={rc} err={err[:200]}")
        return None
    data = safe_loads(out)
    if not isinstance(data, list):
        log("ERROR", f"timeline fetch returned non-list: {type(data).__name__}")
        return None
    return data


def fetch_my_likes(limit: int = 1000) -> set[str]:
    """抓最近 N 条 liked 帖子 ID；失败返回空集（保守走'全部当未点赞'）。
    深度默认 1000：@semonxue 累计 15K+ likes，limit=200/500 漏掉刚 like 的导致重复处理。
    1000 覆盖 ~12-25 天，按 cron 5-10 likes × 12 次/天 ≈ 60-120 likes/天算够用。
    单次 ~25s，超时单独放宽到 60s（不是 critical path 失败仍可继续）。
    """
    rc, out, err = run_opencli(
        ["likes", "@" + ACCOUNT_HANDLE, "--site-session", "persistent", "--limit", str(limit), "-f", "json"],
        timeout=60,  # likes fetch 1000 较慢，单独放宽到 60s
    )
    if rc != 0:
        log("WARN", f"my likes fetch failed (exit={rc}); treat as empty set (will dedup via D1 only)")
        return set()
    data = safe_loads(out)
    if not isinstance(data, list):
        return set()
    return {t.get("id", "") for t in data if t.get("id")}


def dedup_existing(ids: list[str]) -> set[str]:
    """调 check-duplicates API；返回已存在的 ID 集合
    失败（curl 错 / 5xx / parse 错）时返回空集（保守：把 chunk 当作全 missing，让 D1 真正收录时再撞 unique constraint）
    """
    if not ids:
        return set()
    existing = set()
    # 一次最多 25 个（API 大 chunk 偶发 500，分小块更稳）
    chunk_size = 25
    for i in range(0, len(ids), chunk_size):
        chunk = ids[i:i+chunk_size]
        url = f"https://awesomevideoprompts.com/api/prompts/check-duplicates?ids={','.join(chunk)}"
        for attempt in range(2):  # 重试 1 次
            try:
                proc = subprocess.run(
                    ["curl", "-sS", "-H", "User-Agent: x_timeline_collect/1.0", "--max-time", "15", url],
                    capture_output=True, text=True, timeout=20,
                )
                if proc.returncode != 0:
                    log("WARN", f"dedup curl failed chunk={i//chunk_size+1} exit={proc.returncode}; treat as all-missing")
                    break
                if not proc.stdout.strip():
                    if attempt == 0:
                        time.sleep(2)
                        continue
                    log("WARN", f"dedup empty body chunk={i//chunk_size+1} (after retry); treat as all-missing")
                    break
                try:
                    data = json.loads(proc.stdout)
                    if "existing" in data:
                        existing.update(data.get("existing", []))
                        break  # 成功
                    else:
                        log("WARN", f"dedup unexpected response chunk={i//chunk_size+1}: {proc.stdout[:200]}")
                        break
                except json.JSONDecodeError as e:
                    if attempt == 0:
                        time.sleep(2)
                        continue
                    log("WARN", f"dedup JSON parse failed: {e}; body[:200]={proc.stdout[:200]}")
                    break
            except subprocess.TimeoutExpired:
                if attempt == 0:
                    time.sleep(2)
                    continue
                log("WARN", f"dedup curl TIMEOUT chunk={i//chunk_size+1}; treat as all-missing")
                break
    return existing


def has_video(tweet: dict) -> bool:
    """判断帖子是否含视频"""
    media_urls = tweet.get("media_urls", []) or []
    return any((".mp4" in u) or ("video.twimg" in u) for u in media_urls)


def looks_like_has_prompt(text: str) -> bool:
    """
    启发式判断正文是否含提示词。
    True  = 提示词在正文里（直接收录）
    False = 提示词可能在评论（需要拉 thread）或正文太短（< 100 字符，可能只是 credits）
    """
    if not text or len(text) < 100:
        return False  # 太短，可能是 credits / 仅元数据
    text_lower = text.lower()
    # 强信号 1: 命令式动词（提示词的典型开头）
    imperative = [
        r"\b(create|generate|make|build|design|render|show|visualize|imagine|animate|film|shoot|capture|produce)\b",
    ]
    # 强信号 2: prompt 关键词
    keywords = [
        r"\bprompt\b", r"\bscene\b", r"\bstyle\b", r"\bvisual\b", r"\bcamera\b",
        r"\bcinematic\b", r"\bphotorealistic\b", r"\b8k\b", r"\b4k\b",
        r"创建.*提示词", r"提示词[:：]", r"相关提示词", r"提示词如下",
    ]
    if any(re.search(p, text_lower) for p in imperative + keywords):
        return True
    # 退路：>= 300 字符的多行内容（可能是 JSON / 长 prompt）
    if len(text) >= 300 and "\n" in text:
        return True
    return False


def pick_candidates(
    timeline: list[dict],
    my_likes: set[str],
    existing: set[str],
    blacklisted: set[str],
) -> list[dict]:
    """挑选候选：含视频 + 未点赞 + 未收录 + 不在黑名单 + 正文有 prompt 暗示"""
    out = []
    for t in timeline:
        tid = t.get("id", "")
        if not tid:
            continue
        if tid in my_likes:
            continue
        if tid in existing:
            continue
        if tid in blacklisted:
            continue
        if not has_video(t):
            continue
        if not looks_like_has_prompt(t.get("text", "")):
            continue
        out.append(t)
    return out


# ============================================================
# Phase 2: Process One
# ============================================================

def process_one(tweet_id: str) -> dict:
    """
    处理单条：download → compress → write JSON → like
    返回 {"ok": bool, "reason": str, "draft": str, "title": str, "model": str, "tags": list}
    """
    result = {"tweet_id": tweet_id, "ok": False, "reason": "", "draft": "", "title": "", "model": "", "tags": []}
    temp_dir = TEMP_DIR / tweet_id
    temp_dir.mkdir(parents=True, exist_ok=True)

    try:
        # 1. download (复用 tools/dl-x-videos.py)
        url = f"https://x.com/i/status/{tweet_id}"
        log("INFO", f"  download {tweet_id}...")
        try:
            proc = subprocess.run(
                ["python3", str(ROOT / "tools" / "dl-x-videos.py"), url, "--json"],
                capture_output=True, text=True, timeout=DOWNLOAD_TIMEOUT,
            )
        except subprocess.TimeoutExpired:
            result["reason"] = "download_timeout"
            log("WARN", f"  {tweet_id}: download TIMEOUT after {DOWNLOAD_TIMEOUT}s")
            return result

        if proc.returncode != 0:
            result["reason"] = f"download_failed_exit{proc.returncode}"
            log("WARN", f"  {tweet_id}: download failed exit={proc.returncode} stderr={proc.stderr[:200]}")
            return result

        info_path = temp_dir / "info.json"
        if not info_path.exists():
            result["reason"] = "download_no_info_json"
            log("WARN", f"  {tweet_id}: download ok but info.json missing")
            return result

        info = json.loads(info_path.read_text(encoding="utf-8"))
        text = info.get("text", "")
        post_date_str = info.get("post_date", "")
        author = info.get("author_name", "Unknown")
        author_username = info.get("author_username", "")
        post_url = info.get("url", url)

        if not text or len(text) < 100:
            result["reason"] = "text_too_short"
            log("WARN", f"  {tweet_id}: text too short ({len(text)} chars) - likely no prompt")
            return result

        if not looks_like_has_prompt(text):
            result["reason"] = "no_prompt_detected"
            log("WARN", f"  {tweet_id}: no prompt pattern in text (len={len(text)})")
            return result

        # 2. parse post_date
        try:
            # 格式: "Fri Aug 28 03:33:04 +0000 2026"
            post_dt = datetime.strptime(post_date_str, "%a %b %d %H:%M:%S %z %Y")
        except Exception as e:
            result["reason"] = f"date_parse_failed: {e}"
            log("WARN", f"  {tweet_id}: date parse failed: {e}")
            return result
        post_date = post_dt.strftime("%Y-%m-%d")
        year_month = post_dt.strftime("%Y-%m")

        # 3. title: 启发式（避免 LLM 失败拖累）
        title = heuristic_title(text)
        if LLM_TITLE:
            try:
                sys.path.insert(0, str(ROOT / "tools"))
                from dl_x_videos import gen_title_via_llm  # type: ignore
                llm_title = gen_title_via_llm(text)
                if llm_title:
                    title = llm_title
            except Exception as e:
                log("WARN", f"  {tweet_id}: LLM title failed, use heuristic: {e}")
        result["title"] = title

        # 4. model detection
        model = detect_model(text)
        result["model"] = model

        # 5. tag selection
        tags = select_tags(text)
        result["tags"] = tags

        # 6. slug + paths
        slug_suffix = slugify(title)[:40] or "video"
        slug = f"{tweet_id}-{slug_suffix}"
        asset_dir = ROOT / "static" / "_drafts" / "prompts" / year_month / slug
        asset_dir.mkdir(parents=True, exist_ok=True)

        # 7. compress cover
        src_thumb = temp_dir / "video_00001.jpg"
        dst_cover = asset_dir / "cover.jpg"
        if not src_thumb.exists():
            result["reason"] = "no_thumbnail"
            log("WARN", f"  {tweet_id}: thumbnail missing")
            return result
        try:
            subprocess.run(
                ["magick", str(src_thumb), "-resize", "600x600>", "-quality", "60", str(dst_cover)],
                check=True, capture_output=True, timeout=30,
            )
            # 30k 限制，超出再压一次
            if dst_cover.stat().st_size > 35_000:
                subprocess.run(
                    ["magick", str(src_thumb), "-resize", "600x600>", "-quality", "55", str(dst_cover)],
                    check=True, capture_output=True, timeout=30,
                )
        except Exception as e:
            result["reason"] = f"cover_compress_failed: {e}"
            log("WARN", f"  {tweet_id}: cover compress failed: {e}")
            return result

        # 8. video (复用 480p preview)
        src_preview = temp_dir / "preview_1_480p.mp4"
        dst_video = asset_dir / "video.mp4"
        if not src_preview.exists():
            result["reason"] = "no_preview_video"
            log("WARN", f"  {tweet_id}: preview video missing")
            return result
        try:
            shutil.copy2(str(src_preview), str(dst_video))
            if dst_video.stat().st_size > 1_050_000:
                # 重压
                subprocess.run(
                    ["ffmpeg", "-y", "-i", str(src_preview),
                     "-vf", "scale=-2:480", "-r", "10", "-an",
                     "-c:v", "libx264", "-crf", "36", "-preset", "veryfast",
                     "-fs", "900k", str(dst_video)],
                    check=True, capture_output=True, timeout=60,
                )
        except Exception as e:
            result["reason"] = f"video_compress_failed: {e}"
            log("WARN", f"  {tweet_id}: video compress failed: {e}")
            return result

        # 9. write draft JSON
        asset_dir_rel = f"/prompts/{year_month}/{slug}"
        draft_path = ROOT / "content" / "_drafts" / "prompts" / year_month / f"{slug}.json"
        draft_path.parent.mkdir(parents=True, exist_ok=True)

        draft = {
            "title": title,
            "description": text.strip(),
            "models": [model],
            "tags": tags,
            "author": author,
            "source_url": post_url,
            "post_date": post_date,
            "image": f"{asset_dir_rel}/cover.jpg",
            "video": f"{asset_dir_rel}/video.mp4",
            "draft": True,
            "published": False,
            "published_at": None,
            "published_slug": None,
            "published_error": None,
            "publish_queued_at": None,
        }
        draft_path.write_text(json.dumps(draft, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        result["draft"] = str(draft_path.relative_to(ROOT))
        log("INFO", f"  ✓ {tweet_id}: draft={draft_path.name} title='{title}' model={model} tags={tags}")

        # 10. like (only on success)
        if LIKE_AFTER:
            like_url = f"https://x.com/{author_username}/status/{tweet_id}"
            rc, out, err = run_opencli(
                ["like", like_url, "--site-session", "persistent", "-f", "json"],
                timeout=OPENCLI_TIMEOUT,
            )
            if rc == 0:
                log("INFO", f"  ✓ liked {tweet_id}")
            else:
                log("WARN", f"  like failed for {tweet_id} (exit={rc}); draft still saved")

        result["ok"] = True
        return result

    finally:
        # 无论成功失败都清 temp
        try:
            shutil.rmtree(str(temp_dir), ignore_errors=True)
        except Exception:
            pass


def slugify(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = s.strip("-")
    return s


# ---- 启发式 title/tags/model ----

def heuristic_title(text: str) -> str:
    """3-7 词，Title Case，无标点。优先抽取首句主语。"""
    text = text.strip()
    # 尝试第一句
    first = re.split(r"[.!?\n]", text, maxsplit=1)[0].strip()
    if 5 <= len(first) <= 80:
        return clean_title(first)
    # 退路
    return "Video Prompt Snapshot"


def clean_title(s: str) -> str:
    s = re.sub(r"https?://\S+", "", s)
    s = re.sub(r"[@#]\w+", "", s)
    s = re.sub(r"[^\w\s-]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    words = s.split()
    # 3-7 词
    if len(words) > 7:
        words = words[:7]
    if len(words) < 3:
        words += ["Cinematic", "Scene", "Visual"][: 3 - len(words)]
    # Title Case
    return " ".join(w.capitalize() for w in words)


def detect_model(text: str) -> str:
    text_lc = text.lower()
    model_keywords = [
        ("seedance 2.5", "seedance25"),
        ("seedance 2.0", "seedance2"),
        ("seedance 2", "seedance2"),
        ("wan 3.0", "wan3"),
        ("wan 3 prime", "wan3"),
        ("wan 2.7", "wan27"),
        ("wan 2.6", "wan26"),
        ("gemini omni", "geminiomniflash"),
        ("kling 3", "kling3"),
        ("kling 2.6", "kling26"),
        ("sora 2", "sora2"),
        ("sora", "sora"),
        ("hailuo", "hailuo"),
        ("veo 3", "veo3"),
        ("ray 3", "ray314"),
        ("vidu q3", "viduq3"),
        ("pika", "pika"),
        ("runway", "runway"),
        ("minimax h3", "minimaxh3"),
        ("hedra", "hedra"),
        ("ltx 2.3", "ltx23"),
        ("ltx pro", "ltxpro"),
    ]
    for kw, m in model_keywords:
        if kw in text_lc:
            return m
    return "seedance2"  # 默认 fallback


# Tags 候选 + 强信号词表（每条用 data/tags.yaml 里的真实 slug）
# 关键：模式要严格。短词容易在长 prompt 中误命中（"car" 命中 racing 但其实只是描述场景里的车）
# 所以：单词必须独立成词 (\b)，或者作为词组（multi-word）才匹配
TAG_PATTERNS = [
    # 高频通用
    (r"\bcinematic\b", "cinematic"),
    (r"\bphotorealistic\b|\bhyperreal\b", "realistic"),
    (r"\b(close[- ]?up|extreme close)\b", "macro"),
    # 食物
    (r"\b(latte|espresso|coffee|crema|cappuccino)\b", "food"),
    (r"\b(burger|cheeseburger|noodle|pasta|sushi|ramen)\b", "food"),
    (r"\bcooking\b|\b(kitchen|recipe)\b", "food"),
    # 太空/科幻
    (r"\b(space[- ]?station|spaceship|spacecraft|spacesuit)\b", "space"),
    (r"\b(sci[- ]?fi|scifi|cyberpunk|neon)\b", "futuristic"),
    # 人物/场景
    (r"\b(korean|japanese|asian)\b.*\b(woman|girl|lady)\b", "lifestyle"),
    (r"\b(race|racing|drift|racetrack)\b", "racing"),
    (r"\b(sports|football|basketball|soccer|tennis|skateboard|scooter)\b", "sports"),
    (r"\b(architecture|interior|villa|mansion|scandinavian)\b", "urban"),
    (r"\b(podcast|interview|talk[- ]?show|radio)\b", "dialogue"),
    (r"\b(ballet|dance|ballroom|tango|choreograph)\w*\b", "dance"),
    (r"\b(fashion|outfit|wardrobe|dress|apparel)\w*\b", "fashion"),
    (r"\b(cat|dog|pet|puppy|kitten|hamster|fox|wolf)\b", "animals"),
    (r"\b(suno|music[- ]?video|song)\b", "music"),
    (r"\b(commercial|advert|advertisement|campaign|product[- ]?hero|brand)\b", "advertisement"),
    (r"\b(romance|romantic|kiss|couple)\w*\b", "romance"),
    (r"\b(vintage|retro|90s|1980s|1990s|camcorder|dv\b|nostalgia|nostalgic)\b", "vintage"),
    (r"\b(sunset|dawn|dusk|sunrise|golden hour)\b", "sunset"),
    (r"\b(beach|ocean|sea|river|underwater|coral)\b", "water"),
    (r"\b(mountain|alpine|hiking|scenic|summit|valley)\b", "landscape"),
    (r"\b(action|combat|fight|warrior|battle|martial)\w*\b", "action"),
    (r"\b(fantasy|mythical|magical|wizard|witch|dragon|elf)\w*\b", "fantasy"),
    (r"\b(horror|scary|creepy|haunted|ghost)\w*\b", "horror"),
    (r"\b(animation|anime|animated|comic)\w*\b", "anime"),
    (r"\b(tutorial|how[- ]?to|step[- ]?by[- ]?step|instructional)\b", "instructional"),
    (r"\b(3d|render|cgi)\b", "3d"),
    (r"\b(aerial|drone|overhead|top[- ]?down|bird'?s[- ]?eye)\b", "aerial"),
    (r"\b(slow[- ]?motion|slowmo)\b", "motion_blur"),
    (r"\b(portrait|face|beauty|skin|selfie|headshot)\w*\b", "portrait"),
    (r"\b(transformer|mecha|robot|gundam|machine)\w*\b", "mecha"),
    (r"\b(first[- ]?person|\bpov\b|fpv)\b", "pov"),
    (r"\b(weather|rain|snow|storm|thunder|tornado|typhoon)\w*\b", "weather"),
    (r"\b(autumn|fall|leaves|maple)\b", "autumn"),
    (r"\bwinter\b|\b(ice|frost|blizzard)\b", "winter"),
    (r"\bsummer\b", "summer"),
    (r"\bspring\b|\b(blossom|cherry[- ]?blossom|flower)\w*\b", "spring"),
    (r"\b(humor|comedy|funny|joke|parody)\w*\b", "humor"),
    (r"\b(telekinetic|time[- ]?stop|time[- ]?freeze|frozen[- ]?time)\b", "fantasy"),
    (r"\b(school|student|classroom|education|teacher|university)\w*\b", "education"),
    (r"\b(vehicle|automotive|car|truck|motorcycle)\w*\b", "automotive"),
    (r"\b(street|city|downtown|alley|skyscraper)\w*\b", "urban"),
]


def select_tags(text: str, max_tags: int = 5) -> list[str]:
    text_lc = text.lower()
    tags = []
    for pat, tag in TAG_PATTERNS:
        if tag in tags:
            continue
        if re.search(pat, text_lc):
            tags.append(tag)
        if len(tags) >= max_tags:
            break
    if not tags:
        tags = ["cinematic"]
    return tags


# ============================================================
# Top-level
# ============================================================

def run_full(target: int = 0) -> dict:
    """完整 run：fetch → filter → process each → like each"""
    state = load_state()
    clean_blacklist(state)
    state["last_run"] = datetime.now().isoformat()

    if target <= 0:
        target = MAX_COUNT

    log("INFO", f"=== run start (target={target}, min={MIN_COUNT}, max={MAX_COUNT}, like={LIKE_AFTER}) ===")

    # 1. fetch
    timeline = fetch_timeline(limit=80)
    if not timeline:
        state["totals"]["failed"] = state["totals"].get("failed", 0) + 1
        save_state(state)
        log("ERROR", "timeline fetch failed; abort run")
        return {"ok": False, "reason": "timeline_fetch_failed", "processed": 0}

    # 2. dedup online
    all_ids = [t.get("id", "") for t in timeline if t.get("id")]
    existing = dedup_existing(all_ids)
    log("INFO", f"timeline={len(timeline)} dedup_existing={len(existing)}")

    # 3. fetch my likes
    my_likes = fetch_my_likes(limit=1000)
    log("INFO", f"my_likes_size={len(my_likes)}")

    # 4. pick candidates
    blacklisted = set(state["blacklist"].keys())
    candidates = pick_candidates(timeline, my_likes, existing, blacklisted)
    log("INFO", f"candidates (video + not-liked + not-dedup + not-blacklist) = {len(candidates)}")

    if not candidates:
        save_state(state)
        log("INFO", "no candidates; exit clean")
        return {"ok": True, "reason": "no_candidates", "processed": 0}

    # 5. select up to target
    selected = candidates[:target]
    log("INFO", f"will process {len(selected)} (target={target})")

    # 6. process each (容错：单条失败不影响其他)
    succeeded = 0
    failed = 0
    just_liked = set()  # 本次 run 刚 like 的，下一条跳过
    for t in selected:
        tid = t.get("id", "")
        if not tid:
            continue
        if tid in just_liked:
            log("INFO", f"  skip {tid}: just liked in this run")
            continue
        r = process_one(tid)
        if r["ok"]:
            succeeded += 1
            just_liked.add(tid)
            state["totals"]["succeeded"] = state["totals"].get("succeeded", 0) + 1
        else:
            failed += 1
            state["totals"]["failed"] = state["totals"].get("failed", 0) + 1
            # 加入黑名单（4h 内不再尝试）
            add_to_blacklist(state, tid, r.get("reason", "unknown"))

    save_state(state)
    log("INFO", f"=== run done: succeeded={succeeded} failed={failed} target_met={succeeded >= MIN_COUNT} ===")
    return {
        "ok": True,
        "processed": succeeded,
        "failed": failed,
        "target_met": succeeded >= MIN_COUNT,
    }


def run_dryrun() -> dict:
    """干跑：只 fetch + dedup + pick，不下载/写草稿/like"""
    state = load_state()
    clean_blacklist(state)

    timeline = fetch_timeline(limit=80)
    if not timeline:
        return {"ok": False, "reason": "timeline_fetch_failed"}

    all_ids = [t.get("id", "") for t in timeline if t.get("id")]
    existing = dedup_existing(all_ids)
    my_likes = fetch_my_likes(limit=1000)
    blacklisted = set(state["blacklist"].keys())
    candidates = pick_candidates(timeline, my_likes, existing, blacklisted)

    return {
        "ok": True,
        "timeline_size": len(timeline),
        "dedup_existing": len(existing),
        "my_likes_size": len(my_likes),
        "candidates": len(candidates),
        "candidate_ids": [c.get("id") for c in candidates[:MAX_COUNT]],
    }


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]

    if cmd == "run":
        target = int(sys.argv[2]) if len(sys.argv) > 2 else 0
        result = run_full(target=target)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif cmd == "dryrun":
        result = run_dryrun()
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif cmd == "process":
        if len(sys.argv) < 3:
            print("usage: process <tweet_id>")
            sys.exit(1)
        result = process_one(sys.argv[2])
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"unknown command: {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
