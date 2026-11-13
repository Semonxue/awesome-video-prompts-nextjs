#!/usr/bin/env python3
"""recover_via_timeline —— 从作者时间线取回**完整**的长推文正文。

背景（2026-11-13 实测）：
  X 的长推文（Note Tweet）正文超过 280 字时：
  - TweetDetail 端点（`opencli twitter thread <id>`）返回 **空数组** 或 **被截断到 ~300 字**的正文
  - Timeline 端点（`opencli twitter tweets <handle>`）返回的是 **完整正文**（实测 2000+ 字）
  → 草稿里那些 len≈300、正文突然断在 t.co 媒体链接处的条目，提示词其实就在长推文里，
    只是 TweetDetail 那条路取不到。

用法：
  python3 tools/recover_via_timeline.py --ids-file /tmp/ids.txt --out /tmp/tl_full
  python3 tools/recover_via_timeline.py --ids 2095105121017630720 --out /tmp/tl_full

匹配方式（两级）：
  1. id 精确匹配：时间线里能找到该 tweet id → 直接用它的完整 text
  2. 文本前缀匹配：找不到 id 时，用草稿 description 去掉尾部 t.co 后的前 ~120 字
     作前缀，去时间线里找同开头的那条（X 长推文常见于作者把同题材重发/引用）

输出：<out>/<tid>.json  {"text": "<完整正文>", "id": ..., "author": ..., "source": "id"|"prefix"}
之后用 `python3 tools/prompts.py recover --replies-out <out>` 落地 —— 但注意
recover 读的是 thread 格式（数组），本工具写的是单对象，故落地走
`--full-text` 分支（见 prompts.py recover 的兼容处理）。

只读网络 + 只写指定 out 目录，不改仓库任何内容。
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DRAFTS = ROOT / "content/_drafts/prompts"
# X handle 规则：1-15 位，字母数字下划线 + 连字符
# ⚠️ 连字符必须允许 —— 'simeon-sanai' 是合法 handle，早期用 [A-Za-z0-9_]{1,15} 会误杀
HANDLE = re.compile(r"^[A-Za-z0-9_]{1,15}(?:-[A-Za-z0-9_]{1,15})?$")
TCO = re.compile(r"https?://t\.co/\S+")


def _norm(s: str) -> str:
    """归一化正文用于比对：去掉 t.co 媒体链接与所有空白。

    长推文里媒体链接（t.co）的位置在不同端点不一致，草稿是截断版、
    全文版里 t.co 可能在中间 → 直接 startswith 会失败，先归一化再比。
    """
    return re.sub(r"\s+", "", TCO.sub("", s or ""))


def search_full_text(keyword: str, session: str, timeout: int, desc_prefix: str = "",
                     expect_ids: list[str] | None = None) -> dict | None:
    """用正文特征词搜索，直接取回**完整长推文正文**。

    ⚠️ 匹配必须严格（2026-11-13 踩坑）：Search 返回的是"相关推文"不是"同一条推文"。
    早先版本在严格匹配失败时 fallback 到"结果里最长的一条"，
    结果 15 条里有 8 条抓成了完全无关的推文（'Creating ads was never easier…'）。
    → 现在只接受：① id 精确命中；② 归一化后前缀 60 字完全一致。
    """
    kw = " ".join(keyword.split()[:8])
    if len(kw) < 12:
        return None
    cmd = ["opencli", "twitter", "search", kw, "--site-session", session,
           "--limit", "10", "-f", "json"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None
    if proc.returncode != 0 or not proc.stdout.strip():
        return None
    try:
        obj = json.loads(proc.stdout.strip())
    except Exception:  # noqa: BLE001
        return None
    data = obj.get("data") if isinstance(obj, dict) else obj
    if not isinstance(data, list) or not data:
        return None

    want = {str(x) for x in (expect_ids or [])}
    target_norm = _norm(desc_prefix)

    # ① id 精确命中
    for x in data:
        if str(x.get("id")) in want:
            text = x.get("text") or ""
            if len(text) >= 200:
                return {"id": x.get("id"), "author": x.get("author"), "text": text}

    # ② 归一化前缀严格一致（前 60 字）
    if len(target_norm) >= 40:
        key = target_norm[:60]
        for x in data:
            text = x.get("text") or ""
            if len(text) >= 200 and _norm(text)[:60] == key:
                return {"id": x.get("id"), "author": x.get("author"), "text": text}

    return None


def draft_path(tid: str) -> Path | None:
    for p in DRAFTS.glob("*/*.json"):
        if p.name.startswith(tid + "-"):
            return p
    return None


def run_timeline(handle: str, limit: int, session: str, timeout: int) -> list:
    cmd = ["opencli", "twitter", "tweets", handle, "--site-session", session,
           "--limit", str(limit), "-f", "json"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        print(f"  TIMEOUT @{handle} limit={limit}", flush=True)
        return []
    out = proc.stdout.strip()
    if proc.returncode != 0 or not out:
        print(f"  FAIL @{handle} rc={proc.returncode} {proc.stderr.strip()[:150]}", flush=True)
        return []
    try:
        obj = json.loads(out)
    except Exception as exc:  # noqa: BLE001
        print(f"  FAIL @{handle} JSON {exc}", flush=True)
        return []
    data = obj.get("data") if isinstance(obj, dict) else obj
    return data if isinstance(data, list) else []


def build_author_handle_map(replies_dir: Path) -> dict:
    """草稿 author（可能是显示名）→ X handle 的映射。

    草稿 author 是采集期写的显示名（'Zephyra Leigh' / 'Pierrick Chevallier | IA'），
    有时也是 handle。显示名不能直接喂给 `opencli twitter tweets`（rc=2 ARGUMENT）。
    映射来源：已抓到的 thread 数据里 data[0]['author'] 才是真正的 handle，
    同一显示名往往对应多条草稿 → 用同显示名的其他条目交叉反查。
    """
    m = {}
    for p in DRAFTS.glob("*/*.json"):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        name = (d.get("author") or "").strip()
        tid = p.name.split("-")[0]
        src = replies_dir / f"{tid}.json"
        if not name or not src.exists():
            continue
        try:
            data = json.loads(src.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        if isinstance(data, list) and data:
            h = data[0].get("author")
            if h and HANDLE.match(h):
                m.setdefault(name, h)
        elif isinstance(data, dict) and data.get("author"):
            h = data["author"]
            if HANDLE.match(h):
                m.setdefault(name, h)
    return m


def resolve_handle(tid: str, author: str, out: Path, author_map: dict) -> str | None:
    """作者显示名 → X handle。"""
    if author and HANDLE.match(author.lstrip("@")):
        return author.lstrip("@")
    if author_map:
        h = author_map.get(author.strip())
        if h:
            return h
    p = draft_path(tid)
    if p:
        d = json.loads(p.read_text(encoding="utf-8"))
        url = d.get("source_url") or ""
        m = re.search(r"x\.com/([A-Za-z0-9_]{1,15})/status/", url)
        if m and m.group(1).lower() != "i":
            return m.group(1)
    return None


def source_ids(tid: str) -> list[str]:
    """草稿可能指向的原始推文 id（去重、保持顺序）。

    ⚠️ 关键（2026-11-13 实测）：草稿文件名里的 id 与 source_url 里的 id **可能不同**。
    例：文件 2094772683519279104 的 source_url 是 x.com/i/status/2094772953003311105，
    而真正承载提示词的长推文是后者的完整版（3279 字），前者只有 301 字截断版。
    → 两个 id 都要拿去匹配。
    """
    ids = [tid]
    p = draft_path(tid)
    if p:
        d = json.loads(p.read_text(encoding="utf-8"))
        url = d.get("source_url") or ""
        m = re.search(r"/status/(\d{10,25})", url)
        if m and m.group(1) not in ids:
            ids.append(m.group(1))
    return ids


def prefix_of(desc: str) -> str:
    """取正文的前缀特征（去掉尾部 t.co 媒体链接，取前 120 字）。"""
    d = TCO.sub("", desc).strip()
    return d[:120]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", default="")
    ap.add_argument("--ids-file", default="")
    ap.add_argument("--out", default="/tmp/tl_full")
    ap.add_argument("--timeline-limit", type=int, default=1200)
    ap.add_argument("--site-session", default="persistent")
    ap.add_argument("--timeout", type=int, default=300)
    ap.add_argument("--sleep", type=float, default=8.0)
    ap.add_argument("--replies-dir", default="/tmp/thread_replies")
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
    replies_dir = Path(args.replies_dir)
    author_map = build_author_handle_map(replies_dir)

    # 1) 先走 search（不占 TweetDetail/时间线配额），落空的再走时间线
    ok = miss = 0
    pending = []          # 需要走时间线的 (tid, handle, prefix)
    for tid in ids:
        p = draft_path(tid)
        if not p:
            print(f"  -- {tid} 草稿缺失")
            continue
        d = json.loads(p.read_text(encoding="utf-8"))
        desc = d.get("description") or ""
        pref = prefix_of(desc)

        hit = search_full_text(pref, args.site_session, args.timeout, pref, source_ids(tid))
        if hit:
            rec = dict(hit, source="search", matched_tid=tid, expect_ids=source_ids(tid))
            (out / f"{tid}.json").write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"  ✓ {tid} → {hit.get('id')} len={len(hit['text'])} [search]")
            ok += 1
            time.sleep(args.sleep)
            continue

        handle = resolve_handle(tid, d.get("author") or "", out, author_map)
        if not handle:
            print(f"  -- {tid} search 未命中且 author={d.get('author')!r} 不是 handle")
            miss += 1
            continue
        pending.append((tid, handle, pref))

    # 2) search 没命中的 → 按作者分组拉时间线
    by_author = {}
    for tid, handle, pref in pending:
        by_author.setdefault(handle, []).append((tid, pref))

    for handle, items in by_author.items():
        print(f"\n=== @{handle}  目标 {len(items)} 条", flush=True)
        tl = run_timeline(handle, args.timeline_limit, args.site_session, args.timeout)
        if not tl:
            miss += len(items)
            continue
        by_id = {t.get("id"): t for t in tl}
        for tid, pref in items:
            # 优先按 id 匹配（文件名 id 与 source_url id 都试）
            t = None
            source = "id"
            for cand_id in source_ids(tid):
                if cand_id in by_id:
                    t = by_id[cand_id]
                    source = "id:" + cand_id
                    break
            if t is None and pref:
                # 前缀匹配：归一化后前 60 字完全一致（严格，避免抓到"相似但不同"的推文）
                key = _norm(pref)[:60]
                cands = [x for x in tl
                         if len(key) >= 40 and _norm(x.get("text") or "")[:60] == key]
                if cands:
                    t = max(cands, key=lambda x: len(x.get("text") or ""))
                    source = "prefix"
            if t is None:
                print(f"  -- {tid} 时间线里没找到（id 与前缀都没命中）")
                miss += 1
                continue
            text = t.get("text") or ""
            if len(text) < 200:
                print(f"  -- {tid} 时间线正文仅 {len(text)} 字，不足以补全")
                miss += 1
                continue
            rec = {"id": t.get("id"), "author": t.get("author"),
                   "text": text, "source": source, "matched_tid": tid,
                   "expect_ids": source_ids(tid)}
            (out / f"{tid}.json").write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"  ✓ {tid} → {t.get('id')} len={len(text)} [{source}]")
            ok += 1
        time.sleep(args.sleep)

    print(f"\n时间线取全文: 成功 {ok} 失败 {miss}  → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
