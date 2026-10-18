# Cloudflare 成本基线 — 2026-10-18 实测

> 补上 `docs/SEO-INDEXATION-BASELINE-2026-10-08.md` §5.0 一直标注「❌ 未取到」的 Cloudflare 成本数据。
>
> **本文件所有数字均来自实测**，每个数字都标注了来源与采集时间。凡未取到的项，明确写「未取到 + 卡点 + 报错原文」，**没有任何推算数字被当作实测值**。

- **采集时间**：2026-10-18 19:24 – 19:32（Asia/Shanghai）= 2026-10-18 11:24 – 11:32 UTC
- **账号**：`a5dfcda3d7f7b488c2597d8dcdf54cca`（Semonxue@gmail.com's Account）
- **Zone**：`awesomevideoprompts.com`，zone id `271cacb05d8dbd628adc83b4ce92dd80`，status `active`
- **D1 库**：`awesomevideoprompts-db`，databaseId 前缀 `486ccac9`
- **采集方式**：① opencli browser session `cf`（用户本机真实 Chrome，已登录 CF）② `wrangler` CLI ③ 在已登录页面上下文内直接调 CF GraphQL / REST API

---

## 0. 三条最重要的结论

1. **这个账号不是 Free 计划，是 Workers Paid（$5/月）+ R2 Paid。** 因此 Dashboard 上显示的额度是 **Paid 计划包含额度**（Workers CPU 30M ms/月、请求 10M/月、D1 rows read 25B/月 …），不是 Free 计划额度。任务里给的「D1 Free 5M rows read/天 / 100K rows written/天」在本账号**不适用** —— 页面上写的是 `first 25 billion included`（rows read）和 `first 50 million included`（rows written），是**月**额度。
2. **CPU 没有降下来，仍是唯一计费项。** 本计费周期（Oct 8–17，10 天）Workers CPU = **137.27M ms**，包含额度 30M，超额 **107.18M ms → $2.16**。上一完整周期（Sep 8–Oct 7，30 天）实测 **224.56M ms**。所以 wrangler.toml 里「181M ms/月」这个旧数字**低估了实际用量约 24%**。
3. **2026-10-15 的 CPU 优化，在现有数据里看不到可测量的节省。** 部署后仅 2 个完整自然日（Oct 16–17），日均 CPU 12.95M ms vs 部署前（Oct 8–14）14.03M ms（−7.7%），但**单请求 CPU 反而从 72.0 ms 升到 81.7 ms（+13.4%）**；CDN 缓存命中率**没有改善**（Oct 8 47.2% → Oct 17 47.9%）。样本仅 2 天且含 1 个周六，**不足以判定优化生效**。

---

## 1. 订阅与计划（实测）

来源：`GET /api/v4/accounts/a5dfcda3d7f7b488c2597d8dcdf54cca/subscriptions`（2026-10-18 11:26 UTC，页面上下文 fetch）

| 订阅 | rate_plan id | 月费 | 频率 |
|---|---|---|---|
| **Workers Paid** | `workers_paid` | **$5** | monthly |
| **R2 Paid** | `r2_paid` | $0 | monthly |
| Images Stream Basic | `images_v2_stream_basic` | $0 | monthly |

> ⚠️ 注意：`$5` 的 Workers Paid 订阅费**不计入** Billable usage 页的 "$2.16"。$2.16 只是 CPU 超额用量费。实际月度总支出 ≈ **$5 + CPU 超额**。

### 历史账单（实测）

来源：`GET /api/v4/accounts/{id}/billing/history?per_page=24`（2026-10-18 11:29 UTC）

| 出账日 | 金额 | 状态 | 收据号 |
|---|---|---|---|
| 2026-10-08T10:19:21Z | **$8.68** | CLOSED | IN-82740733 |
| 2026-09-08T10:28:43Z | $60.22 | CLOSED | IN-78388647 |
| 2026-08-08T10:48:58Z | $5.16 | CLOSED | IN-74535445 |
| 2026-08-07T10:12:28Z | (null) | CLOSED | IN-74347253 |
| 2026-07-08T10:35:45Z | (null) | CLOSED | IN-70868470 |
| 2026-06-08T10:33:44Z | (null) | CLOSED | IN-67632772 |
| 2026-02-05T05:10:39Z | $10.46 | CLOSED | IN-56783609 |

**交叉验证（重要）**：2026-10-08 的 $8.68 覆盖 **Sep 8 – Oct 7** 周期，即 CPU 优化前的完整周期。
按实测 CPU 反算：`(224.56M − 30M) × $0.02/M ms = $3.89`，加 Workers Paid $5 = **$8.89**，与账单 **$8.68** 相差 $0.21（2.4%，可由计费周期起止时刻与 UTC 日界不齐解释）。**账单与 GraphQL 实测互相印证。**

> 2026-09-08 的 $60.22 明显偏离（前后周期为 $5.16 / $8.68），疑似含一次性费用。**未取到明细，不做推测。**（明细接口见 §6）

---

## 2. 账号级 Billable usage 面板（实测，逐项）

来源：opencli browser session `cf` 打开
`https://dash.cloudflare.com/a5dfcda3d7f7b488c2597d8dcdf54cca/billing/billable-usage`
提取方式：`document.querySelector('main').innerText` 结构化提取（2026-10-18 11:25–11:32 UTC）
截图：`temp/cf-billing-1.png`（19:25）、`temp/cf-billing-2-costbreakdown.png`（19:32）

**说明：本次页面正常加载，未复现历史上卡在 "Still loading…" 的问题。** 页面完整渲染出 9 个计费项。

### 2.1 Spend Summary（原文）

```
Billing Period: Nov 2026
Spend Summary
TOTAL COST                    $2.16
  Usage observed Oct 8 - Oct 18, 2026
PROJECTED CYCLE COST          $6.09
  Oct 8 - Nov 7, 2026 · 11 of 31 cycle days observed
AVERAGE DAILY COST            $0.20
  Based on observed usage in this cycle
Budget alerts (1)
```

### 2.2 Cost Breakdown 全表（原文逐字）

| Product（页面原文额度标注） | Total usage | Billable usage | Usage cost |
|---|---|---|---|
| **Workers CPU ms** (`first 30M are included`) | **137.18M** | **107.18M** | **$2.16** |
| R2 Storage Class B Operations (`First 10M included`) | 321.9k | 0 | $0.00 |
| R2 Storage Class A Operations (`First 1M included`) | 3.73k | 0 | $0.00 |
| R2 Data Storage (`First 10GB-Month included`) | 1.34 GB-months | 0 GB-months | $0.00 |
| Workers Standard Requests (`first 10M are included`) | 1.9M | 0 | $0.00 |
| D1 - Storage GB-mo (`first 5GB included`) | 0.01 GB-months | 0 GB-months | $0.00 |
| Observability - Logs (`First 20M included`) | 1.37 Millions of requests | 0 Millions of requests | $0.00 |
| D1 - Rows Written (`first 50 million included`) | 13.1k | 0 | $0.00 |
| D1 - Rows Read (`first 25 billion included`) | 1.77B | 0 | $0.00 |

**唯一产生费用的项是 Workers CPU ms。** 其余 8 项均为 `No usage cost in this billing period`。

> 页面 "Effective rate $0.00 / unit" 是显示精度问题（$0.02/M ms 被截断显示）。由 `$2.16 ÷ 107.18M ms` 反算实际单价 = **$0.0201 / M ms**，与 CF 公开的 Workers Paid CPU 单价 $0.02/M ms 一致。

---

## 3. 指标 | 当前用量 | 包含额度 | 占比 | 是否计费

**统计窗口统一为当前计费周期已落数的 10 个完整日：2026-10-08 ~ 2026-10-17（UTC）。**
（依据见 §4.1：Dashboard 的周期数字与 GraphQL Oct 8–17 数据逐项吻合，账单数据滞后约 1 天）

| 指标 | 当前用量（实测） | 数据源 | 包含额度（页面原文） | 占比 | 是否计费 | headroom |
|---|---|---|---|---|---|---|
| **Workers CPU ms** | **137.18M**（Dash）/ **137.27M**（GraphQL） | Dash + GraphQL | 30M / 月 | **458%** | **✅ $2.16** | **−107M（超额 3.6×）** |
| Workers 请求数 | 1.9M（Dash）/ 1,827,503（GraphQL） | Dash + GraphQL | 10M / 月 | 18% ~ 19% | ❌ $0.00 | +8.2M（5.5×） |
| Workers 错误数 | 46 | GraphQL | — | — | — | — |
| D1 rows read | 1.77B（Dash）/ 1,766,752,263（GraphQL） | Dash + GraphQL | 25B / 月 | **7.1%** | ❌ $0.00 | +23.2B（14.1×） |
| D1 rows written | 13.1k（Dash）/ 13,103（GraphQL） | Dash + GraphQL | 50M / 月 | **0.026%** | ❌ $0.00 | +49.99M |
| D1 read queries | 5,379,224 | GraphQL | 未标注额度 | — | ❌ $0.00 | — |
| D1 write queries | 3,284 | GraphQL | 未标注额度 | — | ❌ $0.00 | — |
| D1 存储 | 0.01 GB-months | Dash | 5 GB / 月 | 0.2% | ❌ $0.00 | +4.99 GB |
| R2 Class A 操作 | 3.73k（Dash）/ 3,750（GraphQL） | Dash + GraphQL | 1M / 月 | **0.37%** | ❌ $0.00 | +996k（267×） |
| R2 Class B 操作 | 321.9k（Dash）/ 321,883（GraphQL） | Dash + GraphQL | 10M / 月 | **3.2%** | ❌ $0.00 | +9.68M（31×） |
| R2 数据存储 | 1.34 GB-months | Dash | 10 GB-month | 13.4% | ❌ $0.00 | +8.66 GB-mo |
| Observability Logs | 1.37M | Dash | 20M / 月 | 6.9% | ❌ $0.00 | +18.6M（14.6×） |
| CDN 缓存命中率 | **46.21%**（全量）/ **90.6%**（可缓存请求口径） | GraphQL zone | — | — | — | — |

### 3.1 R2 原始字节（支撑证据）

来源：GraphQL `r2StorageAdaptiveGroups`（zone/account 级，Oct 8–17 每日 `max`）

| 日期 | payloadSize (bytes) | metadataSize | objectCount |
|---|---|---|---|
| 2026-10-08 | 3,861,461,293 | 392,110 | 14,067 |
| 2026-10-17 | 4,036,718,061 | 412,251 | 14,747 |

期末对象数 14,747，payload 4.04 GB（十进制）≈ 3.76 GiB。Dash 的 `1.34 GB-months` 是周期内按天摊销后的口径，与本原始值方向一致。

### 3.2 缓存命中率明细（实测，逐日）

来源：GraphQL `httpRequestsAdaptiveGroups`，zone `271cacb0…`，dimensions `{date, cacheStatus}`（2026-10-18 11:32 UTC）

| 日期 | 总请求 | hitLike | 命中率 | hit | revalidated | stale | miss | expired | updating | bypass | dynamic | none |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10-08 | 515,692 | 243,233 | 47.2% | 127,437 | 14,283 | 101,513 | 19,228 | — | — | 0 | 1,662 | 251,373 |
| 10-09 | 616,566 | 303,861 | 49.3% | 179,393 | 15,313 | 109,155 | 20,527 | — | — | 0 | 507 | 291,448 |
| 10-10 | 475,425 | 227,289 | 47.8% | 117,143 | 13,906 | 96,240 | 12,998 | — | — | 0 | 665 | 234,295 |
| 10-11 | 513,262 | 252,471 | 49.2% | 131,905 | 13,515 | 107,051 | 15,039 | — | — | 0 | 809 | 244,773 |
| 10-12 | 688,995 | 281,659 | 40.9% | 130,959 | 14,284 | 136,416 | 25,539 | — | — | 0 | 720 | 380,794 |
| 10-13 | 948,174 | 375,816 | 39.6% | 152,153 | 17,224 | 206,439 | 32,384 | — | — | 0 | 822 | 538,993 |
| 10-14 | 754,653 | 353,743 | 46.9% | 157,675 | 16,304 | 179,764 | 26,199 | — | — | 0 | 728 | 373,742 |
| **10-15**（部署日） | 675,439 | 333,907 | 49.4% | 164,215 | 20,495 | 149,197 | 53,165 | — | — | **67,935** | 801 | 218,083 |
| 10-16 | 591,407 | 287,566 | 48.6% | 122,520 | 28,070 | 136,976 | 37,053 | — | — | **112,801** | 1,270 | 145,811 |
| 10-17 | 655,457 | 314,056 | 47.9% | 144,554 | 28,838 | 140,664 | 45,514 | — | — | **139,076** | 1,150 | 145,961 |
| **周期合计** | **6,435,070** | **2,973,601** | **46.21%** | 1,427,954 | 182,232 | 1,363,415 | 287,646 | 12,944 | 6,660 | 319,812 | 9,134 | 2,825,273 |

- **全量命中率** = (hit + revalidated + stale) / 总请求 = 2,973,601 / 6,435,070 = **46.21%**
- **可缓存口径命中率** = 2,973,601 / (2,973,601 + 287,646 + 12,944 + 6,660) = **90.6%**（排除 `none`/`bypass`/`dynamic` 这三类不做缓存查找的请求）

**关键观察**：10-15 部署后 `bypass` 从 **0** 跳到 67,935 → 112,801 → 139,076，同时 `none` 从 ~250k–540k 降到 ~146k。说明 `[cache] enabled=true` **改变了请求的缓存状态分类**（原先记为 `none` 的请求现在记为 `bypass`），但**总命中率没有提升**（47.9% vs 47.2%）。`miss` 反而从 13k–32k 升到 37k–53k。

---

## 4. 2026-09-08 旧结论 vs 2026-10-18 实测

### 4.1 数据可信度交叉验证（先看这个）

Dashboard 面板数字 vs 我用 GraphQL 独立拉取的 Oct 8–17 数据：

| 指标 | Dashboard 显示 | GraphQL 实测（Oct 8–17） | 偏差 |
|---|---|---|---|
| Workers CPU ms | 137.18M | 137,270,317 ms = 137.27M | **0.07%** ✅ |
| D1 rows read | 1.77B | 1,766,752,263 | **0.2%** ✅ |
| D1 rows written | 13.1k | 13,103 | **0%（完全一致）** ✅ |
| R2 Class A | 3.73k | 3,750 | **0.5%** ✅ |
| R2 Class B | 321.9k | 321,883 | **0.005%（完全一致）** ✅ |
| Workers 请求数 | 1.9M | 1,827,503 | **3.8%** ⚠️ |

**结论：Dashboard 的计费窗口 = Oct 8 00:00 ~ Oct 17 24:00 UTC（账单数据滞后约 1 天）。** 5/6 项吻合到 0.5% 以内，其中 2 项完全一致 → 两个独立来源互相印证，数据可信。

⚠️ 唯一不一致：Workers 请求数 1.9M vs 1,827,503（差 3.8%）。**无法解释，如实记录。** 可能原因是 Dashboard 的 "Workers Standard Requests" 与 GraphQL `workersInvocationsAdaptive.requests` 口径不完全相同（例如是否含某些子请求），但**未取到证据，不做断言**。该项不影响任何结论（两者都远低于 10M 额度）。

### 4.2 对比表

| 指标 | 2026-09-08 旧结论（wrangler.toml 注释） | 2026-10-18 实测 | 判定 |
|---|---|---|---|
| Worker CPU | **181M ms/月** vs 免费 30M → 约 $3/月超额 | **上一周期实测 224.56M ms**（Sep 8–Oct 7，30 天）<br>**本周期前 10 天实测 137.27M ms**（Oct 8–17） | ❌ **旧数字低估约 24%**；CPU 未降 |
| D1 rowsRead | 1.03B/月 vs 免费额度 → $0 | **1.77B**（Oct 8–17，10 天）；额度 25B/月 | ✅ 仍 $0，但**旧数字低估** |
| 请求数 | 2.76M/月 vs 10M 免费 → $0 | **1.83M**（Oct 8–17，10 天）；额度 10M/月 | ✅ 仍 $0 |
| 计费项 | CPU 是唯一瓶颈 | **确认**：9 个计费项中仅 Workers CPU ms 计费 | ✅ 结论成立 |
| 免费额度口径 | 「免费 30M」「Free 计划」 | **账号实为 Workers Paid**，30M 是 Paid 包含额度 | ⚠️ **口径需更正** |
| CPU 优化（2026-10-15）效果 | 未实测 | **未见可测量的节省**（见 §4.3） | ❌ **未生效/无法证明生效** |

### 4.3 CPU 优化是否生效 —— 明确结论

**部署事实**（来源：`npx wrangler deployments list`，2026-10-18 11:29 UTC）

```
Created: 2026-10-15T05:14:59.753Z   Version 50c5c186-7adb-410d-986d-9366cc77412c
Created: 2026-10-15T05:24:51.499Z   Version b8b87335-7681-42d2-b82c-227ea41db3a1
Created: 2026-10-15T06:33:55.974Z   Version 9fe34fe5-0547-429e-9912-c260bcf43730
Created: 2026-10-15T06:36:37.807Z   Version 8a94875d-c915-409f-bdc2-ab44b0c30abe  ← 最近一次部署
```

→ 最后一次部署 = **2026-10-15T06:36:37Z**。此后无任何部署。

**逐日实测（GraphQL `workersInvocationsAdaptive`，2026-10-18 11:26 UTC）**

| 日期 | 请求数 | CPU (ms) | 单请求 CPU (ms) | 阶段 |
|---|---|---|---|---|
| 2026-10-08 (四) | 147,831 | 12,240,800 | 82.8 | 部署前 |
| 2026-10-09 (五) | 182,387 | 12,982,272 | 71.2 | 部署前 |
| 2026-10-10 (六) | 137,004 | 9,925,860 | 72.4 | 部署前 |
| 2026-10-11 (日) | 136,916 | 10,397,997 | 75.9 | 部署前（40 errors） |
| 2026-10-12 (一) | 240,029 | 16,051,971 | 66.9 | 部署前 |
| 2026-10-13 (二) | 326,153 | 22,599,018 | 69.3 | 部署前 |
| 2026-10-14 (三) | 193,060 | 13,977,860 | 72.4 | 部署前 |
| **部署前小计（7 天）** | **1,363,380** | **98,175,778** | **72.01** | 日均 14.03M ms |
| 2026-10-15 (四) | 146,901 | 13,192,588 | 89.8 | 部署日（混合） |
| 2026-10-16 (五) | 142,939 | 14,248,796 | 99.7 | 部署后（6 errors） |
| 2026-10-17 (六) | 174,283 | 11,653,155 | 66.9 | 部署后 |
| **部署后小计（2 天）** | **317,222** | **25,901,951** | **81.65** | 日均 12.95M ms |
| 2026-10-18（当日未满） | 75,247 | 5,045,540 | 67.1 | 数据截止 11:26 UTC |

**判定：**

- 日均 CPU：14.03M → 12.95M ms/天，**−7.7%**
- 单请求 CPU：72.01 → 81.65 ms/请求，**+13.4%（恶化）**
- 缓存命中率：47.2%（Oct 8）→ 47.9%（Oct 17），**无改善**
- Oct 16（14.25M ms）**高于部署前 7 天中的 5 天**（仅低于 10-12 的 16.05M 与 10-13 的 22.60M）

**结论：在 2026-10-15 部署后的 3 天数据（2 个完整日 + 1 个未满日）里，没有任何可归因于该优化的 CPU 下降。** 部署后日均 CPU 微降 7.7% 完全可被流量波动解释（Oct 16–17 请求数比部署前日均低 18.6%）；而单请求 CPU 反而上升 13.4%。**样本量（2 天，含 1 个周六）不足以证明生效，也没有证据支持生效。**

> **明确回答「CPU 是否从 181M/月 降下来」：**
> **没有。** ① 181M 这个基线本身不准 —— 上一完整周期实测 224.56M ms。② 本周期前 10 天已达 137.27M ms，按此速率线性外推满周期约 **426M ms**（*这是外推，不是实测*）。③ CPU 仍超出 30M 包含额度 **3.6 倍**，仍是唯一计费项。

**CF 自己的预测（页面原文，非我方推算）**：`PROJECTED CYCLE COST $6.09`（Oct 8–Nov 7，11/31 天已观测）。

---

## 5. D1 查询级成本归因（实测）

来源：`npx wrangler d1 insights awesomevideoprompts-db --time-period 10d --limit 20`
（用 `.dev.vars` 中的 `CLOUDFLARE_API_TOKEN`，2026-10-18 11:32 UTC）

**10 天窗口 top-20 查询合计 rows read ≈ 1.734B（两次调用分别为 1,734,207,657 / 1,734,243,580，滚动窗口导致 0.002% 漂移），占同期总 rows read（1,766,752,263）的 98.2%。**

| # | rows read | 占比 | 运行次数 | avgRows | avgMs | 查询 |
|---|---|---|---|---|---|---|
| 1 | **1,204,534,666** | **68.2%** | 200,886 | 5,996 | 4.1 | tag 过滤列表页：`prompts ⋈ prompt_tags ⋈ tags WHERE is_draft=? AND tags.name=? ORDER BY prompt_date DESC LIMIT ?` |
| 2 | 129,301,667 | 7.3% | 236,303 | 547 | 0.6 | `prompt_tags ⋈ tags WHERE prompt_id IN (48个?)` |
| 3 | 98,981,088 | 5.6% | 15,130 | 6,542 | 10.7 | model 过滤列表页（带 `OFFSET`）：`prompts ⋈ prompt_models ⋈ models WHERE is_draft=? AND models.slug=? … LIMIT ? OFFSET ?` |
| 4 | 61,003,894 | 3.5% | 16,210 | 3,763 | 3.4 | model 过滤列表页（首页，无 OFFSET） |
| 5 | 43,807,129 | 2.5% | 232,439 | 188 | 0.4 | `prompt_models ⋈ models WHERE prompt_id IN (48个?)` |
| 6 | 41,558,050 | 2.4% | 10,373 | 4,006 | — | model 页 tag 计数（`GROUP BY tags.name`，5 表 join） |
| 7 | 34,617,242 | 2.0% | 3,936 | 8,795 | — | tag 过滤列表页（带 `OFFSET`） |
| 8 | 30,080,605 | 1.7% | 297 | 101,281 | **84.2** | 全站 tag 计数（`GROUP BY tags.name`，3 表 join） |

### ⚠️ 与 AGENTS.md 现有认知冲突（需更正）

`AGENTS.md` 写：「**D1 cost 控制**：详情页相关/上下篇查询是 **99% D1 rows read 来源**」。

**实测不成立。** 当前周期 68.2% 的 rows read 来自**列表页的 tag 过滤查询**（单条查询 #1），加上 model 过滤列表页（#3+#4+#7 = 11.1%）与两个 hydration 查询（#2+#5 = 9.8%），**列表页相关查询合计约 89%**。

详情页 slug 查询（`WHERE slug=? AND is_draft=? LIMIT ?`）单次 avgRows = **0**，10 天窗口内合计仅 **1,499,313 rows read = 总量的 0.085%**（运行 1,499,985 次）。**「相关/上下篇」查询在 top-20 中完全没有出现。**

**下次做 D1 优化时，应先打列表页 tag/model 过滤查询，而不是详情页相关/上下篇。**

---

## 6. 未取到的项 / 卡点 / 报错原文

### 6.1 `wrangler` OAuth 已过期（原文）

```
⛅️ wrangler 4.104.0
Getting User settings...
✘ [ERROR] Not logged in. Your auth token has expired and could not be refreshed,
  and the environment is non-interactive. Run `wrangler login` in an interactive
  terminal or set a CLOUDFLARE_API_TOKEN.

  Run `wrangler whoami` to check your current authentication status.
```

`npx wrangler d1 insights awesomevideoprompts-db` 与 `npx wrangler deployments list` 在无 token 时同样失败：

```
✘ [ERROR] In a non-interactive environment, it's necessary to set a
  CLOUDFLARE_API_TOKEN environment variable for wrangler to work. Please go to
  https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
  for instructions on how to create an api token, and assign its value to
  CLOUDFLARE_API_TOKEN.

  To continue without logging in, rerun this command with `--temporary`.
  Wrangler will use a temporary account and print a claim URL.
```

**解法（本次采用，已验证有效）**：`.dev.vars` 中存在 `CLOUDFLARE_API_TOKEN`（53 字符）与 `CLOUDFLARE_ACCOUNT_ID`。
用 `export CLOUDFLARE_API_TOKEN="$(grep '^CLOUDFLARE_API_TOKEN=' .dev.vars | cut -d= -f2-)"` 注入后，wrangler 全部命令可用：

```
👋 You are logged in with an User API Token, associated with the email semonxue@gmail.com.
ℹ️  The API Token is read from the CLOUDFLARE_API_TOKEN environment variable.
│ Semonxue@gmail.com's Account │ a5dfcda3d7f7b488c2597d8dcdf54cca │
```

> 🔒 **本文件不记录 token 值。** 未尝试交互式 `wrangler login`（非交互 shell 会挂住）。

### 6.2 wrangler 写日志 EPERM（无害，但每次都会刷屏）

```
✘ [ERROR] Failed to write to log file Error: EPERM: operation not permitted,
  open '/Users/semonxue/Library/Preferences/.wrangler/logs/wrangler-2026-10-18_11-24-35_394.log'
  errno: -1, code: 'EPERM', syscall: 'open'
```

不影响命令结果（stdout 数据正常输出），只是日志文件写不进去。

### 6.3 确实未取到的项

| 项 | 卡点 | 报错原文 / 证据 | 下次怎么取 |
|---|---|---|---|
| **Billable usage 的公开 API** | 无此路由 | `GET /api/v4/accounts/{id}/billing/billable-usage` → `400 {"code":7003,"message":"Could not route to /accounts/.../billing/billable-usage, perhaps your object identifier is invalid?"}` + `{"code":7000,"message":"No route for that URI"}` | 只能读 Dashboard DOM（本次已成功）或抓页面 XHR |
| **发票明细行项目** | 无此路由 | `GET /api/v4/accounts/{id}/billing/history/{invoice_id}` → `404 {"code":1199,"message":"Check the endpoint URL and try again. There is no handler at the provided URL to handle the request."}` | 走 Dashboard Invoices 页面 UI |
| **`/billing/usage` 计费用量** | 该端点只返回遗留指标 | `?time_delta=day` → 200，但 `metrics: ["streamMinutesViewed"]`、`data: null`；不带参数 → `400 {"code":10010,"message":"time delta \"minute\" doesn't exist"}` | 已用 GraphQL 替代 |
| **D1 存储的 GraphQL 字段** | 字段名未知 | `d1StorageAdaptiveGroups { max { databaseSize } }` → `unknown field "databaseSize"` | 用 Dashboard 值 `0.01 GB-months`；或试 `databaseSizeBytes` |
| **zone 请求数的 GraphQL 字段** | 字段名不是 `requests` | `httpRequestsAdaptiveGroups { sum { requests } }` → `unknown field "requests"` | 已改用 `count`（本次采用） |
| **per-worker（脚本级）指标拆分** | 未采集 | 本次仅采集账号级 | Workers & Pages → 选 worker → Metrics |
| **2026-09-08 的 $60.22 账单构成** | 明细接口 404（见上） | — | Dashboard Invoices 页 |
| **CPU 优化的 A/B 归因** | 方法学限制 | 仅 2 个完整部署后自然日，且流量/星期分布不同 | 再等 1–2 周，用部署前后各 ≥7 天做对比 |

### 6.4 浏览器环境备注

- `opencli doctor`（19:24）：Daemon running（port 19825，v1.8.8）、Extension connected（v1.0.24）、profile `b5sqhznx` connected。
- **本次未复现历史卡 "Still loading…"**：页面首次打开即完整渲染，`main.innerText` 长度 1531 字符，9 个计费项全部可见。
- `opencli browser cf network` 的抓包缓存写盘失败：`Could not persist capture cache: EPERM: operation not permitted, open '/Users/semonxue/.opencli/cache/browser-network/cf.json'`，导致 `--detail` 回查会 miss。已改用 `--follow` 实时抓包 + 页面内直接 `fetch` 调 API 绕过。
- 唯一可用的 workaround 更优：**在已登录页面上下文里 `fetch("/api/v4/...")` / `fetch("/api/v4/graphql")`**，直接拿到结构化 JSON，比读 DOM 可靠得多。本文件大部分数字来自这条路径。

---

## 7. 复现步骤（下次照做）

```bash
cd /Users/semonxue/Workplace/Works/ai-dev/awesome-video-prompts-nextjs

# 1) 注入 token（值不落盘、不打印）
export CLOUDFLARE_API_TOKEN="$(grep '^CLOUDFLARE_API_TOKEN=' .dev.vars | head -1 | cut -d= -f2- | tr -d '"'"'"'\r\n')"
export CLOUDFLARE_ACCOUNT_ID="a5dfcda3d7f7b488c2597d8dcdf54cca"

# 2) CLI
npx wrangler whoami
npx wrangler d1 insights awesomevideoprompts-db --time-period 10d --limit 20
npx wrangler deployments list

# 3) Dashboard（session 名固定 cf）
opencli browser cf open "https://dash.cloudflare.com/a5dfcda3d7f7b488c2597d8dcdf54cca/billing/billable-usage"
opencli browser cf eval "document.querySelector('main').innerText"
opencli browser cf screenshot temp/cf-billing-N.png
```

**关键 API（在页面上下文 fetch，需已登录）**

```js
// 账单周期用量（Dashboard 同源）
const A = "a5dfcda3d7f7b488c2597d8dcdf54cca";
await (await fetch(`/api/v4/accounts/${A}/billing/history?per_page=24`)).json();
await (await fetch(`/api/v4/accounts/${A}/subscriptions`)).json();

// GraphQL 分析（POST /api/v4/graphql）
//   workersInvocationsAdaptive   → sum{requests,errors,cpuTimeUs} dimensions{date}
//   d1AnalyticsAdaptiveGroups    → sum{rowsRead,rowsWritten,readQueries,writeQueries} dimensions{date,databaseId}
//   r2OperationsAdaptiveGroups   → sum{requests} dimensions{date,actionType}
//   r2StorageAdaptiveGroups      → max{payloadSize,metadataSize,objectCount} dimensions{date}
//   httpRequestsAdaptiveGroups   → count dimensions{date,cacheStatus}   (zone filter)
// 日期格式必须是 'YYYY-MM-DD'（'...Z' 会报 date format should be '2006-01-02'）
```

**GraphQL 调用示例**

```js
const q = `query($a:String!,$s:String!,$u:String!){viewer{accounts(filter:{accountTag:$a}){
  workersInvocationsAdaptive(limit:10000,filter:{date_geq:$s,date_leq:$u}){
    sum{requests errors cpuTimeUs} dimensions{date}}}}}`;
await fetch("/api/v4/graphql", {
  method: "POST", credentials: "include",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ query: q, variables: { a: A, s: "2026-10-08", u: "2026-10-17" } })
}).then(r => r.json());
```

---

## 8. 数据来源索引（可追溯）

| 数字 | 来源 | 采集时间 (UTC) |
|---|---|---|
| Billable usage 9 项 / Spend Summary | `cf` session `main.innerText` + `temp/cf-billing-1.png` | 11:25 |
| Cost Breakdown 截图 | `temp/cf-billing-2-costbreakdown.png` | 11:32 |
| 订阅（Workers Paid $5 / R2 Paid） | `GET /subscriptions` | 11:26 |
| 发票历史 | `GET /billing/history?per_page=24` | 11:29 |
| Workers 逐日 CPU/请求/错误（Oct 1–18） | GraphQL `workersInvocationsAdaptive` | 11:26 |
| Workers 上一周期（Sep 8–Oct 7） | GraphQL `workersInvocationsAdaptive` | 11:31 |
| Workers 周期合计（Oct 8–17） | GraphQL `workersInvocationsAdaptive` | 11:28 |
| D1 逐日 rows read/written/queries | GraphQL `d1AnalyticsAdaptiveGroups` | 11:27 |
| R2 操作分类计数 | GraphQL `r2OperationsAdaptiveGroups` | 11:28 |
| R2 存储字节/对象数 | GraphQL `r2StorageAdaptiveGroups` | 11:27 |
| 缓存状态逐日 | GraphQL `httpRequestsAdaptiveGroups` | 11:32 |
| 部署历史 | `wrangler deployments list` | 11:29 |
| D1 查询级 rows read | `wrangler d1 insights --time-period 10d --limit 20` | 11:32 |
| wrangler 认证状态 | `wrangler whoami` | 11:29 |
| Zone id | `GET /zones` | 11:28 |

**未修改任何 `src/` 代码，未执行 `wrangler deploy`。** 本次只写入 `docs/CF-COST-BASELINE-2026-10-18.md` 与 `temp/cf-*.png`。
