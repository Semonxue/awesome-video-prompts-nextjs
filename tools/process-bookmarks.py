#!/usr/bin/env python3
"""
处理已下载的 X bookmarks：分析 info.json → 压缩素材 → 写 draft JSON → 清理 temp

流程：
  1. 读 temp/<TWEET_ID>/info.json
  2. 抽 post_date (YYYY-MM-DD, YYYY-MM), text, author
  3. 生成 slug: <TWEET_ID>-kebab-description
  4. 压缩 cover.jpg (长边<=600, 60% jpg, <=30k)
  5. 复制 video.mp4 (preview_480p)
  6. 写 content/_drafts/prompts/<YYYY-MM>/<slug>.json
  7. 复制资源到 static/_drafts/prompts/<YYYY-MM>/<slug>/
  8. 清理 temp/<TWEET_ID>/
  9. 写 summary.json 给后续 unbookmark 步骤用

metadata 启发式：
  - title: 文本开头找最前面 3-7 词
  - model: 文本里搜 seedance/veo/kling/sora/... → models.yaml slug
  - tags: 文本里搜 cinematic/animation/nature/... → tags.yaml
  - description: 完整 text（多行）
"""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import List, Optional, Tuple  # Py3.8 compat: list[str] / str|None / tuple[str,str] 都不在 3.8 runtime 求值

ROOT = Path("/Users/semonxue/Workplace/Works/ai-dev/awesome-video-prompts-nextjs")
TEMP_DIR = ROOT / "temp"
DRAFT_CONTENT_DIR = ROOT / "content/_drafts/prompts"
DRAFT_STATIC_DIR = ROOT / "static/_drafts/prompts"

# 读模型表（slug → name）
MODELS_YAML = ROOT / "data/models.yaml"
TAGS_YAML = ROOT / "data/tags.yaml"

# 关键词 → slug 映射（key 必须在文本中能匹配到，slug 必须在 models.yaml 里）
MODEL_KEYWORDS = {
    "seedance 2.5": "seedance25",
    "seedance 2": "seedance2",
    "seedance": "seedance2",  # 默认 fallback
    "veo 3": "veo3",
    "veo": "veo3",
    "kling o1": "klingo1",
    "kling 3": "kling3",
    "kling 2.6": "kling26",
    "kling": "kling26",
    "sora 2": "sora2",
    "sora": "sora",
    "hailuo": "hailuo",
    "wan 2.7": "wan27",
    "wan 2.6": "wan26",
    "wan": "wan26",
    "minimax h3": "minimaxh3",
    "h3": "minimaxh3",
    "hunyuan": "hunyuan",
    "ray 3.14": "ray314",
    "luma": "lumalabs",
    "pika": "pika",
    "runway": "runway",
    "gen 4.5": "gen45",
    "gen4.5": "gen45",
    "vidu q3": "viduq3",
    "vidu": "viduq3",
    "ltx 2.3": "ltx23",
    "ltx pro": "ltxpro",
    "ltx": "ltx23",
    "grok": "grok",
    "flux 3": "flux3",
    "flux": "flux3",
    "pixverse": "pixverse",
    "hedra": "hedra",
    "wery": "wery",
    "happyhorse": "happyhorse",
}

# 关键词 → tag slug 映射
TAG_KEYWORDS = {
    # 风格
    "cinematic": "cinematic",
    "电影感": "cinematic",
    "photorealistic": "realistic",
    "realistic": "realistic",
    "写实": "realistic",
    "anime": "anime",
    "animation": "anime",
    "animated": "anime",
    "动漫": "anime",
    "卡通": "anime",
    "watercolor": "watercolor",
    "水彩": "watercolor",
    "oil painting": "oil_painting",
    "sketch": "sketch",
    "像素": "pixel_art",
    "pixel art": "pixel_art",
    "low poly": "low_poly",
    "fantasy": "fantasy",
    "科幻": "futuristic",
    "futuristic": "futuristic",
    "sci-fi": "futuristic",
    "dreamy": "dreamy",
    "梦幻": "dreamy",
    "abstract": "abstract",
    "minimalist": "minimalist",
    "minimal": "minimalist",
    "极简": "minimalist",
    "vintage": "vintage",
    "复古": "vintage",
    "dark": "dark",
    "bright": "bright",
    "colorful": "colorful",
    "monochrome": "monochrome",
    "彩色": "colorful",
    "黑白": "monochrome",
    # 场景
    "urban": "urban",
    "城市": "urban",
    "nature": "nature",
    "自然": "nature",
    "landscape": "landscape",
    "风景": "landscape",
    "forest": "forest",
    "森林": "forest",
    "mountain": "mountain",
    "山": "mountain",
    "underwater": "underwater",
    "海底": "underwater",
    "水下": "underwater",
    "night": "night",
    "夜晚": "night",
    "sunset": "sunset",
    "日落": "sunset",
    "sunrise": "sunset",
    "日出": "sunset",
    "snow": "snow",
    "雪": "snow",
    "ice": "ice",
    "冰": "ice",
    "tunnel": "tunnel",
    "隧道": "tunnel",
    "alley": "alley",
    "hallway": "hallway",
    # 主题
    "portrait": "portrait",
    "人像": "portrait",
    "人物": "portrait",
    "character": "portrait",
    "car": "car",
    "汽车": "car",
    "vehicle": "car",
    "racing": "racing",
    "赛车": "racing",
    "rally": "rally",
    "pov": "pov",
    "first person": "pov",
    "第一人称": "pov",
    "fpv": "fpv",
    "tracking": "tracking",
    "跟随": "tracking",
    "aerial": "aerial",
    "鸟瞰": "aerial",
    "drone": "aerial",
    "macro": "macro",
    "微距": "macro",
    "bokeh": "bokeh",
    "motion blur": "motion_blur",
    "动模糊": "motion_blur",
    "silhouette": "silhouette",
    "剪影": "silhouette",
    "double exposure": "double_exposure",
    "multi-shot": "multi-shot",
    "多镜头": "multi-shot",
    "transitions": "transitions",
    "转场": "transitions",
    "action": "multi-shot",
    "action scene": "multi-shot",
    "fight": "multi-shot",
    "battle": "multi-shot",
    "war": "military",
    "军事": "military",
    "military": "military",
    "battlefield": "military",
    "speed": "motion_blur",
    "sword": "fantasy",
    "magic": "fantasy",
    "magic effect": "fantasy",
    "特效": "motion_blur",
    "vfx": "motion_blur",
    "asmr": "nature",
    "fire": "cinematic",
    "explosion": "cinematic",
    "舞蹈": "motion_blur",
    "dance": "motion_blur",
    "food": "nature",
    "美食": "nature",
    "music": "cinematic",
    "music video": "cinematic",
    "mv": "cinematic",
    "广告": "cinematic",
    "advert": "cinematic",
    "广告片": "cinematic",
    "commercial": "cinematic",
    "promo": "cinematic",
    "产品": "nature",
    "product": "nature",
    "cosplay": "portrait",
    "恐怖": "dark",
    "horror": "dark",
    "scary": "dark",
    "romantic": "cinematic",
    "romance": "cinematic",
    "浪漫": "cinematic",
    "thriller": "cinematic",
    "悬疑": "cinematic",
    "documentary": "cinematic",
    "record": "cinematic",
    "记录": "cinematic",
    "sports": "motion_blur",
    "运动": "motion_blur",
}


def load_yaml_simple(path: Path) -> List[str]:
    """简化 yaml 读取，只取顶层 key"""
    keys = []
    with open(path) as f:
        for line in f:
            line = line.rstrip()
            if not line or line.startswith("#") or line.startswith(" "):
                continue
            m = re.match(r"^([a-z0-9_.\-]+):", line)
            if m:
                keys.append(m.group(1))
    return keys


def detect_model(text: str) -> str:
    """从文本中检测视频生成模型"""
    t = text.lower()
    # 按关键词长度从长到短匹配，避免 'seedance' 抢 'seedance 2.5'
    for kw, slug in MODEL_KEYWORDS.items():
        if kw.lower() in t and slug in ALL_MODELS:
            return slug
    return "seedance2"  # 默认 fallback


def detect_tags(text: str, model: str, max_tags: int = 5) -> List[str]:
    """从文本中检测标签，去重且不包含 model slug"""
    t = text.lower()
    found = []
    seen = set()
    # 按关键词长度从长到短
    for kw, slug in sorted(TAG_KEYWORDS.items(), key=lambda x: -len(x[0])):
        if slug == model:
            continue  # 标签不包含 model
        if slug in seen:
            continue
        if kw.lower() in t and slug in ALL_TAGS:
            found.append(slug)
            seen.add(slug)
            if len(found) >= max_tags:
                break
    if not found:
        found = ["cinematic"]
    return found


def _has_cjk(text: str) -> bool:
    """检测文本是否含中日韩字符"""
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


_DL_X_VIDEOS = None


def _get_dl_x_videos():
    """动态加载 dl-x-videos.py (文件名带连字符,标准 import 不行)"""
    global _DL_X_VIDEOS
    if _DL_X_VIDEOS is None:
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "dl_x_videos", Path(__file__).parent / "dl-x-videos.py"
        )
        _DL_X_VIDEOS = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_DL_X_VIDEOS)
    return _DL_X_VIDEOS


def _gen_title_via_llm(text: str) -> Optional[str]:
    """委托 dl-x-videos.gen_title_via_llm 生成英文 title (统一做法)。"""
    try:
        mod = _get_dl_x_videos()
        return mod.gen_title_via_llm(text)
    except Exception as e:
        print(f"  ! LLM title import failed: {e}", file=sys.stderr)
        return None


def gen_title(text: str, fallback_id: str) -> str:
    """从 text 开头生成 3-7 词的英文 title。

    标准做法:启发式 (英文 a-z 提取 + banned 词过滤) → LLM 理解 (中文/混合/emoji 起头) → 兜底。
    默认走 LLM 兜底,无需 env 开关。设 LLM_TITLE=0 可强制只用启发式(不推荐)。
    """
    # 启发式:从 text 提取开头的英文 3-7 词
    cleaned = re.sub(r"https?://\S+", "", text)
    cleaned = re.sub(r"@\w+", "", cleaned)
    cleaned = re.sub(r"[#@]\w+", "", cleaned)
    cleaned = re.sub(r"[\U0001F300-\U0001FAFF\U00002600-\U000027BF]", "", cleaned)
    first_line = cleaned.split("\n")[0].strip()
    for line in cleaned.split("\n"):
        line = line.strip()
        if 10 < len(line) < 200 and not line.startswith("Prompt"):
            first_line = line
            break
    first_line = first_line[:80]
    first_line = re.sub(r"[^a-zA-Z0-9 \-]", "", first_line)
    # 只保留英文词 (数字串如 "25" "4k" 不算 title 词)
    words = re.findall(r"[A-Za-z][A-Za-z]+", first_line)
    if len(words) > 7:
        words = words[:7]
    if len(words) >= 3:
        # 过滤 banned 词 (避免启发式提取出模型名/品牌/URL/Video 词)
        words = [w for w in words if w.lower() not in _BANNED_SLUG_WORDS and len(w) > 1]
        if len(words) >= 3:
            return " ".join(words).title()
    # 启发式不足 3 词 (或全部被 banned 过滤掉) — 统一做法:用 LLM 理解
    if os.environ.get("LLM_TITLE") != "0":
        llm_title = _gen_title_via_llm(text)
        if llm_title:
            return llm_title
    return f"Video {fallback_id}"


def kebab_slug(text: str, max_words: int = 4) -> str:
    """DEPRECATED: 旧版从原 text 抽词,会带入模型名/品牌/URL/外语。
    新版用 kebab_slug_from_title(title) 基于 LLM 生成的 title 生成。
    保留此函数仅供旧调用方兼容,新代码请用 kebab_slug_from_title。
    """
    cleaned = re.sub(r"[^a-zA-Z\s]", " ", text.lower())
    words = cleaned.split()
    # 去掉停用词
    stop = {"the", "a", "an", "in", "on", "at", "to", "of", "for", "and", "or", "with", "is", "are", "be", "this", "that", "a", "an", "as", "by", "from", "it", "into", "over", "under", "between", "while", "during"}
    filtered = [w for w in words if w not in stop and len(w) > 2]
    if not filtered:
        return "video"
    return "-".join(filtered[:max_words])


# 模型名/品牌名/平台名 — 强制不进 slug (即便误在 title 里)
_BANNED_SLUG_WORDS = {
    # 模型/产品
    "seedance", "seedance2", "kling", "gemini", "gemini-omni", "midjourney",
    "sora", "veo", "veo3", "runway", "hailuo", "pika", "hunyuan", "minimax",
    "gpt-image", "gpt", "chatgpt", "higgsfield", "medeo", "grok",
    "codex", "aigc", "v0", "imagen", "flux",
    # 品牌
    "mcdonald", "mcdonalds", "kfc", "coca-cola", "cocacola", "starbucks",
    "disney", "marvel", "nike", "adidas",
    # 平台/URL 残片
    "https", "http", "t-co", "tco",
    # 常见停用
    "the", "a", "an", "in", "on", "at", "to", "of", "for", "and", "or", "with",
    "is", "are", "be", "this", "that", "as", "by", "from", "it", "into",
    "over", "under", "between", "while", "during", "but", "not", "so",
    "if", "then", "than", "very", "just", "also", "even", "such",
}


def kebab_slug_from_title(title: str, max_words: int = 4) -> str:
    """基于 LLM 生成的 title 抽取 kebab slug。
    跳过的词: 模型名 / 品牌 / URL 残片 / 停用词。
    若 title 是 LLM fallback (e.g. "Video <id>") 或 < 2 词,返回 "video" 兜底。
    """
    if not title or not title.strip():
        return "video"
    t = title.strip()
    # LLM fallback 模式: "Video <id>" / "Made With Seedance X" → 退到 video
    if re.match(r"^Video\s+\d+$", t, re.IGNORECASE):
        return "video"
    if re.match(r"^Made With", t, re.IGNORECASE):
        return "video"
    if re.match(r"^Created With", t, re.IGNORECASE):
        return "video"
    # 拆词 (Title Case)
    words = re.findall(r"[A-Za-z][A-Za-z0-9]+", t)
    # 跳过 banned
    words = [w.lower() for w in words if w.lower() not in _BANNED_SLUG_WORDS]
    # 跳过单字母
    words = [w for w in words if len(w) > 1]
    if not words:
        return "video"
    return "-".join(words[:max_words])


def parse_post_date(date_str: str) -> Tuple[str, str]:
    """
    'Sun Aug 09 12:56:12 +0000 2026' → ('2026-08-09', '2026-08')
    """
    from datetime import datetime
    try:
        dt = datetime.strptime(date_str, "%a %b %d %H:%M:%S %z %Y")
    except Exception:
        # fallback to 2026-08
        return "2026-08-09", "2026-08"
    iso = dt.strftime("%Y-%m-%d")
    ym = dt.strftime("%Y-%m")
    return iso, ym


def compress_cover(src: Path, dst: Path, max_size_kb: int = 30, max_dim: int = 600) -> bool:
    """用 ImageMagick 压缩封面到目标大小"""
    if not src.exists():
        return False
    # 先用 magick 调整尺寸
    tmp = dst.with_suffix(".tmp.jpg")
    cmd1 = ["magick", str(src), "-resize", f"{max_dim}x{max_dim}>", "-quality", "60", str(tmp)]
    try:
        subprocess.run(cmd1, check=True, capture_output=True)
    except Exception as e:
        # fallback: 用 ffmpeg (ffmpeg 6.x 表达式语法: scale='min(MAX,iw)':-1)
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(src), "-vf", f"scale='min({max_dim},iw)':-1", "-q:v", "5", str(tmp)],
                check=True, capture_output=True,
            )
        except Exception as e2:
            print(f"  ! cover compression failed: {e2}", file=sys.stderr)
            return False
    # 检查大小
    if tmp.exists() and tmp.stat().st_size > max_size_kb * 1024:
        # 再压一档
        try:
            subprocess.run(["magick", str(tmp), "-quality", "45", str(dst)], check=True, capture_output=True)
        except Exception:
            shutil.move(str(tmp), str(dst))
            return True
        tmp.unlink(missing_ok=True)
    else:
        shutil.move(str(tmp), str(dst))
    return dst.exists()


def compress_video(src: Path, dst: Path, max_size_kb: int = 1024) -> bool:
    """压缩视频到 <=1M 480p（已经是 480p 的基本不用动）"""
    if not src.exists():
        return False
    # 如果已经 <=1M 直接复制
    if src.stat().st_size <= max_size_kb * 1024:
        shutil.copy2(src, dst)
        return True
    # 否则再压
    cmd = [
        "ffmpeg", "-y", "-i", str(src),
        "-vf", "scale=-2:480",
        "-r", "12",
        "-an",
        "-c:v", "libx264",
        "-crf", "32",
        "-preset", "veryfast",
        "-fs", f"{max_size_kb}k",
        str(dst)
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        return dst.exists()
    except Exception as e:
        print(f"  ! video compression failed: {e}", file=sys.stderr)
        return False


def process_one(tweet_id: str) -> Optional[dict]:
    """处理单个 tweet，返回结果 dict（用于 unbookmark 列表）"""
    info_path = TEMP_DIR / tweet_id / "info.json"
    if not info_path.exists():
        return None
    info = json.loads(info_path.read_text())
    text = info.get("text", "")
    if not text:
        print(f"  ! {tweet_id} no text", file=sys.stderr)
        return None

    post_date_iso, ym = parse_post_date(info.get("post_date", ""))
    author_name = info.get("author_name", "Unknown")
    author_username = info.get("author_username", "")
    source_url = info.get("url", f"https://x.com/i/status/{tweet_id}")

    # metadata
    model = detect_model(text)
    tags = detect_tags(text, model)
    title = gen_title(text, tweet_id)
    kebab = kebab_slug_from_title(title)  # 基于 title 生成（不是原文 text）
    slug = f"{tweet_id}-{kebab}"

    # 目标路径
    draft_dir = DRAFT_CONTENT_DIR / ym
    static_dir = DRAFT_STATIC_DIR / ym / slug
    draft_dir.mkdir(parents=True, exist_ok=True)
    static_dir.mkdir(parents=True, exist_ok=True)

    draft_json_path = draft_dir / f"{slug}.json"

    # 压缩封面
    cover_src = TEMP_DIR / tweet_id / "video_00001.jpg"
    if not cover_src.exists():
        # 尝试找其他 jpg
        jpgs = list((TEMP_DIR / tweet_id).glob("*.jpg"))
        if jpgs:
            cover_src = jpgs[0]
    cover_dst = static_dir / "cover.jpg"
    if not compress_cover(cover_src, cover_dst):
        print(f"  ! {tweet_id} cover compress failed", file=sys.stderr)
        return None

    # 视频（用 preview_480p）
    video_src = TEMP_DIR / tweet_id / "preview_1_480p.mp4"
    if not video_src.exists():
        # fallback 到原画
        video_src = TEMP_DIR / tweet_id / "video_00001.mp4"
    video_dst = static_dir / "video.mp4"
    if not compress_video(video_src, video_dst):
        print(f"  ! {tweet_id} video copy failed", file=sys.stderr)
        return None

    # 检查 size
    cover_kb = cover_dst.stat().st_size / 1024
    video_kb = video_dst.stat().st_size / 1024
    print(f"  + {tweet_id}: cover={cover_kb:.0f}k video={video_kb:.0f}k model={model} tags={tags}")

    # 写 draft JSON
    description = text.strip()
    draft = {
        "title": title,
        "description": description,
        "models": [model],
        "tags": tags,
        "author": author_name,
        "source_url": source_url,
        "post_date": post_date_iso,
        "image": f"/prompts/{ym}/{slug}/cover.jpg",
        "video": f"/prompts/{ym}/{slug}/video.mp4",
        "draft": True,
        "published": False,
        "published_at": None,
        "published_slug": None,
        "published_error": None,
        "publish_queued_at": None,
    }
    draft_json_path.write_text(
        json.dumps(draft, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8"
    )

    # 清理 temp
    shutil.rmtree(TEMP_DIR / tweet_id, ignore_errors=True)

    return {
        "tweet_id": tweet_id,
        "slug": slug,
        "ym": ym,
        "title": title,
        "model": model,
        "tags": tags,
        "source_url": source_url,
        "cover_kb": round(cover_kb, 1),
        "video_kb": round(video_kb, 1),
    }


def main():
    global ALL_MODELS, ALL_TAGS
    ALL_MODELS = set(load_yaml_simple(MODELS_YAML))
    ALL_TAGS = set(load_yaml_simple(TAGS_YAML))
    print(f"Loaded {len(ALL_MODELS)} models, {len(ALL_TAGS)} tags")

    # 找所有已下载的
    tweet_ids = sorted([p.name for p in TEMP_DIR.iterdir() if p.is_dir() and (p / "info.json").exists()])
    print(f"Found {len(tweet_ids)} ready: {tweet_ids[:3]}...{tweet_ids[-3:]}")

    results = []
    for tid in tweet_ids:
        try:
            r = process_one(tid)
            if r:
                results.append(r)
        except Exception as e:
            print(f"  ! {tid} error: {e}", file=sys.stderr)

    # 写 summary
    summary = {
        "ok": True,
        "total": len(results),
        "items": results,
    }
    (ROOT / "logs/bookmarks-batch-summary.json").parent.mkdir(parents=True, exist_ok=True)
    (ROOT / "logs/bookmarks-batch-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    print(f"\nDone: {len(results)} processed")
    print(f"Summary: logs/bookmarks-batch-summary.json")


if __name__ == "__main__":
    main()
