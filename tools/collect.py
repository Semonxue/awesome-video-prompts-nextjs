#!/usr/bin/env python3
"""
collect.py - 发现线主逻辑：从 @semonxue 时间线自适应收录视频提示词

设计原则（容错优先）：
- 每个 opencli 调用 30s 硬超时 + 单步重试 1 次（绝不无限重试，避免触发 X 风控/账号掉线）
- 账号异常（LOGGED_OUT / 连续超时 / 限流）立即退出本次 run，下个 tick 自然恢复
- 单条 download 失败：跳过本条 + 清理 temp 目录，继续下一条
- like 失败：记录但不阻塞本批（已收录的草稿依然有效）
- watchdog: 全程 5min 硬上限（subprocess 外部用 bash 杀）

用法:
    # 主模式：跑一次完整流程
    python3 tools/collect.py run

    # 干跑：只 fetch + dedup + pick，不下载/不写草稿/不 like
    python3 tools/collect.py dryrun

    # 单条处理（复用 run 逻辑）
    python3 tools/collect.py process <tweet_id>

    # 文件卫生巡检：找出仓库里残留的一次性脚本
    python3 tools/collect.py hygiene
    python3 tools/collect.py hygiene --trash   # 移进回收站（mavis-trash，可恢复）

环境变量:
    XTC_TARGET_COUNT - 目标条数（默认自适应 5-10）
    XTC_MAX_COUNT    - 硬上限（默认 10）
    XTC_MIN_COUNT    - 软下限（默认 5）
    XTC_LIKE_AFTER   - 1/0，写完草稿后是否点赞（默认 1）
    XTC_LLM_TITLE    - 1/0，是否走 LLM 生成 title（默认 0，title 走启发式）
    MAVIS_TRASH      - hygiene --trash 用的回收站命令（默认 ~/.minimax/bin/mavis-trash）

文件卫生（2026-10-23 定规则，详见 tools/README.md）:
    仓库里不允许留一次性脚本 —— scripts/_*.py / scripts/batch*.py / tmp*.sh /
    *.bak / 仓库根临时脚本一律禁止。数据修复走 tools/prompts.py 现成工具 + JSON 配置，
    不要把「tweet_id → title/tags」这类数据 hardcode 进新写的 .py。
    每轮收尾跑一次 `hygiene` 自检；cron wrapper（tools/collect.sh）已接入。
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

# 永久跳过名单：人工判定为「垃圾/非 AI 视频生成」的推文 ID。
# 与 state.json 黑名单的区别：黑名单 4h 后过期会被重新采集（点赞失败时尤其明显），
# 本名单永不过期，用来保证人工删除是持久的。
SKIP_FILE = ROOT / "tools" / "skip.json"

# ---- tunables ----
TARGET_COUNT = int(os.environ.get("XTC_TARGET_COUNT", "0"))  # 0 = 自适应
MAX_COUNT = int(os.environ.get("XTC_MAX_COUNT", "40"))
MIN_COUNT = int(os.environ.get("XTC_MIN_COUNT", "5"))
LIKE_AFTER = os.environ.get("XTC_LIKE_AFTER", "1") == "1"
LLM_TITLE = os.environ.get("XTC_LLM_TITLE", "0") == "1"

# 已知账号（hard-code，避免 like 时切错号）
ACCOUNT_HANDLE = "semonxue"

# opencli 会话模式：
#   persistent —— opencli 自管的持久 profile，和用户 Chrome 不是同一份 cookie 库
#   ephemeral  —— 走用户 Chrome 的 browser bridge，登录态 = Chrome 当前登录的账号
# 采集线必须以 @semonxue 的身份读「自己的点赞」并点赞别人，所以必须用 ephemeral。
# 2026-10-22 用户拍板：persistent 留给 @ai__cream 的养号/自动回复线，采集线改走 ephemeral。
SITE_SESSION = os.environ.get("XTC_SITE_SESSION", "ephemeral")

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

    关键：必须用 start_new_session=True + killpg 杀整个进程组。
    旧写法 subprocess.run(capture_output=True) 超时后，孙进程（opencli 派生的
    browser helper）仍持有 stdout 管道写端，communicate() 会永久阻塞等 EOF，
    表现为 likes 卡死 15~41 分钟、yt-dlp 卡死 30 分钟。
    """
    cmd = ["opencli", "twitter"] + args
    last_err = ""
    for attempt in range(OPENCLI_RETRY + 1):
        proc = None
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                start_new_session=True,  # 新进程组，便于整组 kill
            )
            try:
                out, err = proc.communicate(timeout=timeout)
            except subprocess.TimeoutExpired:
                # 连同孙进程一起杀，确保管道写端全部关闭
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except (ProcessLookupError, PermissionError, OSError):
                    proc.kill()
                try:
                    out, err = proc.communicate(timeout=10)
                except subprocess.TimeoutExpired:
                    out, err = "", ""
                raise subprocess.TimeoutExpired(cmd, timeout, output=out, stderr=err)
            if proc.returncode == 0:
                return 0, out, err
            last_err = err.strip() or out.strip()
            log("WARN", f"opencli {args[0] if args else '?'} exit={proc.returncode} (try {attempt+1}/{OPENCLI_RETRY+1}): {last_err[:200]}")
        except subprocess.TimeoutExpired:
            log("WARN", f"opencli {args[0] if args else '?'} TIMEOUT after {timeout}s (try {attempt+1}/{OPENCLI_RETRY+1})")
            last_err = "TIMEOUT"
        finally:
            # 兜底：确保没有残留
            if proc is not None and proc.poll() is None:
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except (ProcessLookupError, PermissionError, OSError):
                    proc.kill()
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


def unwrap_envelope(obj: Any) -> Any:
    """解包 opencli >= 2.0.0 的输出信封。

    2.0.x 起 `emitResult()` 无条件把结果包成 {"ok": true, "data": <payload>}，
    失败时是 {"ok": false, "error": {...}}（见 dist/src/command-output.js）。
    这个信封没有开关能关，1.8.x 则是直接输出裸 payload。
    这里统一解包，两个版本都能跑；未识别的结构原样返回。
    """
    if not isinstance(obj, dict):
        return obj
    if obj.get("ok") is True and "data" in obj:
        return obj["data"]
    if obj.get("ok") is False:
        err = obj.get("error")
        detail = err.get("message") if isinstance(err, dict) else err
        log("WARN", f"opencli 返回错误信封: {str(detail)[:200]}")
        return None
    return obj


def safe_loads(stdout: str) -> Any:
    """Strip warnings + load JSON（容忍尾部多余字符）+ 解包 2.0.x 输出信封"""
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
        return unwrap_envelope(obj)
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


def load_skip_ids() -> set[str]:
    """读取永久跳过名单。文件不存在或损坏时返回空集（不影响采集）。"""
    if not SKIP_FILE.exists():
        return set()
    try:
        data = json.loads(SKIP_FILE.read_text(encoding="utf-8"))
    except Exception:
        log("WARN", "skip list unreadable; treat as empty")
        return set()
    if isinstance(data, list):
        items = data
    elif isinstance(data, dict):
        items = data.get("ids") or []
    else:
        items = []
    return {str(x) for x in items if x}


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

def check_account() -> str | None:
    """跑批前置检查：确认采集会话当前登录的就是 ACCOUNT_HANDLE。

    返回 None = 通过；返回错误串 = 账号不对，本轮应直接放弃。

    为什么必须有这道闸：X 只允许账号本人查看自己的 likes。采集线要读 @semonxue 的
    点赞、并以 @semonxue 的身份给候选点赞；一旦会话登的是别的号（比如 @ai__cream），
    likes 必然取不到东西，而报错只甩一句 likes_fetch_failed —— 整轮 20+ 分钟白跑，
    而且是每 tick 确定性重演、不会自愈。提前 1 次 whoami 就能把问题说人话。
    """
    rc, out, err = run_opencli(
        ["whoami", "--site-session", SITE_SESSION, "-f", "json"],
        timeout=60,
    )
    if rc != 0:
        # 查不到身份不等于身份不对 —— 只告警，让后面的 likes 步骤自己判
        log("WARN", f"account preflight: whoami 失败 (exit={rc}): {err.strip()[:200]}; 无法确认账号，继续尝试")
        return None
    data = safe_loads(out)
    if not isinstance(data, dict):
        log("WARN", "account preflight: whoami 返回非 dict; 无法确认账号，继续尝试")
        return None
    who = (data.get("username") or "").strip().lstrip("@")
    if not who:
        log("WARN", "account preflight: whoami 未返回 username; 无法确认账号，继续尝试")
        return None
    if who.lower() != ACCOUNT_HANDLE.lower():
        where = "用户 Chrome（ephemeral）" if SITE_SESSION == "ephemeral" else "opencli persistent 浏览器"
        log("ERROR", f"account preflight: 会话账号 @{who} != 目标 @{ACCOUNT_HANDLE}；"
                     f"请在 {where} 里切到 @{ACCOUNT_HANDLE} 后再跑本轮（已跳过，不做无谓采集）")
        return f"account_mismatch: @{who} != @{ACCOUNT_HANDLE}"
    log("INFO", f"account preflight: @{who} OK (site-session={SITE_SESSION})")
    return None


def fetch_timeline(limit: int = 80) -> list[dict] | None:
    """抓 for-you 时间线；失败返回 None（不要 partial）"""
    rc, out, err = run_opencli(
        ["timeline", "--type", "for-you", "--site-session", SITE_SESSION, "--limit", str(limit), "-f", "json"],
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


def fetch_my_likes(limit: int = 1000) -> set[str] | None:
    """抓最近 N 条 liked 帖子 ID。

    返回 set = 抓取成功；返回 None = 抓取失败（状态未知）。

    ⚠️ 旧实现失败时返回空集，等价于「没有任何 liked 帖」，
    于是 `tid in my_likes` 恒为 False，「已点赞」过滤被整体放开 ——
    降级方向错了。失败时正确做法是保守跳过本轮（返回 None 由调用方 abort），
    因为此时无法判断候选是否已收录/已点赞，宁可少收也不能重复收。
    """
    rc, out, err = run_opencli(
        ["likes", "@" + ACCOUNT_HANDLE, "--site-session", SITE_SESSION, "--limit", str(limit), "-f", "json"],
        timeout=180,  # opencli 内部超时由 OPENCLI_BROWSER_COMMAND_TIMEOUT(150s) 控制，
                      # 这里留 30s 余量做脚本层兜底 kill；实测 likes 36~59s
    )
    if rc != 0:
        log("WARN", f"my likes fetch failed (exit={rc}): {err.strip()[:200]}; abort this run (不能放开已点赞过滤)")
        return None
    data = safe_loads(out)
    if not isinstance(data, list):
        log("WARN", "my likes fetch returned non-list; abort this run")
        return None
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
                    ["curl", "-sS", "-H", "User-Agent: avp-collect/1.0", "--max-time", "15", url],
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


# ============================================================
# 非 AI 视频内容过滤（2026-10-22 用户授权）
# 站点是「AI 视频提示词」库，主体不是「AI 生成的视频/图像作品或提示词」的推文一律不收。
# 规则是**保守硬拒绝**：宁可漏过（交给 cron 里的逐条人工判断），不可误杀。
# 命中时返回规则名，写进 cron.log，便于事后复核。
# ============================================================

# A 类：编码助手 / IDE / 引擎（带上下文，避免误伤提示词里的风格引用）
_REJECT_HARD: list[tuple[str, str]] = [
    ("编码助手", r"\b(claude code|codex cli|cursor ide|cursor agent|windsurf|aider)\b"),
    ("引擎库", r"\b(three\.?js|webgl|vscode|unity (engine|project|editor|3d)|phaser|playcanvas)\b"),
    ("godot游戏", r"\bgodot\b.{0,25}\b(game|indie|playable|steam|游戏)|游戏.{0,15}\bgodot\b"),
    # blender 只有在"拿它写脚本/插件/建模"语境才拒；
    # "into a blender and blends them"（厨房搅拌机）、"Unreal Engine render"（风格引用）不能误伤
    ("blender开发", r"(in blender|with blender|from blender|blender \d"
                     r"|blender.{0,25}\b(python|mcp|script|code|addon|add-on|geometry nodes|modifier|keyframe|rigging)\b)"),
    ("游戏开发", r"\b(game dev|game jam|indie ?game|游戏开发|游戏引擎|开发游戏)\b"),
    ("中文编程", r"(编程|纯代码|一切都是代码|代码生成)"),
    # 开源出来的工具/项目本身（不是 AI 视频作品）
    ("开源工具", r"(\bopen.?sourc(e|ed|ing)\b|开源)\b.{0,60}\b(tool|project|app|plugin|library|framework|prompt ?kit|pack)\b"
                 r"|\b(tool|project|app|plugin|library|framework)\b.{0,60}(\bopen.?sourc(e|ed|ing)\b|开源)"),
    ("纯代码渲染", r"\b(pure code|everything is code|all code|rendered (entirely )?(from|in) code)\b"),
    # 工具促销 / 引流。折扣只认 20%+（Picsart 等平台常写 "10% off" + "promo code"，
    # 那些帖子带真 AI 视频+提示词，不能误杀，所以 promo code / sign up 不作为拒绝依据）
    ("工具促销", r"(\b[2-9]\d\s*%\s*off\b|\bdiscount\b|\bcoupon\b|\bfree credits?\b"
                 r"|\baffiliate\b|\bpricing\b|\bsubscribe to\b|(限时优惠|订阅优惠|打折|クーポン))"),
    # 行业新闻 / 八卦
    ("行业新闻", r"(融资|主题演讲|抗议|财报|市值|发布会|大会)"
                 r"|\b(funding round|raised \$\d|Series [ABC]\b|keynote speech|protesters?)\b"),
    # 社交寒暄 / 无实质内容
    ("社交空内容", r"(^GM\b|^早安|Good morning everyone|good night everyone|周末快乐)"),
]

# B 类：LLM 成本/代码量跑分（纯代码 benchmark）。若正文里已经有**真实提示词体**则豁免，
# 因为有些作者会在贴提示词的同时附上代码量统计。
_REJECT_BENCH = (
    "LLM跑分",
    r"(per million tokens|\b\d+(\.\d+)?k tokens\b"
    r"|\$\d+\.\d+[^.]{0,40}\b(tokens?|cost)\b|\btokens?\b[^.]{0,40}\$\d|\bleaderboard\b|排行榜)",
)
# 正文里存在"真实提示词体"的信号。
# 只要出现 "prompt" 一词就豁免跑分规则：代码层拒绝 = 内容永远不会被收集、人也看不到，
# 所以宁可漏过（交给人工判断）不可误杀。
_PROMPT_BODY = re.compile(
    r"(\bprompt\b|Prompt\s*[:：]\s*\S|\bCreate a\b|\bCreate an\b|\bSCENE \d|\bScene \d"
    r"|\bSHOT \d|\bShot \d|\b\d+[-–]\d+s?\b|\bCHARACTERS?\s*[:：]|\bLOCATION\s*[:：]"
    r"|\bSTYLE\s*[:：]|\bCAMERA\s*[:：])",
    re.I,
)

_REJECT_HARD_RX = [(name, re.compile(pat, re.I | re.M)) for name, pat in _REJECT_HARD]
_REJECT_BENCH_RX = re.compile(_REJECT_BENCH[1], re.I | re.M)


def looks_like_non_ai_content(text: str) -> str | None:
    """正文主体不是「AI 生成的视频/图像作品或提示词」时返回命中的规则名，否则 None。

    硬规则无条件拒；LLM 跑分规则只在正文没有真实提示词体时才拒（避免误杀"贴了提示词还附代码统计"的作者）。
    """
    if not text:
        return None
    for name, rx in _REJECT_HARD_RX:
        if rx.search(text):
            return name
    if _REJECT_BENCH_RX.search(text) and not _PROMPT_BODY.search(text):
        return _REJECT_BENCH[0]
    return None


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
    skip_ids: set[str] | None = None,
) -> list[dict]:
    """挑选候选：含视频 + 未点赞 + 未收录 + 不在黑名单 + 不在永久跳过名单 + 正文有 prompt 暗示"""
    out = []
    skip_ids = skip_ids or set()
    rejected: list[tuple[str, str]] = []
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
        if tid in skip_ids:
            continue
        if not has_video(t):
            continue
        if not looks_like_has_prompt(t.get("text", "")):
            continue
        # 非 AI 视频内容（编程/工具/新闻/社交寒暄）直接不收录
        bad = looks_like_non_ai_content(t.get("text", "") or "")
        if bad:
            rejected.append((tid, bad))
            continue
        out.append(t)
    if rejected:
        for rid, why in rejected:
            log("INFO", f"  skip 非AI视频内容 [{why}] {rid}")
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
        # 1. download (复用 tools/download.py)
        url = f"https://x.com/i/status/{tweet_id}"
        log("INFO", f"  download {tweet_id}...")
        dl = None
        try:
            dl = subprocess.Popen(
                ["python3", str(ROOT / "tools" / "download.py"), url, "--json"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                start_new_session=True,
            )
            try:
                dl_out, dl_err = dl.communicate(timeout=DOWNLOAD_TIMEOUT)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(os.getpgid(dl.pid), signal.SIGKILL)
                except (ProcessLookupError, PermissionError, OSError):
                    dl.kill()
                try:
                    dl.communicate(timeout=10)
                except subprocess.TimeoutExpired:
                    pass
                raise
        except subprocess.TimeoutExpired:
            result["reason"] = "download_timeout"
            log("WARN", f"  {tweet_id}: download TIMEOUT after {DOWNLOAD_TIMEOUT}s")
            return result

        if dl.returncode != 0:
            result["reason"] = f"download_failed_exit{dl.returncode}"
            log("WARN", f"  {tweet_id}: download failed exit={dl.returncode} stderr={dl_err.strip()[:300]}")
            return result

        info_path = temp_dir / "info.json"
        if not info_path.exists():
            result["reason"] = "download_no_info_json"
            # download.py 的失败分支一律 exit 0，真实 download_error 只在 stderr 里。
            # 旧代码只写 "info.json missing"，把真因全丢了 —— 这里必须把 stderr 落盘。
            log("WARN", f"  {tweet_id}: download ok but info.json missing; real cause below")
            for line in (dl_err or "").strip().splitlines():
                log("WARN", f"    dl: {line[:300]}")
            try:
                (LOG_DIR / f"dl_error_{tweet_id}.log").write_text(
                    f"url={url}\nrc={dl.returncode}\n--- stdout ---\n{dl_out}\n--- stderr ---\n{dl_err}\n",
                    encoding="utf-8",
                )
            except OSError:
                pass
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
                from download import gen_title_via_llm  # type: ignore
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
            "models": ([model] if model else []),
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
                ["like", like_url, "--site-session", SITE_SESSION, "-f", "json"],
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


def detect_model(text: str) -> str | None:
    """从正文里识别生成模型。

    铁律：**正文没写出模型名就返回 None（models 留空）**。
    旧实现兜底返回 "seedance2"，导致每一条没点名模型的稿子都被打上 Seedance 2.0
    （2026-10-22 第九轮实测：200 条里 62 条错标；全库累计更早）。
    站点的 models 是筛选维度，猜错比不填更有害。
    """
    text_lc = text.lower()
    # 顺序敏感：更长/更具体的版本必须排在前面（"seedance 2.5" 要先于 "seedance 2"）
    model_keywords = [
        # seedance：版本要排在前面；作者手写错拼（seadance/seednace/seedenc）也要认
        ("seedance 2.5", "seedance25"),
        ("seadance 2.5", "seedance25"),
        ("seednace 2.5", "seedance25"),
        ("seedance 2.0", "seedance2"),
        ("seedenc 2.0", "seedance2"),
        ("seadance 2.0", "seedance2"),
        ("seedance 2", "seedance2"),
        ("seedenc 2", "seedance2"),
        ("seadance 2", "seedance2"),
        ("seedance", "seedance2"),
        ("seadance", "seedance2"),
        ("seednace", "seedance2"),
        ("seedenc", "seedance2"),
        ("wan 3.0", "wan3"),
        ("wan 3 prime", "wan3"),
        ("wan 3", "wan3"),
        ("wan 2.7", "wan27"),
        ("wan 2.6", "wan26"),
        ("gemini omni", "geminiomniflash"),
        ("omni flash", "geminiomniflash"),
        # minimax h3 要排在 hailuo 前面："Made with MiniMax H3 on @Hailuo_AI" 里
        # 生成模型是 H3，Hailuo 只是承载平台
        ("minimax h3", "minimaxh3"),
        ("fast h3", "minimaxh3"),
        ("kling 4.0", "kling4flash"),
        ("kling 4 flash", "kling4flash"),
        ("kling 4", "kling4flash"),
        ("kling o1", "klingo1"),
        ("kling 3.0", "kling3"),
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
        ("hedra", "hedra"),
        ("ltx 2.3", "ltx23"),
        ("ltx pro", "ltxpro"),
        ("pixverse", "pixverse"),
        ("flux 3", "flux3"),
        ("muse video", "musevideo"),
        ("wery", "wery"),
        ("happyhorse", "happyhorse"),
        ("ling 2.6", "ling26flash"),
        ("gen 4.5", "gen45"),
    ]
    for kw, m in model_keywords:
        if kw in text_lc:
            return m
    return None  # 正文没点名模型 → 不填（不要兜底猜）


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

    # 0. 前置账号检查：会话不是 @semonxue 就直接跳过，别做无谓采集
    acct_err = check_account()
    if acct_err:
        state["totals"]["skipped"] = state["totals"].get("skipped", 0) + 1
        save_state(state)
        return {"ok": False, "reason": acct_err, "processed": 0}

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
    if my_likes is None:
        # likes 状态未知 → 保守 abort，不放开已点赞过滤
        save_state(state)
        return {"ok": False, "reason": "likes_fetch_failed"}
    log("INFO", f"my_likes_size={len(my_likes)}")

    # 4. pick candidates
    blacklisted = set(state["blacklist"].keys())
    skip_ids = load_skip_ids()
    if skip_ids:
        log("INFO", f"skip list loaded: {len(skip_ids)} ids (permanent, never re-collected)")
    candidates = pick_candidates(timeline, my_likes, existing, blacklisted, skip_ids)
    log("INFO", f"candidates (video + not-liked + not-dedup + not-blacklist + not-skiplist) = {len(candidates)}")

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

    acct_err = check_account()
    if acct_err:
        return {"ok": False, "reason": acct_err}

    timeline = fetch_timeline(limit=80)
    if not timeline:
        return {"ok": False, "reason": "timeline_fetch_failed"}

    all_ids = [t.get("id", "") for t in timeline if t.get("id")]
    existing = dedup_existing(all_ids)
    my_likes = fetch_my_likes(limit=1000)
    if my_likes is None:
        return {"ok": False, "reason": "likes_fetch_failed"}
    blacklisted = set(state["blacklist"].keys())
    skip_ids = load_skip_ids()
    candidates = pick_candidates(timeline, my_likes, existing, blacklisted, skip_ids)

    return {
        "ok": True,
        "timeline_size": len(timeline),
        "dedup_existing": len(existing),
        "my_likes_size": len(my_likes),
        "skip_list_size": len(skip_ids),
        "candidates": len(candidates),
        "candidate_ids": [c.get("id") for c in candidates[:MAX_COUNT]],
    }


# ============================================================
# 文件卫生（一次性脚本巡检）
# ============================================================
#
# 「一次性脚本」的味道：下划线前缀 / batch|tmp|fix|merge|fetch 前缀 / 备份后缀。
# 为什么需要这个巡检（2026-10-23 定规则）：
#   2026-10-08~10 和 2026-10-22 两轮数据修复下来，scripts/ 累积了 23 个这类文件
#   （_fix_workset200*.py、_merge_*.py、_fetch_threads_batch2..5.py、*.bak2 …），
#   其中 _fetch_threads_batch2~5.py 内容只差一个输出目录常量；
#   这些文件全部未入库，却让 SEO 报告只能写「工作区里有大量未提交的 _fix_*.py」，
#   并且 tag 归一化把 360 从 3,604 收窄到 4 的误伤无法归因到具体哪次操作。
# 替代方案：数据修复用 tools/prompts.py（配置走 JSON），确需一次性脚本就写 /tmp。
# 详见 tools/README.md。

JUNK_NAME_RE = re.compile(
    r"^(_|batch|tmp|temp|scratch|helper|apply_|fix_|merge_|fetch_|report_)"
)
JUNK_SUFFIX_RE = re.compile(r"\.(bak\d*|orig|rej|save|old)$")
SCRIPT_SUFFIXES = {".py", ".sh", ".mjs", ".js", ".ts", ".cjs"}

# 巡检范围：仓库根第一层 + scripts/ + tools/（递归）
HYGIENE_ROOTS = ("scripts", "tools")
HYGIENE_SKIP_DIRS = {
    "node_modules", ".next", ".open-next", ".git", "__pycache__",
    ".wrangler", ".npm-cache", "logs", "temp", ".cache", "_cache",
}
# 仓库根只允许这些脚本/配置文件；其他根目录脚本一律算「一次性脚本」
# （2026-07-29 留下的 shoot-niji.mjs 就是这类：playwright 截图脚本，指向 /tmp）
ROOT_SCRIPT_ALLOWLIST = {
    "next.config.ts",
    "open-next.config.ts",
    "vitest.config.ts",
    "playwright.config.ts",
    "next-env.d.ts",
}


def _git_tracked_files() -> set[str] | None:
    """git 已跟踪文件的仓库相对路径集合；非 git 仓库 / git 不可用时返回 None。"""
    try:
        proc = subprocess.run(
            ["git", "-C", str(ROOT), "ls-files"],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    return {line.strip() for line in proc.stdout.splitlines() if line.strip()}


def _iter_script_files():
    """产出仓库里所有「脚本类」文件的仓库相对路径（跳过依赖/构建/日志目录）。"""
    # 1) 仓库根：只看第一层（next.config.ts 这类 config 不会命中 junk 规则）
    for p in sorted(ROOT.iterdir()):
        if p.is_file() and p.suffix in SCRIPT_SUFFIXES:
            yield p.relative_to(ROOT).as_posix()
    # 2) scripts/ 与 tools/：递归
    for sub in HYGIENE_ROOTS:
        base = ROOT / sub
        if not base.is_dir():
            continue
        for p in sorted(base.rglob("*")):
            if not p.is_file():
                continue
            parts = p.relative_to(ROOT).parts
            if any(part in HYGIENE_SKIP_DIRS for part in parts[:-1]):
                continue
            if p.suffix in SCRIPT_SUFFIXES or JUNK_SUFFIX_RE.search(p.name):
                yield p.relative_to(ROOT).as_posix()


def _is_junk_script(name: str) -> bool:
    return bool(JUNK_NAME_RE.match(name) or JUNK_SUFFIX_RE.search(name))


def run_hygiene(trash: bool = False) -> dict:
    """
    巡检仓库里的一次性脚本残留。

    分两类：
      errors   —— 未入库（git untracked）的一次性脚本 → 本轮结束前必须清掉
      warnings —— 已入库的一次性脚本（历史遗留）→ 不要再新增这类文件

    trash=True 时把 errors 交给 mavis-trash（可恢复），命令可用 MAVIS_TRASH 覆盖。
    返回 {ok, errors, warnings, trashed, tracked_known}。
    """
    tracked = _git_tracked_files()
    errors: list[str] = []
    warnings: list[str] = []
    for rel in _iter_script_files():
        if "/" not in rel:
            # 仓库根第一层：只放构建配置，其他脚本都算一次性脚本
            is_junk = rel not in ROOT_SCRIPT_ALLOWLIST
        else:
            is_junk = _is_junk_script(os.path.basename(rel))
        if not is_junk:
            continue
        if tracked is not None and rel in tracked:
            warnings.append(rel)
        else:
            errors.append(rel)

    trashed: list[str] = []
    if trash and errors:
        bin_path = os.environ.get(
            "MAVIS_TRASH", "/Users/semonxue/.minimax/bin/mavis-trash"
        )
        if not os.path.exists(bin_path):
            print(f"  !! mavis-trash 不存在: {bin_path}（可用 MAVIS_TRASH 覆盖）")
        else:
            proc = None
            try:
                proc = subprocess.run(
                    [bin_path, "--"] + [str(ROOT / rel) for rel in errors],
                    capture_output=True,
                    text=True,
                    timeout=180,  # macOS 上 mavis-trash 可能卡在 Finder 自动化授权，不能无限等
                )
            except subprocess.TimeoutExpired:
                print("  !! mavis-trash 超时（180s）—— macOS 上通常是 Finder 自动化权限未授权，")
                print("     请手动删，或换用 MAVIS_TRASH=<其他回收站命令>")
            except OSError as exc:
                print(f"  !! mavis-trash 无法执行: {exc}")
            if proc is not None:
                if proc.returncode != 0:
                    print(f"  !! mavis-trash 失败 rc={proc.returncode}")
                    print(f"     {proc.stderr.strip()[-500:]}")
                else:
                    trashed = list(errors)
                    errors = []

    print("=== 文件卫生巡检（一次性脚本）===")
    print(f"扫描范围: 仓库根第一层 / {' / '.join(HYGIENE_ROOTS)}"
          "（跳过 node_modules、构建产物、logs、temp）")
    if errors:
        print(f"\n❌ 未入库的一次性脚本 {len(errors)} 个 —— 本轮结束前必须清掉:")
        for rel in errors:
            print(f"     {rel}")
        print("\n   清理: python3 tools/collect.py hygiene --trash")
        print("   数据修复请改用现成工具: tools/prompts.py apply"
              "（改 title/tags/models + 删草稿 + 追加 skip 名单）")
        print("   / tools/prompts.py review|verify")
        print("   确需一次性脚本 → 写进 /tmp，本轮结束前删除；不要 .bak（用 git）")
    else:
        print("\n✓ 没有未入库的一次性脚本")
    if warnings:
        print(f"\n⚠️  已入库的一次性脚本 {len(warnings)} 个（历史遗留，不要新增）:")
        for rel in warnings:
            print(f"     {rel}")
    if trashed:
        print(f"\n🧹 已移入回收站 {len(trashed)} 个（mavis-trash，可恢复）")

    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "trashed": trashed,
        "tracked_known": tracked is not None,
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
    elif cmd == "hygiene":
        result = run_hygiene(trash="--trash" in sys.argv[2:])
        if "--json" in sys.argv[2:]:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        if not result["ok"]:
            sys.exit(2)  # 有未入库的一次性脚本残留 → 非 0，供 cron/wrapper 检测
    else:
        print(f"unknown command: {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
