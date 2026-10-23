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
python3 tools/collect.py process <tweet_id>
```

一条命令完成 download → 压缩 → 写草稿 JSON。素材和元数据落 `temp/<TWEET_ID>/`，
草稿落 `content/_drafts/prompts/<YYYY-MM>/<tid>-<slug>.json`。

⚠️ **正文只有一句「Prompt ⤵️」+ 链接的条目**（提示词在作者自回复里）会被默认
100 字符门槛 + 提示词特征判定拦掉 —— 这类必须加 `--min-text 0` 显式放行：

```bash
python3 tools/collect.py process <tweet_id> --min-text 0
```

（`--min-text 0` 只放行长度和正文特征两道门槛，提示词是否真的存在由第 6 步
抓回复来确认。默认不传该参数时行为不变，时间线收录线不受影响。）

### 5. 落草稿 JSON

字段、目录结构、素材规格、标题生成规则 —— **严格按 `tools/download.md` 执行**
（输入上下文 / 批量查重 / 路径规划 / 素材规格 / 生成草稿内容 / 标题生成 / 清理验证）。

`collect.py process` 已经写好草稿 JSON，这一步只需核对字段是否符合规范。

### 6. 正文缺提示词时抓回复

正文明显不含提示词、且作者写了「提示词在回复里」→ 抓**作者自回复**：

```bash
python3 tools/prompts.py review --ids <tweet_id> --replies --show 5
```

`--show 5` = 打印最早 5 条作者自回复；工具会拉全量线程再筛出作者自己的回复。
**不要自己再写抓回复的脚本。**

抓到的提示词通过第 7 步配置里的 `recovered_prompt` + `recovered_from` 合回
description 末尾（带溯源 marker，幂等）。

⚠️ **回复里也没有提示词的条目**（作者只发了「Thanks!」之类）→ 判不合格，
放 `junk` 里，不要硬凑。

### 7. 标题和标签全部手工处理

**铁律见 `AGENTS.md` §收录产出质量铁律**（唯一事实源，这里不复述）。

要点：人工读正文 → 手工写 title（3–7 词、不含模型名）/ tags（对照 `data/tags.yaml`）/
models（白名单 `data/models.yaml`）。

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

专项校验（确认 models 与预期一致）需要带上本轮的日期和小时 —— `verify` 从
`logs/x_timeline_cron/cron.log` 认本轮条目：

```bash
python3 tools/prompts.py verify --date <YYYY-MM-DD> --hour <HH> \
    --keep <逗号分隔的 id> --junk <逗号分隔的 id> --models <id=slug1|slug2>
```

（`--models` 多模型用 `|` 分隔，用逗号会被拆成两个 kv。）

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
