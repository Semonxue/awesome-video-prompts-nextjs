#!/usr/bin/env python3
"""prompts.py —— 提取线统一入口：从推文里抽出结构化的 prompt 草稿。

这一条线只做一件事：**把已经发现（发现线）的推文，变成能入库的 prompt 草稿**。
四个子命令对应四个动作：

  review    取证：导出本轮正文（人工逐条判断用），可选抽帧图 + 抓作者自回复
  apply     落地：按配置合并提示词、改写 title/tags/models、删不合格草稿、追加 skip 名单
  verify    校验：本轮专项 + 全库审计（--audit）
  snapshot  刷基线：把当前库的人工标题/标签刷进 manual_titles_snapshot.json
  ledger    台账：重建垃圾台账 + 规则回测基准（规则准不准就看这个）

设计原则（2026-10-23 整合）：**一条线一个入口**。原来拆成 rev / extract_frames /
fetch_thread_replies / finalize / verify / refresh_snapshot 六个脚本，每个都要人记
路径、记参数格式，串一轮下来最容易漏步骤（尤其"刷快照"漏了就让下轮 verify 报
「历史条目被改动」假阳性）。现在合并成一个脚本，子命令自解释。

用法:
  # ① 取证（人工判断）：导出本轮正文
  python3 tools/prompts.py review --date 2026-10-23 --hour 06

  # ① 取证：再抽帧看产出是不是 AI 视频（内容定性闸门用）
  python3 tools/prompts.py review --date 2026-10-23 --hour 06 --frames

  # ① 取证：正文缺提示词时抓作者自回复（作者常把提示词放在自己的回复里）
  python3 tools/prompts.py review --ids 2103849845467537562 --replies

  # ② 落地：配置 JSON → 改写 + 删除 + skip（apply 结束自动刷快照）
  python3 tools/prompts.py apply /tmp/round_1023_06.json

  # ③ 校验
  python3 tools/prompts.py verify --date 2026-10-23 --hour 06 --keep 111,222 --junk 333
  python3 tools/prompts.py verify --audit --audit-limit 60

配置 JSON 格式（apply）:
{
  "round": "2026-10-23 06:00",
  "keep":  { "<tid>": {"title": "...", "tags": [...], "models": [...],
                       "description": "...",          # 可选: 整段替换 description
                       "recovered_prompt": "...",     # 可选: 把作者自回复里的提示词追加进 description
                       "recovered_from": ["<reply_id>"]},  # 可选: 溯源 id, 写进 marker
            ... },
  "junk":  ["<tid>", ...]
}

「作者自回复还原提示词」(recovered_prompt):
  作者常把完整提示词放在自己帖子的自回复里(正文只写 "Prompt below 👇"),
  用 review --replies 抓回来后, 在这里合并回 description 末尾。
  - 写入 marker 固定为 `----- Prompt (recovered from author's thread reply <ids>) -----`
  - 幂等: description 里已有 `recovered from author` 就不再追加第二次
  - tools/md-editor/server.py 的 has_recovered_prompt() 按该标记识别(只匹配 "recovered from author",
    换来源写法也不会静默失配)

关键坑（来自实战，勿改回去）:
- 抓线程的 `--limit` 必须给大值: 50 会静默截断，作者自回复常排在 50 条之后 → 默认 120
- `created_at` 形如 "Sat Sep 26 06:34:37 +0000 2026"，按字符串排序会因星期缩写错序
  → 必须 parse 成 datetime 再排
- opencli >= 2.0.0 输出 {"ok": true, "data": [...]}; 1.8.x 是裸数组 → 两种都要兼容
- 超时必须 killpg 杀整个进程组: opencli 派生的 browser helper 会持有管道写端，
  只 kill 主进程会让 communicate() 一直等 EOF(采集器里踩过: 卡 15~41 分钟)
- magick 冷启动 ~31s，抽帧前先预热，否则第一次 montage 调用会超时
- 删除一律走 mavis-trash；素材目录由草稿 image 字段 dirname 推导(绝不做 replace)
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

# tools/prompts.py → 仓库根
ROOT = Path(__file__).resolve().parent.parent
DRAFTS = ROOT / "content/_drafts/prompts"
STATIC = ROOT / "static/_drafts"
LOGS = ROOT / "logs/x_timeline_cron"
LOG_FILE = LOGS / "cron.log"
SNAPSHOT = LOGS / "manual_titles_snapshot.json"
SKIP = ROOT / "tools/skip.json"
TRASH = "/Users/semonxue/.minimax/bin/mavis-trash"

# 台账 / 规则基准（prompts.py ledger 子命令用）
BENCH = LOGS / "filter_rules_benchmark.json"
LEDGER = LOGS / "junk_ledger.json"
LABELS = LOGS / "labels.json"
# 标注集丢失时的恢复来源：那一轮会话的完整历史
SESSION_DIR = ("/Users/semonxue/.minimax/v2/sessions/2026/09/27/"
               "16-00-00-059-session_bXZzXzczMjllMjI2NTk2YzQyNjNiNmY2NDE1YTZjNmIxYTgy")

# 作者自回复还原提示词的溯源 marker —— md-editor 的 has_recovered_prompt() 认这个串
RECOVERED_MARKER = "recovered from author"
RECOVERED_TEMPLATE = "----- Prompt (recovered from author's thread reply {ids}) -----"

# 标题兜底文案 / 模型名 / 中日韩字符 / 悬空结尾 —— 校验与审计共用
FALLBACK = re.compile(r"video prompt snapshot|prompt cinematic scene|ai video masterpiece|created this using|ai video generation prompt|10-second romantic video prompt", re.I)
MODEL_NAMES = ["seedance", "kling", "grok", "deepseek", "gemini", "opus", "sonnet", "hailuo", "veo",
               "pixverse", "runway", "comfyui", "midjourney", "higgsfield", "flova", "picsart",
               "wizstar", "pollo", "medeo", "minimax", "sora", "flux", "wan", "ltx", "ling", "muse",
               "hedra", "vidu", "pika", "gen4", "happyhorse", "wery", "luma", "claude", "topaz", "cuddler"]
CJK = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]")
# 标题以虚词/介词/连词收尾 = 明显被截断
# 刻意剔除 in/up/out/it/her/he/she —— 这些能合法结尾于完整英文标题
# (Drive In / Close-Up / The Woman Who Moved In / ...Realize It)
DANGLING = re.compile(
    r"^(a|an|the|and|or|but|to|of|on|at|for|with|from|by|is|are|was|were|"
    r"my|your|his|its|their|this|that|as|if|so|than|then|into|over|about|like|"
    r"new|old|more|most|very|much|well|just|now|one|two|some|any|all|both|each|"
    r"few|several|which|who|what|when|where|why|how|not|no|yes|too|also|only|"
    r"even|still|yet|ever|never|always|here|there|back|down|off|through|during|"
    r"before|after|above|below|between|under|without|against|within|along|across|"
    r"around|behind|beyond|per|via|plus|vs|and|or|but|so|then)$", re.I)

# 判定「像提示词」: 分镜/时间轴/参数标记
PROMPTISH = re.compile(
    r"\[?shot\s*\d|镜头\s*\d|\d+\s*[-–]\s*\d+\s*(秒|s\b|sec)|<image\d|"
    r"prompt\s*[:：]|提示词| cinematography | camera | aspect ratio | "
    r"durée|gesamtlänge|descripción|prompt de",
    re.I,
)


# ============================================================
# 公共工具
# ============================================================
def load_legit():
    """从 data/tags.yaml / data/models.yaml 读合法 slug 集合"""
    leg, ml = set(), set()
    for name, into in (("tags.yaml", leg), ("models.yaml", ml)):
        path = ROOT / "data" / name
        if not path.exists():
            continue
        for line in open(path, encoding="utf-8"):
            if line and line[0] not in " \t#":
                k = line.split(":", 1)[0].strip()
                if k:
                    into.add(k)
    return leg, ml


def draft_path(tid: str):
    """按 tweet id 找草稿文件路径（草稿按推文发布月份分目录）"""
    fs = glob.glob(str(DRAFTS / "*" / (tid + "-*.json")))
    return fs[0] if fs else None


def round_ids(date: str, hour: str):
    """从 cron.log 里取某一轮落盘的 tweet id（按 `[DATE HH:MM:SS] [INFO]   ✓ <id>:` 匹配）"""
    if not LOG_FILE.exists():
        return []
    log = LOG_FILE.read_text(encoding="utf-8", errors="ignore")
    pat = re.compile(r"\[" + re.escape(date) + r" " + re.escape(hour) +
                     r":[0-9]{2}:\d\d\] \[INFO\]   ✓ (\d+):")
    ids = []
    for i in pat.findall(log):
        if i not in ids:
            ids.append(i)
    return ids


def model_in(text):
    """text 里出现的模型名(整词), 没命中返回 None"""
    low = text.lower()
    for mn in MODEL_NAMES:
        if re.search(r"(?<![A-Za-z0-9])" + re.escape(mn) + r"(?![A-Za-z0-9])", low):
            return mn
    return None


def apply_description(d, spec):
    """按 spec 应用 description 变更, 就地改 d。返回变更备注列表。

    - spec["description"]      → 整段替换
    - spec["recovered_prompt"] → 追加到末尾(带溯源 marker, 幂等)
    """
    notes = []
    if "description" in spec:
        d["description"] = spec["description"]
        notes.append("description 整段替换")
    rp = spec.get("recovered_prompt")
    if rp:
        cur_desc = d.get("description") or ""
        if RECOVERED_MARKER in cur_desc:
            notes.append("已含 recovered marker —— 不重复追加")
        else:
            ids = ", ".join(str(x) for x in (spec.get("recovered_from") or [])) or "unknown"
            d["description"] = (cur_desc.rstrip() + "\n\n" +
                                RECOVERED_TEMPLATE.format(ids=ids) + "\n" + rp.strip()).strip()
            notes.append(f"追加 recovered_prompt (from={ids})")
    return notes


def refresh_snapshot() -> tuple[int, int]:
    """把当前库的人工标题/标签刷进 manual_titles_snapshot.json。

    schema 固定: {文件名: {"title": ..., "tags": [...]}}
    (写成 {文件名: "title"} 会产生几百条假阳性)
    """
    snap = {}
    for p in glob.glob(str(DRAFTS / "*" / "*.json")):
        fn = os.path.basename(p)
        try:
            d = json.load(open(p, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        snap[fn] = {"title": (d.get("title") or "").strip(), "tags": list(d.get("tags") or [])}

    old = {}
    if SNAPSHOT.exists():
        try:
            old = json.load(open(SNAPSHOT, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            old = {}

    LOGS.mkdir(parents=True, exist_ok=True)
    json.dump(snap, open(SNAPSHOT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return len(old), len(snap)


# ============================================================
# review —— 取证
# ============================================================
def parse_time(s: str) -> datetime:
    """解析 X 的 created_at；解析不出来就排到最后（不要用字符串排序）。"""
    s = (s or "").strip()
    for fmt in ("%a %b %d %H:%M:%S %z %Y", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return datetime.max


def run_opencli(args: list[str], timeout: int) -> tuple[int, str, str]:
    """跑 opencli，超时 killpg 整组。返回 (rc, stdout, stderr)；超时 rc=124。"""
    proc = subprocess.Popen(
        ["opencli", "twitter"] + args,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError, OSError):
            proc.kill()
        try:
            out, err = proc.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            out, err = "", ""
        return 124, out, err
    return proc.returncode, out, err


def unwrap_json(raw: str):
    """opencli 两种输出形态（裸数组 / {"ok":true,"data":…}）+ 尾部提示行 → 取 payload。"""
    start = min((i for i, ch in enumerate(raw) if ch in "[{"), default=0)
    obj, _ = json.JSONDecoder().raw_decode(raw, start)
    if isinstance(obj, dict) and obj.get("ok") is True and "data" in obj:
        return obj["data"]
    return obj


def author_replies(data: list) -> tuple[str | None, list]:
    """作者自回复：作者 == 首条作者 且 id != 首条 id，按真实时间升序。"""
    if not data:
        return None, []
    author = data[0].get("author")
    root_id = data[0].get("id")
    replies = [
        r for r in data
        if r.get("author") == author and r.get("id") != root_id
    ]
    replies.sort(key=lambda r: parse_time(r.get("created_at", "")))
    return author, replies


def fetch_thread(tid: str, out: Path, limit: int, session: str, timeout: int) -> list | None:
    """抓一条线程的作者自回复，落 <out>/<tid>.json（已存在则跳过 → 可断点续跑）。"""
    dest = out / f"{tid}.json"
    if dest.exists():
        try:
            data = json.loads(dest.read_text(encoding="utf-8"))
            print(f"CACHED {tid}", flush=True)
            return data
        except Exception:  # noqa: BLE001  半截文件 → 重抓
            dest.unlink(missing_ok=True)

    rc, stdout, stderr = run_opencli(
        ["thread", tid, "--site-session", session, "--limit", str(limit), "-f", "json"],
        timeout,
    )
    if rc != 0:
        print(f"FAIL   {tid}: rc={rc} {stderr.strip()[:120]}", flush=True)
        return None
    try:
        data = unwrap_json(stdout.strip())
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL   {tid}: JSON 解析 {exc}", flush=True)
        return None
    if not isinstance(data, list):
        print(f"FAIL   {tid}: payload 不是数组 ({type(data).__name__})", flush=True)
        return None

    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def show_thread(tid: str, data: list, n: int) -> None:
    """打印某条线程的作者自回复摘要（含草稿正文长度对照）。"""
    author, replies = author_replies(data)
    draft = draft_path(tid)
    desc = ""
    if draft:
        try:
            desc = json.loads(Path(draft).read_text(encoding="utf-8")).get("description") or ""
        except Exception:  # noqa: BLE001
            desc = ""
    print(f"=== {tid}  @{author}")
    print(f"    草稿: {os.path.basename(draft) if draft else 'MISSING'}  (正文 {len(desc.strip())} 字)")
    print(f"    自回复 {len(replies)} 条，按真实时间排序后最早 {min(n, len(replies))} 条：")
    for r in replies[:n]:
        text = r.get("text", "") or ""
        if PROMPTISH.search(text) and len(text) > 200:
            flag = "含提示词"
        elif len(text) <= 120:
            flag = "短"
        else:
            flag = "无提示特征"
        print(f"      - {r.get('id')} {r.get('created_at')} {len(text)}字 [{flag}]")
    big = [
        r for r in replies
        if PROMPTISH.search(r.get("text", "") or "") and len(r.get("text", "") or "") > 200
    ]
    if big:
        print(f"    >> 可还原：{len(big)} 条，最长 {max(len(r['text']) for r in big)} 字")
        print(f"       最早: {big[0]['id']} 片段预览: {big[0]['text'][:160]!r}")
    print()


def extract_frames(ids: list[str], out: str, times: list[float], width: int,
                   montage: bool, tile: str) -> None:
    """按 tweet id 批量抽帧 + 拼 montage（内容定性闸门取证）。

    素材路径严格由草稿的 video/image 字段推导 = static/_drafts + 字段值.lstrip('/')。
    """
    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(out, exist_ok=True)

    # magick 冷启动 ~31s, 先预热, 否则第一次 montage 调用会超时
    try:
        subprocess.run(["magick", "-version"], capture_output=True, timeout=180)
    except Exception as e:  # noqa: BLE001
        print(f"[warn] magick warmup failed: {e}")

    made = []
    for idx, tid in enumerate(ids, 1):
        fs = glob.glob(str(DRAFTS / "*" / (tid + "-*.json")))
        if not fs:
            print(f"[skip] {tid}: no draft")
            continue
        d = json.load(open(fs[0], encoding="utf-8"))
        rel = (d.get("video") or d.get("image") or "").lstrip("/")
        p = str(STATIC / rel)
        if not os.path.exists(p):
            print(f"[skip] {tid}: media missing {rel}")
            continue
        stem = f"{idx:02d}_{tid}"
        for t in times:
            outp = os.path.join(out, f"{stem}_t{int(t)}.jpg")
            r = subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(t), "-i", p,
                 "-frames:v", "1", "-vf", f"scale={width}:-1", outp],
                capture_output=True, text=True)
            if r.returncode == 0 and os.path.exists(outp):
                made.append(outp)
            else:
                # 短视频末尾取不到帧时回退到 0.5s
                r2 = subprocess.run(
                    ["ffmpeg", "-y", "-loglevel", "error", "-ss", "0.5", "-i", p,
                     "-frames:v", "1", "-vf", f"scale={width}:-1", outp],
                    capture_output=True, text=True)
                if r2.returncode == 0 and os.path.exists(outp):
                    made.append(outp)
        print(f"[ok] {idx:02d} {tid} -> {len([m for m in made if tid in m])} frames")

    print(f"\ntotal frames: {len(made)}  dir={out}")

    if montage and made:
        # 按 tweet 分组: 每个 tweet 取第一帧, 拼成总图
        firsts = []
        seen = set()
        for m in made:
            tid = os.path.basename(m).split("_", 1)[1].rsplit("_t", 1)[0]
            if tid not in seen:
                seen.add(tid)
                firsts.append(m)
        sheet = os.path.join(out, "sheet.jpg")
        cmd = (["magick", "montage", "-label", "%f"] + firsts +
               ["-tile", tile, "-geometry", "380x380+8+8", "-background", "#222",
                "-fill", "white", "-pointsize", "14", sheet])
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        print(f"montage: rc={r.returncode} -> {sheet}")
        if r.returncode != 0:
            print(r.stderr[-800:])


def cmd_review(args) -> int:
    ids = [x.strip() for x in (args.ids or "").split(",") if x.strip()]
    if args.date and args.hour:
        ids += round_ids(args.date, args.hour)
    ids = list(dict.fromkeys(ids))
    if not ids:
        print("!! 需要 --date+--hour 或 --ids", file=sys.stderr)
        return 1

    leg, _ = load_legit()
    print(f"# 轮次 {args.date or '-'} {args.hour or '-'}  共 {len(ids)} 条\n")
    for tid in ids:
        p = draft_path(tid)
        if not p:
            print(f"##### {tid}  <文件未找到(已被删)>")
            continue
        d = json.load(open(p, encoding="utf-8"))
        desc = d.get("description") or ""
        print(f"##### {tid}  author={d.get('author')}  date={d.get('post_date')}")
        print(f"  FILE: {os.path.basename(p)}")
        print(f"  TITLE: {d.get('title')}")
        print(f"  TAGS: {d.get('tags')}  ILLEGAL={[t for t in d.get('tags', []) if t not in leg]}")
        print(f"  MODELS: {d.get('models')}")
        print(f"  DESC({len(desc)}): {desc[:args.chars]}")
        print()

    if args.frames:
        extract_frames(ids, args.frames_out,
                       [float(x) for x in args.times.split(",") if x.strip()],
                       args.width, args.montage, args.tile)

    if args.replies:
        out = Path(args.replies_out)
        ok = fail = 0
        for n, tid in enumerate(ids, 1):
            data = fetch_thread(tid, out, args.limit, args.site_session, args.timeout)
            if data is None:
                fail += 1
                time.sleep(3)
                continue
            author, replies = author_replies(data)
            big = [r for r in replies if len(r.get("text", "") or "") > 200]
            extra = f" 最长{max(len(r['text']) for r in big)}字" if big else ""
            print(f"[{n}/{len(ids)}] OK     {tid} @{author} 线程{len(data)} 自回复{len(replies)}"
                  f" >200字:{len(big)}{extra}", flush=True)
            if args.show:
                show_thread(tid, data, args.show)
            ok += 1
            time.sleep(args.sleep)
        print(f"\n自回复抓取: 成功 {ok} 失败 {fail}  输出目录 {out}", flush=True)
    elif args.replies_report_only:
        out = Path(args.replies_out)
        files = sorted(out.glob("*.json"))
        if not files:
            print(f"!! {out} 下没有 json（先跑一次 --replies，或改 --replies-out）", file=sys.stderr)
            return 1
        for path in files:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except Exception as exc:  # noqa: BLE001
                print(f"!! {path.name} 解析失败: {exc}", file=sys.stderr)
                continue
            show_thread(path.stem, data, args.show)
    return 0


# ============================================================
# apply —— 落地
# ============================================================
def cmd_apply(args) -> int:
    cfg = json.load(open(args.config, encoding="utf-8"))
    KEEP, JUNK = cfg.get("keep", {}), cfg.get("junk", [])
    leg, ml = load_legit()

    print(f"=== 轮次 {cfg.get('round', '?')} | keep={len(KEEP)} junk={len(JUNK)} ===")

    print("\n=== 1) 改写保留条目 ===")
    for tid, spec in KEEP.items():
        p = draft_path(tid)
        if not p:
            print(f"  !! {tid} 草稿缺失")
            continue
        d = json.load(open(p, encoding="utf-8"))
        tags, models = spec["tags"], spec.get("models", [])
        bad_t = [t for t in tags if t not in leg]
        bad_m = [m for m in models if m not in ml]
        if bad_t or bad_m:
            print(f"  !! {tid} 非法 tag={bad_t} 非法 model={bad_m} —— 中止")
            return 1
        title = spec["title"]
        words = [w for w in title.replace("-", " ").replace("–", " ").replace("—", " ").replace(":", " ").split() if w]
        if not (3 <= len(words) <= 7):
            print(f"  !! {tid} 标题词数 {len(words)} 不在 3-7: {title!r}")
            return 1
        d["title"], d["tags"], d["models"] = title, tags, models
        notes = apply_description(d, spec)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"  ✓ {tid}  {title}  tags={tags} models={models}"
              + (f"  [{' / '.join(notes)}]" if notes else ""))

    print("\n=== 2) 定位待删条目 ===")
    targets = []
    for tid in JUNK:
        p = draft_path(tid)
        if not p:
            print(f"  !! {tid} 草稿缺失（可能已被删）")
            continue
        d = json.load(open(p, encoding="utf-8"))
        img = d.get("image") or ""
        media_dir = str(STATIC / os.path.dirname(img.lstrip("/")))
        targets.append((tid, p, media_dir))
        print(f"  · {tid}  draft={os.path.basename(p)}")
        print(f"      media_dir exists={os.path.isdir(media_dir)}  {media_dir}")

    all_paths = []
    for tid, p, md in targets:
        all_paths.append(p)
        if os.path.isdir(md):
            all_paths.append(md)

    print("\n=== 3) mavis-trash ===")
    if not all_paths:
        # 本轮 junk 之前已删完（配置重跑）—— 没有可删的东西, 不该当成失败
        print("  · 无待删文件（可能已删过），跳过删除步骤")
    else:
        r = subprocess.run([TRASH, "--"] + all_paths, capture_output=True, text=True)
        print(f"  rc={r.returncode}")
        if r.returncode != 0:
            print("  stdout:", r.stdout[-1500:])
            print("  stderr:", r.stderr[-1500:])
            print("  !! 删除失败，中止（不写 skip）")
            return 2
        print(f"  moved: {r.stdout.count('moved to trash')} 项")

    print("\n=== 4) 复查是否真的清掉 ===")
    bad = 0
    for tid, p, md in targets:
        de, me = os.path.exists(p), os.path.exists(md)
        if de or me:
            bad += 1
            print(f"  !! {tid} 残留 draft={de} media={me}")
    if bad == 0:
        print(f"  ✓ {len(targets)} 条全部清空")

    print("\n=== 5) 追加 skip 名单 ===")
    skip = json.load(open(SKIP, encoding="utf-8"))
    before = len(skip["ids"])
    existing = set(skip["ids"])
    added = [t for t in JUNK if t not in existing]
    skip["ids"] = list(skip["ids"]) + added
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(SKIP))
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(skip, f, ensure_ascii=False, indent=2)
    os.replace(tmp, SKIP)
    after = json.load(open(SKIP, encoding="utf-8"))
    print(f"  skip: {before} -> {len(after['ids'])}  新增 {len(added)}")
    missing = [t for t in added if t not in after["ids"]]
    print(f"  !! 竞态丢失: {missing}" if missing else "  ✓ 全部写入成功，无竞态丢失")

    print("\n=== 6) 刷新标题快照基线 ===")
    old, new = refresh_snapshot()
    print(f"  snapshot: {old} -> {new} 条")
    return 0


# ============================================================
# verify —— 校验
# ============================================================
def run_audit(cur: dict, paths: dict, limit: int = 0) -> int:
    """全库(或最近 N 条)质量审计。

    检查: 模型名混入 tag / 非法 tag / 兜底文案标题 / 标题含中日韩字符 /
          标题含模型名 / tag 稀疏(<2) / 标题悬空词结尾
    返回问题数(>0 时调用方 exit 1)。
    """
    items = list(cur.items())
    scope = "全库"
    if limit and limit > 0:
        items = sorted(items, key=lambda kv: paths.get(kv[0], (None, 0))[1], reverse=True)[:limit]
        scope = f"最近 {limit} 条"
    print(f"=== 0. 质量审计({scope}, 共 {len(items)} 条) ===")

    issues = {}
    for fn, v in items:
        title = v["title"]
        probs = []
        for t in v["tags"]:
            if t not in TAGS:
                probs.append(f"非法tag:{t}")
            mn = model_in(t)
            if mn:
                probs.append(f"tag含模型名:{t}({mn})")
        if FALLBACK.search(title):
            probs.append("兜底文案")
        if CJK.search(title):
            probs.append("标题含中日韩字符")
        mn = model_in(title)
        if mn:
            probs.append(f"标题含模型名{mn}")
        if len(v["tags"]) < 2:
            probs.append(f"tag稀疏({len(v['tags'])})")
        words = title.split()
        if words and DANGLING.match(words[-1]):
            probs.append(f"标题悬空结尾:{words[-1]}")
        for p in probs:
            issues.setdefault(p.split(":")[0], []).append((fn, p))

    total = sum(len(x) for x in issues.values())
    if not issues:
        print("  ✓ 无问题")
        return 0
    for kind, lst in sorted(issues.items(), key=lambda kv: -len(kv[1])):
        print(f"  {kind}: {len(lst)} 处")
    print("  --- 明细 ---")
    for kind, lst in sorted(issues.items()):
        for fn, p in lst[:12]:
            print(f"    {fn[:52]}: {p}")
        if len(lst) > 12:
            print(f"    … 另有 {len(lst)-12} 处")
    return total


def cmd_verify(args) -> int:
    cur = {}
    paths = {}
    for p in glob.glob(str(DRAFTS / "*" / "*.json")):
        fn = os.path.basename(p)
        try:
            paths[fn] = (p, os.path.getmtime(p))
        except OSError:
            paths[fn] = (p, 0)
        try:
            d = json.load(open(p, encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            print("PARSE FAIL", fn, e)
            continue
        cur[fn] = {"title": (d.get("title") or "").strip(), "tags": list(d.get("tags") or []),
                   "models": list(d.get("models") or []), "image": d.get("image"),
                   "video": d.get("video"), "desc": d.get("description") or ""}

    if args.audit:
        n = run_audit(cur, paths, args.audit_limit)
        print()
        print("审计问题:", n)
        return 0 if n == 0 else 1

    keep = {x.strip() for x in (args.keep or "").split(",") if x.strip()}
    junk = {x.strip() for x in (args.junk or "").split(",") if x.strip()}
    want_models = {}
    for kv in (args.models or "").split(","):
        if not kv.strip():
            continue
        k, _, v = kv.partition("=")
        want_models[k.strip()] = [x for x in v.split("|") if x]

    ROUND = {}
    if args.date and args.hour:
        for tid in round_ids(args.date, args.hour):
            p = draft_path(tid)
            if p:
                ROUND[os.path.basename(p)] = tid

    EXPECTED = [fn for fn, t in ROUND.items() if t in keep]
    JUNK = [fn for fn, t in ROUND.items() if t in junk]
    errs = 0
    print(f"库总数: {len(cur)}   snapshot 基线: {len(SNAP)}   本轮命中: {len(ROUND)}(保留 {len(EXPECTED)} / 已删 {len(JUNK)})")

    bad = {}
    for fn, v in cur.items():
        for t in v["tags"]:
            if t not in TAGS:
                bad.setdefault(t, []).append(fn)
    print(f"=== 1. 非法 tag: {sum(len(x) for x in bad.values())} 处 / {len(bad)} 个 slug ===")
    print("  Top:", ", ".join(f"{k}×{len(v)}" for k, v in sorted(bad.items(), key=lambda kv: -len(kv[1]))[:8]))

    miss = []
    for fn, v in cur.items():
        for key in ("image", "video"):
            val = v.get(key)
            if not val:
                miss.append((fn, key, "字段为空"))
                continue
            if not os.path.exists(str(ROOT / "static/_drafts" / str(val).lstrip("/"))):
                miss.append((fn, key, str(val)))
    print(f"=== 2. 素材缺失: {len(miss)} 处 ===")
    for m in miss[:8]:
        print("   ", m)

    changed = [fn for fn in sorted(set(SNAP) & set(cur))
               if SNAP[fn]["title"] != cur[fn]["title"] or list(SNAP[fn]["tags"]) != list(cur[fn]["tags"])]
    print(f"=== 3. 历史(snapshot∩库)标题/标签被改动: {len(changed)} 条 ===")
    for fn in changed[:10]:
        print(f"    {fn[:52]}: {SNAP[fn]['title']!r} -> {cur[fn]['title']!r}")

    byt = {}
    for fn, v in cur.items():
        byt.setdefault(v["title"].lower(), []).append(fn)
    dups = {t: fs for t, fs in byt.items() if len(fs) > 1}
    print(f"=== 4. 全库重复 title: {len(dups)} 组 ===")
    for t, fs in list(dups.items())[:6]:
        print(f"    {t!r}: {[x[:24] for x in fs]}")

    print("=== 5. 本轮保留项专项校验 ===")
    for fn in sorted(EXPECTED):
        v = cur.get(fn)
        tid = ROUND.get(fn, "")
        if not v:
            print(f"  x {fn} 丢失!")
            errs += 1
            continue
        w = [x for x in re.split(r"[\s\-–—:]+", v["title"]) if x]
        probs = []
        if not (3 <= len(w) <= 7):
            probs.append(f"词数{len(w)}")
        if FALLBACK.search(v["title"]):
            probs.append("兜底文案")
        if v["title"].rstrip().endswith(("-", "–", "—", ":")):
            probs.append("结尾悬空")
        mn = model_in(v["title"])
        if mn:
            probs.append(f"标题含模型名{mn}")
        if not (1 <= len(v["tags"]) <= 5):
            probs.append(f"tag数{len(v['tags'])}")
        for t in v["tags"]:
            if t not in TAGS:
                probs.append(f"非法tag:{t}")
        if want_models:
            want = want_models.get(tid, [])
            if v["models"] != want:
                probs.append(f"models{v['models']}≠期望{want}")
        for m in v["models"]:
            if m not in MODELS:
                probs.append(f"非法model:{m}")
        if not v["desc"].strip():
            probs.append("desc空")
        if probs:
            errs += 1
            print(f"  x {fn[:46]}: {', '.join(probs)}")
        else:
            print(f"  v {fn[:46]}  {v['title']!r} {v['tags']} {v['models']}")

    print("=== 6. 本轮已删条目状态(应全部不在库) ===")
    still = [fn for fn in JUNK if fn in cur]
    print(f"  已删 {len(JUNK)-len(still)}/{len(JUNK)} 条" + (f" | 仍在库: {still}" if still else " | 全部已不在库"))
    errs += len(still)
    leftover = []
    for tid in junk:
        for d in glob.glob(str(STATIC / "prompts" / "*" / (tid + "-*"))):
            leftover.append(d)
    print(f"  残留素材目录: {len(leftover)} 个")
    for d in leftover[:8]:
        print(f"    x {d}")
        errs += 1

    print("=== 7. skip 名单 ===")
    sk = json.load(open(SKIP, encoding="utf-8"))
    sids = set(sk.get("ids") or [])
    missing = sorted(junk - sids)
    print(f"  skip ids 共 {len(sids)} 条; 本轮已删未入名单: {missing if missing else '无'}")
    errs += len(missing)

    print()
    print("总错误:", errs)
    return 0 if errs == 0 else 1


# ============================================================
# ledger —— 垃圾台账 + 规则回测基准
# ============================================================
def slugify(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


# ---------------------------------------------------------------- 标注集
def _dict_blocks(txt, name):
    """按 { } 配对精确切出 `<name> = { ... }` 的块。

    JSONL 里 Write 工具的内容是转义字符串(引号是 \\\"、换行是字面 \\n),
    但花括号仍是字面量, 所以可以直接配对切块。
    """
    out = []
    for m in re.finditer(re.escape(name) + r"\s*=\s*\{", txt):
        i = txt.index("{", m.start())
        depth = 0
        for j in range(i, len(txt)):
            if txt[j] == "{":
                depth += 1
            elif txt[j] == "}":
                depth -= 1
                if depth == 0:
                    out.append(txt[i:j + 1])
                    break
    return out


def recover_labels():
    """从会话历史恢复标注集。

    NEG = 历轮 delete_*.py 的 DELETE 字典 + fix_titles_*.py 的 JUNK_TITLE_FIXES/JUNK_TAG_FIXES 字典
    POS = 历轮 fix_titles_*.py 的 FIXES 字典

    ⚠️ 必须按字典块精确解析: 早期用 `"id": [` 全局匹配, 会把 verify_*.py 的
    EXPECTED_MODELS(值也是列表)误当成 NEG, 导致保留项被标成垃圾。
    """
    files = [os.path.join(SESSION_DIR, "messages.jsonl")]
    files += sorted(glob.glob(os.path.join(SESSION_DIR, "snapshots/*.jsonl")))
    neg, pos = set(), set()
    for f in files:
        if not os.path.exists(f):
            continue
        try:
            txt = open(f, encoding="utf-8", errors="ignore").read()
        except OSError:
            continue
        if "fix_titles" not in txt and "delete_" not in txt:
            continue
        for n in ("DELETE", "JUNK_TITLE_FIXES", "JUNK_TAG_FIXES", "JUNK_FIXES"):
            for seg in _dict_blocks(txt, n):
                neg |= set(re.findall(r'\\"(\d{18,20})\\"', seg))
        for seg in _dict_blocks(txt, "FIXES"):
            pos |= set(re.findall(r'\\"(\d{18,20})\\"', seg))
    pos -= neg
    return {"neg": sorted(neg), "pos": sorted(pos)}


def load_labels():
    if os.path.exists(LABELS):
        try:
            data = json.load(open(LABELS, encoding="utf-8"))
            if data.get("neg") is not None and data.get("pos") is not None:
                return data, "logs/x_timeline_cron/labels.json"
        except Exception:
            pass
    data = recover_labels()
    return data, "会话历史恢复"


def prior_junk_ids():
    """上一版台账里 labeled_junk 的 tweet_id —— 早期轮次「判垃圾但没真删、仍留在库」的条目。

    这些条目的判定脚本已不在会话目录里, 只能从台账本身捞回来。
    """
    out = set()
    if os.path.exists(LEDGER):
        try:
            cur = json.load(open(LEDGER, encoding="utf-8"))
            for e in cur.get("labeled_junk") or []:
                if e.get("tweet_id"):
                    out.add(e["tweet_id"])
        except Exception:
            pass
    return out


# ---------------------------------------------------------------- 扫库
def scan_library():
    lib = {}
    for p in sorted(glob.glob(os.path.join(ROOT, "content/_drafts/prompts/*/*.json"))):
        fn = os.path.basename(p)
        try:
            d = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        m = re.match(r"(\d{18,20})-", fn)
        tid = m.group(1) if m else ""
        title = (d.get("title") or "").strip()
        # 自动标题判定: 文件名 slug 是采集器按当时的 title 生成的
        # 人工改写过 title 就会与 slug 对不上
        auto = bool(tid) and fn.startswith(tid + "-") and \
            fn[len(tid) + 1:-len(".json")] == slugify(title)[:40]
        lib[fn] = {
            "file": fn, "path": os.path.relpath(p, ROOT), "tweet_id": tid,
            "author": d.get("author") or "", "title": title,
            "auto_title": auto,
            "desc": d.get("description") or "",
            "desc_len": len(d.get("description") or ""),
            "desc_head": (d.get("description") or "")[:220],
        }
    return lib


def compile_rules(bench):
    rules = bench["final_ruleset"]["rules"]
    exempt = re.compile(bench["final_ruleset"]["exemption_pattern"], re.I)
    return {k: re.compile(v, re.I) for k, v in rules.items()}, exempt, rules


def entry(lib, fn, hit_rules, exempt):
    e = dict(lib[fn])
    e.pop("desc", None)
    e["confidence"] = "HIGH" if e.get("_labeled") else "RULE"
    e["rules"] = hit_rules
    e["exempt"] = exempt
    return e


def cmd_ledger(args) -> int:
    bench = json.load(open(BENCH, encoding="utf-8"))
    rules, exempt_re, rule_src = compile_rules(bench)
    labels, src = load_labels()
    lib = scan_library()

    skip_ids = set(json.load(open(SKIP, encoding="utf-8")).get("ids") or [])
    neg = set(labels.get("neg") or []) | skip_ids | prior_junk_ids()
    pos = set(labels.get("pos") or []) - neg

    by_tid = {v["tweet_id"]: k for k, v in lib.items() if v["tweet_id"]}

    buckets = {"hand_titled_ok": 0, "auto_never_reviewed": 0, "rule_flagged": 0, "labeled_junk": 0}
    labeled_junk, rule_flagged = [], []
    neg_hit = neg_miss = 0
    pos_hit = pos_miss = 0
    fp_hits = []

    for fn, v in lib.items():
        tid = v["tweet_id"]
        text = v["desc"]
        hit = sorted(k for k, rx in rules.items() if rx.search(text))
        is_exempt = bool(exempt_re.search(text))
        is_neg = tid in neg
        is_pos = tid in pos

        if is_neg:
            neg_miss += 1
            if hit:
                neg_hit += 1
            buckets["labeled_junk"] += 1
            e = entry(lib, fn, hit, is_exempt)
            e["confidence"] = "HIGH"
            labeled_junk.append(e)
            continue
        if hit and not is_exempt:
            buckets["rule_flagged"] += 1
            e = entry(lib, fn, hit, False)
            e["confidence"] = "RULE"
            rule_flagged.append(e)
            if is_pos:
                pos_hit += 1
                fp_hits.append(fn)
            continue
        if is_pos:
            pos_miss += 1
        buckets["auto_never_reviewed" if v["auto_title"] else "hand_titled_ok"] += 1

    total = len(lib)
    neg_in_lib = buckets["labeled_junk"]
    pos_in_lib = sum(1 for tid in pos if tid in by_tid)
    tp = neg_hit
    fp = pos_hit
    prec = (tp / (tp + fp) * 100) if (tp + fp) else 0.0
    rec = (neg_hit / neg_in_lib * 100) if neg_in_lib else 0.0
    fpp = (fp / pos_in_lib * 100) if pos_in_lib else 0.0

    print(f"库总数: {total}")
    print(f"标注集来源: {src}   NEG 全集 {len(neg)} / POS 全集 {len(pos)}")
    print(f"NEG 在库: {neg_in_lib}   POS 在库: {pos_in_lib}")
    print(f"recall NEG  {rec:.1f}% ({neg_hit}/{neg_in_lib})")
    print(f"FP on POS   {fpp:.1f}% ({fp}/{pos_in_lib})")
    print(f"precision   {prec:.1f}%")
    print("buckets:", json.dumps(buckets, ensure_ascii=False))

    if args.check:
        cur = json.load(open(LEDGER, encoding="utf-8"))
        print("\n现有台账 buckets:", json.dumps(cur.get("buckets"), ensure_ascii=False))
        print("本次  buckets  :", json.dumps(buckets, ensure_ascii=False))
        old_rf = {e["file"] for e in cur.get("rule_flagged", [])}
        new_rf = {e["file"] for e in rule_flagged}
        print(f"\nrule_flagged 现有 {len(old_rf)} / 本次 {len(new_rf)}")
        print("  现有但本次没命中(新增或规则实现差异):", sorted(old_rf - new_rf)[:10])
        print("  本次新增命中:", sorted(new_rf - old_rf)[:10])
        return 0

    now = datetime.now().isoformat(timespec="seconds")
    ledger = {
        "generated_at": now,
        "total_drafts": total,
        "note": "这是清单，不是删除操作。所有条目一律保留，等待用户裁决。",
        "ruleset": bench["final_ruleset"]["name"],
        "buckets": buckets,
        "labeled_junk": labeled_junk,
        "rule_flagged": rule_flagged,
    }
    for path, obj in ((LEDGER, ledger),):
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".rebuild_", suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        os.replace(tmp, path)
    print("written:", os.path.relpath(LEDGER, ROOT))

    # 标注集持久化(以后不再依赖 /tmp)
    labels_out = {
        "generated_at": now,
        "neg": sorted(neg),
        "pos": sorted(pos),
        "note": "NEG=人工判垃圾(含 skip.json 真删过的); POS=人工判保留。2026-10-23 04:00 轮从会话历史恢复后持久化。",
    }
    fd, tmp = tempfile.mkstemp(dir=LOGS, prefix=".labels_", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(labels_out, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    os.replace(tmp, LABELS)
    print("written:", os.path.relpath(LABELS, ROOT))

    # ---- benchmark: 只更新 metrics_current 与 round_validation, 规则集与候选提案一字不动 ----
    bench["generated_at"] = now
    bench["final_ruleset"]["metrics_current"] = {
        "recall_neg": f"{rec:.1f}% ({neg_hit}/{neg_in_lib})",
        "false_pos_pos": f"{fpp:.1f}% ({fp}/{pos_in_lib})",
        "precision": f"{prec:.1f}%",
        "labeled_set": f"NEG {neg_in_lib} / POS {pos_in_lib}（当前库内）",
    }
    bench["methodology"]["labeled_neg"] = len(neg)
    bench["methodology"]["labeled_pos"] = len(pos)
    bench["methodology"]["neg_source"] = (
        "历轮 delete_*.py 的 DELETE + fix_titles_*.py 的 JUNK_* 字典(从会话历史按字典块精确提取)"
        " ∪ skip.json(真删过的) ∪ 上一版台账 labeled_junk(早期判垃圾但没真删、仍在库的)")
    bench["methodology"]["pos_source"] = "历轮 fix_titles_*.py 的 FIXES 字典(人工判保留)"
    bench["methodology"]["note"] = (
        "标注集已持久化到 logs/x_timeline_cron/labels.json(2026-10-23 04:00 轮从会话历史恢复; "
        "此前放在 /tmp/labels.json, /tmp 被清空后丢失)。"
        "标注集是『已通过 looks_like_has_prompt』的条件样本, 所以现有筛子在本集上必然 100% 放行 —— "
        "这正是垃圾帖能进来的原因。")
    rnd = args.round
    if rnd:
        rv_entry = {"round": rnd, "candidates": (args.candidates or 0),
                    "junk": (args.junk or 0), "good": (args.good or 0),
                    "caught": (args.caught or "")}
        rv = bench.setdefault("round_validation", [])
        rv[:] = [x for x in rv if x.get("round") != rnd]
        rv.append(rv_entry)
        bench["round_validation"] = rv
    fd, tmp = tempfile.mkstemp(dir=LOGS, prefix=".bench_", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(bench, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    os.replace(tmp, BENCH)
    print("written:", os.path.relpath(BENCH, ROOT), "(metrics_current + round_validation 已更新)")
    return 0



# ============================================================
# CLI
# ============================================================
def main() -> int:
    global TAGS, MODELS, SNAP

    ap = argparse.ArgumentParser(
        description="提取线统一入口：review 取证 / apply 落地 / verify 校验 / snapshot 刷基线")
    sub = ap.add_subparsers(dest="cmd", required=True)

    # ---- review ----
    rv = sub.add_parser("review", help="取证：导出本轮正文（可抽帧 / 抓作者自回复）")
    rv.add_argument("--date", default="", help="YYYY-MM-DD")
    rv.add_argument("--hour", default="", help="HH，例如 06")
    rv.add_argument("--ids", default="", help="逗号分隔的 tweet id")
    rv.add_argument("--chars", type=int, default=1400, help="正文截断长度")
    rv.add_argument("--frames", action="store_true", help="同时抽帧（判断产出是不是 AI 视频）")
    rv.add_argument("--frames-out", default="/tmp/prompts_frames", help="抽帧输出目录")
    rv.add_argument("--times", default="2,6,10", help="抽帧秒数，逗号分隔")
    rv.add_argument("--width", type=int, default=400)
    rv.add_argument("--montage", action="store_true", help="额外拼一张 montage 总图")
    rv.add_argument("--tile", default="4x3")
    rv.add_argument("--replies", action="store_true", help="抓作者自回复（联网）")
    rv.add_argument("--replies-report-only", action="store_true", help="只汇总已有自回复结果（不联网）")
    rv.add_argument("--replies-out", default="/tmp/thread_replies", help="自回复输出目录")
    rv.add_argument("--limit", type=int, default=120, help="线程抓取条数上限（默认 120；50 会静默截断）")
    rv.add_argument("--site-session", default="persistent", help="opencli 会话模式 persistent|ephemeral")
    rv.add_argument("--timeout", type=int, default=120, help="单条 opencli 超时秒数")
    rv.add_argument("--sleep", type=float, default=2.0, help="条间间隔秒数")
    rv.add_argument("--show", type=int, default=5, help="每条打印最早 N 条自回复（0=不打印）")
    rv.set_defaults(func=cmd_review)

    # ---- apply ----
    ap_apply = sub.add_parser("apply", help="落地：改写 + 删除 + skip（结束自动刷快照）")
    ap_apply.add_argument("config", help="配置 JSON 路径")
    ap_apply.set_defaults(func=cmd_apply)

    # ---- verify ----
    vf = sub.add_parser("verify", help="校验：本轮专项 + 全库审计")
    vf.add_argument("--date", default="", help="YYYY-MM-DD（本轮）")
    vf.add_argument("--hour", default="", help="HH（本轮）")
    vf.add_argument("--keep", default="", help="逗号分隔的保留项 id")
    vf.add_argument("--junk", default="", help="逗号分隔的已删项 id")
    vf.add_argument("--models", default="", help="期望 models，格式 id=slug1|slug2（省略 id 表示期望 []）")
    vf.add_argument("--audit", action="store_true", help="全库质量审计")
    vf.add_argument("--audit-limit", type=int, default=0, help="只审计最近 N 条（按 mtime）")
    vf.set_defaults(func=cmd_verify)

    # ---- snapshot ----
    sn = sub.add_parser("snapshot", help="刷新 manual_titles_snapshot.json（从当前库重扫）")
    sn.set_defaults(func=lambda _a: (lambda r: (print(f"snapshot: {r[0]} -> {r[1]} 条"), 0)[1])(refresh_snapshot()))

    # ---- ledger ----
    lg = sub.add_parser("ledger", help="重建垃圾台账 + 规则回测基准")
    lg.add_argument("--check", action="store_true", help="只对比现有台账，不写")
    lg.add_argument("--round", default="", help="记录本轮验证（例 2026-10-23-06）")
    lg.add_argument("--candidates", type=int, default=0)
    lg.add_argument("--junk", type=int, default=0)
    lg.add_argument("--good", type=int, default=0)
    lg.add_argument("--caught", default="", help="本轮规则抓到的 id，逗号分隔")
    lg.set_defaults(func=cmd_ledger)

    args = ap.parse_args()

    TAGS, MODELS = load_legit()
    try:
        SNAP = json.load(open(SNAPSHOT, encoding="utf-8"))
    except Exception:  # noqa: BLE001
        SNAP = {}

    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
