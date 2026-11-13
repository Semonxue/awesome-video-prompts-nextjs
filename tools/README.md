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

# ①b ❌ 不抽帧（2026-10-26 起）：图片/视频一律不进模型上下文
#    「产出是不是 AI 视频」只依据正文文本判断 → AGENTS.md §收录内容定性闸门 的「文本信号判定表」
#    正文不足以判断 → 保守判为不收（宁可漏收，不拿图喂模型）
#    tools/prompts.py review --frames / --montage 已硬拦截，调用即报错退出

# ①c 正文缺提示词时（作者写 "Prompt below 👇"），抓他的自回复
python3 tools/prompts.py review --ids 2103849845467537562 --replies

# ①d 自回复里已抓到完整提示词 → 批量合回 description（幂等，可重复跑）
python3 tools/prompts.py recover --replies-out /tmp/thread_replies
#    自动挑作者自回复里最长且 >200 字的那条当提示词，剥掉 "Prompt:" 引导语、
#    尾部署名行（Made with X）、纯点噪声行，再按 recovered marker 合回 description
#    ⚠️ TweetDetail 端点批量抓会触发 HTTP 429（会话配额，冷却 15~30 分钟）；
#      429 时用兜底路径（Timeline 端点不占 TweetDetail 配额）：
python3 tools/recover_via_timeline.py --ids-file /tmp/retry_ids.txt --out /tmp/tl_replies
#      它从作者时间线里定位"主帖之后同作者的最长回复"，产出与 review --replies 同格式

# ①e 草稿正文疑似被 X 长推文截断 → 抓完整正文并**整段替换** description
python3 tools/prompts.py fulltext --ids-file /tmp/need.txt --out /tmp/fulltext
#    核心机制（2026-11-13 实测，勿改回去）：
#    - X 长推文（Note Tweet）在 TweetDetail 端点返回的是**中段截断版** ——
#      草稿里存的既不是开头也不是结尾 → 补全是「整段替换」，不是往后追加
#    - `twitter article <id>` **不占时间线配额**，对有 Note Tweet 的推文返回完整原文，
#      对没有的报 "has no article content" → 可当**权威截断判定器**
#    - ⚠️ 别再用「正文末尾 t.co 后无实质内容」判截断 —— 普通推文本来就以媒体
#      t.co 链接结尾（实测 100 条里启发式误判 24 条，真实截断只有 26 条）
#    - 配额行为：article ✅ 不占配额 / thread ✅ 不占配额 / tweets ⚠️ 连打就 429
#    - 安全阀：同源校验（全文与草稿必须有实质交集）+ 长度门槛 + 幂等 marker

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

**唯一定义处 = `AGENTS.md` §收录内容定性闸门**（这里不复述）。

一句话版本：主体不是「AI 生成的视频/图像作品或提示词」的推文一律不收录 ——
编程/游戏开发过程、纯代码渲染 benchmark、行业新闻八卦公告、工具素材促销、
真人内容、纯日常寒暄，这 6 类看到就删；产出是 AI 视频/AI 图像（含模型对比、
镜头拆解、图生视频工具实拍演示）、正文含完整提示词的，留。

判定顺序：先看**产出是什么** → 再看是不是**促销引流** → 两边都过才留。

## 3. 字段铁律

**唯一事实源 = `AGENTS.md` §收录产出质量铁律**（两条收录线通用，这里不复述）。

要点：拿到一条 prompt 必须**人工读正文**、**手工写** title / tags / models；
正文缺提示词（作者说在回复里）必须抓作者自回复合回 description。

标签合法 slug 用 `grep -E "^[a-z0-9_-]+:" data/tags.yaml` 查，**不得凭记忆猜**。

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
