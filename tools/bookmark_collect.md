# tools/bookmark_collect.md — bookmark 收录指南

任务：**把 X 上已收藏（bookmark）的推文，收录成本站的 prompt 草稿**，收完取消收藏。

与「时间线收录线」是两条独立流程：时间线那条由 `tools/collect.sh` 自动跑，
bookmark 这条是**手动触发**（粘贴任务文本，或做成 cron）。

触发文本很短，细节全在这份文档：

> 静候5分钟，然后使用 opencli twitter --help 了解 twitter-cli 的用法，获取最新的 30 个带视频的 bookmark，借鉴 tools/bookmark_collect.md 进行收录，收录后 unbookmark。

---

## 步骤

### 1. 摸清命令（别凭记忆）

```bash
opencli twitter --help
opencli twitter bookmarks --help
```

### 2. 取最新的 30 个带视频的 bookmark

```bash
opencli twitter bookmarks --site-session ephemeral --limit 30 -f json
```

只处理**带视频**的条目；没视频的直接 `unbookmark` 掉。

### 3. 查重 —— 已经收录的不要再收录

```bash
GET https://awesomevideoprompts.com/api/prompts/check-duplicates?ids=<逗号分隔的 tweet id>
```

返回 `{existing:[...], missing:[...]}`：

- `existing` → 直接 unbookmark 跳过，**不下载、不生成草稿**
- `missing` → 才继续往下走

### 4. 单条下载

```bash
python3 tools/download.py "<推文URL>"
```

素材和元数据落 `temp/<TWEET_ID>/`。

### 5. 落草稿 JSON

字段、目录结构、素材规格、标题生成规则 —— **严格按 `tools/download.md` 执行**
（输入上下文 / 批量查重 / 路径规划 / 素材规格 / 生成草稿内容 / 标题生成 / 清理验证）。

### 6. 正文缺提示词时抓回复

正文明显不含提示词、且作者写了「提示词在回复里」→ 抓**作者自回复**：

```bash
python3 tools/prompts.py review --ids <tweet_id> --replies --show 5
```

`--show 5` = 打印最早 5 条作者自回复；工具会拉全量线程再筛出作者自己的回复。
**不要自己再写抓回复的脚本。**

### 7. 标题和标签全部手工处理

逐条人工写 title 和 tags：

- 标题 3~7 词、英文、语义完整、**不含模型名**、不含兜底文案
- tags 逐个对照 `data/tags.yaml` 的真实 slug，**不得凭记忆猜**
- models 白名单见 `data/models.yaml`，正文写明模型名才登记

完整铁律见 `tools/README.md` §3。

判断结果写成 **JSON 配置**（数据，不是脚本）：

```json
{"round":"bookmark-2026-10-23",
 "keep":{"<tid>":{"title":"...","tags":[...],"models":[...]}},
 "junk":["<tid>", ...]}
```

正文缺提示词要合回去的 → `keep` 里加 `"recovered_prompt":"..."` 和 `"recovered_from":["<reply_id>"]`。

### 8. 落地

```bash
python3 tools/prompts.py apply <config.json>
python3 tools/prompts.py verify --audit --audit-limit 30
```

`apply` 负责：改写 title/tags/models + 合并提示词 + mavis-trash 删不合格草稿 +
追加 skip 名单 + 自动刷快照。

### 9. 收尾：unbookmark

```bash
opencli twitter unbookmark "<推文URL>" --site-session ephemeral
```

只对**已成功收录**的条目 unbookmark；处理失败的保留书签，下轮再来。

---

## 不要做

- ❌ 新建一次性脚本 —— 查重 / 下载 / 抓回复 / 落地都有现成工具
- ❌ 凭记忆猜 tag
- ❌ 用 `rm` 删素材（用 `mavis-trash`；正常路径由 `prompts.py apply` 自动处理）
- ❌ 把「下载失败的条目」也 unbookmark 掉

---

## 相关文件

| 文件 | 用途 |
|---|---|
| `tools/download.py` | 素材下载器 |
| `tools/download.md` | 下载 → 草稿 JSON 的详细规范（字段/路径/标题生成） |
| `tools/prompts.py` | 提取线唯一入口：`review` / `apply` / `verify` / `snapshot` / `ledger` |
| `tools/README.md` | 收录线工作指南（7 步 + 定性闸门 + 字段铁律 + 删除规范 + 禁则） |
| `tools/skip.json` | 永久跳过名单（人工判垃圾并真删过的 id） |
