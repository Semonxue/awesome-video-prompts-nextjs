# tools/ — Agent 工作指南

定时任务 `x-timeline-collect-2h` 每 2 小时自动跑一次**发现**，**提取**要你接着做。
这份文档讲的是：**你（agent）每轮该怎么干活**。

---

## 0. 固定脚本清单（就这几个，不要新增）

| 脚本 | 干什么 |
|---|---|
| `tools/collect.sh` | cron 入口（watchdog 3000s + 日志 + 卫生巡检）——**自动跑，你不用管** |
| `tools/collect.py` | 发现主逻辑；`hygiene` 子命令做文件卫生巡检 |
| `tools/download.py` | 素材下载器（被 `collect.py` 调用，也能单帖手动跑） |
| `tools/prompts.py` | **提取线唯一入口**：`review` / `apply` / `verify` / `snapshot` / `ledger` |
| `tools/skip.json` | 永久跳过名单（你判垃圾并真删过的 id） |

`scripts/` 只放构建/部署脚本（package.json / CI 引用），**不放业务脚本**。

---

## 1. 你的工作流（一轮 7 步）

发现线跑完 → 你接手做提取。**每一步都有现成命令，不要写脚本。**

```bash
# ① 取证 —— 导出本轮新收录的草稿正文（你的判断输入）
python3 tools/prompts.py review --date 2026-10-23 --hour 06

# ①b 看产出到底是不是 AI 视频（拿不准时才做）
python3 tools/prompts.py review --date 2026-10-23 --hour 06 --frames --montage

# ①c 正文缺提示词时（作者写 "Prompt below 👇"），抓他的自回复
python3 tools/prompts.py review --ids 2103849845467537562 --replies

# ② 判断 —— 逐条读正文，按下面的「定性闸门」决定去留（**主闸门，在你这**）

# ③ 写决定 —— 写成 JSON 配置（是数据，不是脚本！）→ /tmp/round_1023_06.json
#    {"round":"2026-10-23 06:00",
#     "keep":{"<tid>":{"title":"...","tags":[...],"models":[...]}},
#     "junk":["<tid>", ...]}
#    正文缺提示词要合回去 → keep 里加 "recovered_prompt":"..." + "recovered_from":["<reply_id>"]

# ④ 落地 —— 改 title/tags/models + 合并提示词 + 删不合格草稿 + 追加 skip + 刷快照
python3 tools/prompts.py apply /tmp/round_1023_06.json

# ⑤ 校验
python3 tools/prompts.py verify --date 2026-10-23 --hour 06 \
    --keep 2113190825505300693,2113299340970078477 \
    --junk 2113291372837089566 \
    --models 2113190825505300693=seedance25

# ⑥ 台账 —— 重建垃圾台账 + 规则回测基准（规则准不准就看这个）
python3 tools/prompts.py ledger

# ⑦ 卫生自检 —— 有残留就清掉（cron wrapper 每 tick 也会跑）
python3 tools/collect.py hygiene
```

全库体检（可选，随时可跑）：

```bash
python3 tools/prompts.py verify --audit              # 全库
python3 tools/prompts.py verify --audit --audit-limit 60   # 只看最近 60 条
```

---

## 2. 定性闸门（决定去留，优先级最高）

站点是「AI 视频提示词」库。**主体不是「AI 生成的视频/图像作品或提示词」的推文一律不收录。**

### 绝对不收（看到就删）

1. **编程 / 游戏开发过程**：Claude Code / Cursor / OpenCode 写代码、Three.js / Unity / Unreal / Blender / Godot 做 3D 或游戏、shader / voxel / webgl、MCP server、game dev / game jam、开源项目发布、「我让 AI 造了个 XXX 游戏/网站/应用」
2. **纯代码渲染 benchmark**：LLM 写代码渲染 3D 场景来比跑分（「MiniMax vs DeepSeek 造火山/鲸鱼/埃菲尔铁塔」、「xx k tokens」、「$0.xx」）
   - 区分点：**产出是 AI 视频/图像** → 留；**产出是代码渲染的 3D** → 删
3. **行业新闻 / 八卦 / 公告**：融资、发布会、大会、主题演讲、CEO 言论、榜单排名、财报
4. **工具 / 软件 / 素材促销**：订阅折扣、coupon、sign up 送 credits、素材包、插件、开源工具发布
5. **真人内容**：真人拍摄（未过 AI 视频模型）、真人八卦、隐私视频
6. **纯日常动态 / 社交寒暄**：GM everyone、早安晚安、周末快乐、纯祝贺无内容

### 要留

- 产出是 **AI 视频 / AI 图像**的作品（含模型对比、官方发布稿、镜头拆解）
- **图生视频 / 视频编辑工具**的实拍演示（产出是视频）
- 正文含**完整提示词**的帖子
- 真人出镜但**由 AI 视频模型生成**的（AI 广告片、AI 时尚片）

### 判定顺序

1. 先看**产出是什么**（AI 视频 / AI 图像 / 代码 / 真人 / 没有产出）
2. 再看是不是**促销引流**（coupon / %off / 送 credits / 求关注）
3. 两边都过 → 留；任一不过 → 删

> 代码层已内置 `looks_like_non_ai_content()` 做粗筛（命中根本不下载），但它只拦得住约 1/3
> ——**刻意保守，宁可漏过交给你，也绝不误杀**（拦掉的条目没人能补救）。剩下 2/3 全靠你逐条读。

---

## 3. 字段铁律

- **标题**：3–7 词、英文、语义完整、**不含模型名**、不含兜底文案（`Video Prompt Snapshot` / `X Cinematic`）、不以悬空词结尾
- **tags**：逐个对照 `data/tags.yaml` 的真实 slug（376 个），**不得凭记忆猜**
  - 校验：`grep -E "^[a-z0-9_-]+:" data/tags.yaml`
  - tags.yaml **不含** story / storytelling / logo / coding / film / interactive / strategy / winter / season / product / hdr / color-grading / video-editing / overlay / mocap / godot / vibe-coding / animation-style / character-swap / parody / ugc / photorealistic-subject
  - **tag 里不能出现模型名**
- **models**：白名单 `data/models.yaml`（32 个 slug）
  - 正文明确写出模型名才登记；正文没点名 → `[]`
  - 正文只提第三方平台（Pollo / Flova / Dreamina / MVLAND / Wizstar / Tesseract / CLO / Frameo / Picsart / ImagineArt / Lovart / @fal）且无法证伪 → `[]`
  - 平台 ≠ 模型：`Made with MiniMax H3 on @Hailuo_AI` → `minimaxh3`
  - 对比帖取产出侧：`FLUX 3 Max is 22x faster than Seedance 2.5` → `["flux3"]`
- **description**：完整提示词原文，**不改写不翻译**；作者自回复里的提示词用 `recovered_prompt` 合回末尾

---

## 4. 删除规范（删了要能持久）

`prompts.py apply` 会帮你做对，但手动删时必须遵守：

1. 用 `mavis-trash`（`/Users/semonxue/.minimax/bin/mavis-trash`），**不要** `rm`
2. 草稿：`content/_drafts/prompts/<YYYY-MM>/<id>-*.json`
3. **素材目录必须用草稿的 `image` 字段推导**：`static/_drafts` + `os.path.dirname(image)`
   - **不要**对草稿路径做 `dirname().replace()` —— 那会得到月份目录，上轮就是这么把整个月素材删光的
   - 删完复查：`os.path.exists(os.path.join('static/_drafts', image.lstrip('/')))`
4. tweet id 追加进 `tools/skip.json` 的 `ids` 数组（**永久，永不过期**）
   - 否则采集器下一轮会重新收录它（它只按线上 D1 去重，不知道你本地删了；踩过坑：删掉的螃蟹游戏第二天又回来了，标题还被重置成 Video Prompt Snapshot）

---

## 5. 铁律：不要写一次性脚本

**仓库里不允许留一次性脚本。** 2026-10-08~10 和 10-22 两轮数据修复累积了 23 个（`_fix_workset200*.py`、`_merge_*.py`、`_fetch_threads_batch2..5.py`、`*.bak2`…），`batch2~5` 只差一个输出目录常量；后果是 SEO 报告只能写「工作区里有大量未提交的 `_fix_*.py`」，且 `360` tag 从 3,604 收窄到 4 的误伤无法归因。**2026-10-23 已全部清理**，能力都在 `tools/prompts.py` 的子命令里。

- ❌ `scripts/_*.py`、`scripts/batch*.py`、`tools/_*.py`、`tmp*`、`*.bak` / `*.bak2` / `*.orig` / `*.rej`
- ❌ 仓库根放任何临时脚本
- ❌ 把数据 hardcode 进 `.py`（`OVERRIDES = {"<tid>": ("Title", ["tag"])}` 这种）
- ❌ **新建旁路脚本** —— 需要新能力就往 `tools/prompts.py` 加子命令
- ✅ 真的一次性脚本 → 写进 `/tmp`，**本轮结束前删除**
- ✅ 反复要用的新能力 → 加进 `tools/prompts.py`，带 argparse，然后 commit

自检：

```bash
python3 tools/collect.py hygiene          # 巡检，有残留 exit=2
python3 tools/collect.py hygiene --trash  # 未入库的残留移进回收站（可恢复）
```

判定口径：命中「一次性脚本」命名模式（`_` 前缀 / `batch|tmp|fix_|merge_|fetch_|report_` 前缀 / 备份后缀）且**未入库** → 必须清掉；**已入库** → 历史遗留，不要再新增。仓库根第一层除构建配置外的脚本也算。

---

## 6. 状态文件在哪

| 文件 | 用途 |
|---|---|
| `logs/x_timeline_cron/cron.log` | 每轮日志（`✓ <id>: draft=…` 是取本轮条目的依据） |
| `logs/x_timeline_cron/state.json` | 失败黑名单（4h 过期）——**不是** skip 名单 |
| `logs/x_timeline_cron/manual_titles_snapshot.json` | 人工标题快照（校验历史条目有没有被改坏），`apply` 每轮自动刷新 |
| `logs/x_timeline_cron/junk_ledger.json` | 垃圾台账（四桶） |
| `logs/x_timeline_cron/filter_rules_benchmark.json` | 代码粗筛规则 + 回测基准（单一事实源） |
| `logs/x_timeline_cron/labels.json` | 标注集（NEG/POS），调规则时回测用 |
| `logs/x_timeline_cron/dl_error_<id>.log` | 下载失败真因（`info.json missing` 时看这个） |

草稿产物：`content/_drafts/prompts/<YYYY-MM>/<tid>-<slug>.json` +
`static/_drafts/prompts/<YYYY-MM>/<tid>-<slug>/{cover.jpg,video.mp4}`
（按**推文发布月份**分目录，不是采集月份；用草稿里的 `post_date` 字段定位）

---

## 7. 相关文档

- `AGENTS.md` — 收录内容定性闸门、models 字段铁律、删除不持久 → 永久跳过名单
- `tools/download.md` — 单帖下载 → 草稿流程（标题生成规则在这）
- `tools/bookmark_collect.md` — **bookmark 收录**流程指南（手动触发，不是时间线那条）
- `docs/SEO-STATUS-AND-COST-NEUTRAL-PLAN-2026-10-18.md` — tag 归一化误伤的现场记录
