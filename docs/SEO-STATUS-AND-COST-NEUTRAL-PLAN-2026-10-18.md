# SEO 收录现状诊断 + 零增量成本提升方案 — 2026-10-18

> 本文件回答两个问题：
> 1. **现在 SEO 到底什么状况**（GSC 实测，2026-10-18）
> 2. **如何在不多花 Cloudflare 钱的前提下提升收录**
>
> 配套文件：
> - 成本侧实测：[`CF-COST-BASELINE-2026-10-18.md`](./CF-COST-BASELINE-2026-10-18.md)
> - 历史基线：[`SEO-INDEXATION-BASELINE-2026-10-08.md`](./SEO-INDEXATION-BASELINE-2026-10-08.md)
> - 原实施计划：[`SEO-INDEXATION-PLAN.md`](./SEO-INDEXATION-PLAN.md)

---

## 0. 一句话结论

**收录失败与 Cloudflare 成本无关。** Googlebot 抓取只占你请求量的 **0.057%**，
即从成本角度看抓取侧还有约 **1,700 倍**的扩张空间（1 ÷ 0.057%）。
真正的两道闸门是 **外链权威（全站仅 27 条外链）** 和 **内容没有搜索需求（3 个月 19 次曝光）**。
所以答案是：**任何能提升收录的做法，在 CF 成本上都几乎免费；但绝大多数"加 URL"的做法无效，因为它们不解决这两道闸门。**

先看最关键的一个反直觉数字（§5 有完整推导）：

| 项 | 实测 |
|---|---|
| Googlebot 每天抓取 | **≈ 105 次** |
| 站点每天总请求 | **182,750 次** |
| **Googlebot 占比** | **0.057%** |
| Googlebot 全部抓取折算 CPU 成本上限 | **≈ $0.005 / 月** |

即：**即使 Googlebot 抓取量放大 100 倍，你的 CF 账单也只多约 $0.5/月。**
"扩张 SEO 会推高 CF 成本"这个前提，在当前数据下是不成立的。

---

## 1. 数据来源与可信度

| 数据 | 采集方式 | 时间 | 可信度 |
|---|---|---|---|
| GSC 索引/未索引分桶 | opencli browser session `gsc`（本机 Chrome，已登录 semonxue@gmail.com），读 `document.body.innerText` | 2026-10-18 19:23–19:33 CST | ✅ 页面直读原文 |
| GSC 页面筛选器口径 | 读 DOM：选中项带 Material `KKjvXb` 类 → 确认是 **All known pages** | 同上 | ✅ 已校验，非猜测 |
| Sitemap 子表 URL 数 | `curl` 线上 `/sitemaps/*.xml` 计 `<loc>` | 同上 | ✅ 可直接复现 |
| Crawl stats / Performance / Links | opencli browser `gsc` session 读页面 | 同上 | ✅ |
| 边缘缓存状态 | `curl -A "Googlebot/2.1"` 读 `cf-cache-status` / `age` | 同上 | ✅ |
| CF 用量与计费 | opencli browser session `cf` + 页面内 `fetch` 调 CF GraphQL/REST + `wrangler d1 insights` | 同上 | ✅ 见成本文档 §4.1（6 项中 5 项与 Dashboard 吻合 <0.5%） |

**未取到的数据**：Googlebot 的精确 UA 级请求占比（CF GraphQL 未按 UA 拆分）。
因此 §5 的 0.057% 是**上界估算**（用 GSC 抓取总量 ÷ CF 总请求数），不是精确值 —— 但它已经小到不影响任何结论。

---

## 2. SEO 现状（GSC 实测，2026-10-18）

### 2.1 收录总览

| 指标 | 10-08 基线 | 10-15 | **10-18 实测** | 趋势 |
|---|---|---|---|---|
| **Indexed（已收录）** | 84 | 21 | **3** | ↓↓ |
| **Not indexed（未收录）** | 37,374 | 37,800 | **24,751**（24.8K） | ↓ |
| **Known pages（已知总数）** | 37,458 | 37,821 | **24,754** | ↓ |
| **收录率** | 0.224% | 0.056% | **0.012%** | ↓↓ |

**已收录的 3 个 URL（GSC 原文，含最后抓取日）**：

```
https://awesomevideoprompts.com/en              ← 2026-10-13 被抓
https://awesomevideoprompts.com/ja              ← 2026-10-12 被抓
https://awesomevideoprompts.com/zh-cn/tags/room/ ← 2026-06-13 被抓（旧站 URL，已 301）
```

**读法**：真正属于当前站点的只有 **2 个 locale 首页**。**全站 0 个 prompt 详情页、0 个 tag 页被收录。**
`/zh-cn/tags/room/` 是 6 月就再没抓过的旧站遗留 URL，属于历史残渣，不算成果。

### 2.2 未收录分桶（10 个 reason，GSC 原文）

| 原因 | Source | Pages | Validation 状态 |
|---|---|---|---|
| **Crawled - currently not indexed** | Google systems | **13,076** | ❌ **Failed**（10/02 提交 → 10/05 失败） |
| **Discovered - currently not indexed** | Google systems | **7,414** | 🟡 Passed |
| **Not found (404)** | Website | **3,794** | ❌ **Failed** |
| Excluded by 'noindex' tag | Website | 199 | 🟢 Started |
| Soft 404 | Website | 171 | ⬜ Not Started |
| Page with redirect | Website | 87 | ⬜ Not Started |
| Server error (5xx) | Website | 8 | ⬜ Not Started |
| Blocked by robots.txt | Website | 2 | ⬜ Not Started |
| Alternate page with proper canonical | Website | 0 | N/A |
| Duplicate, Google chose different canonical | Google systems | 0 | N/A |
| **合计** | | **24,751** | |

**两条必须知道的读数**：

1. **`Crawled - currently not indexed` = 13,076 纹丝不动**（10-08 的 13,053 → 10-18 的 13,076）。
   这是 Google **爬过之后主动拒绝**的桶，与可发现性、与 sitemap、与 CF 成本都无关。
   **它的 validation 在 10/05 就已经 Failed 过一次** —— 说明有人点过"验证修复"，Google 复查后判定没修好。
   在根因改变前重复点 Validate 只会再失败一次。

2. **`Discovered - not indexed` 从 20,421 掉到 7,414（−13,007）**，占总减少量的 99.5%。
   这不是"Google 开始收录了"，而是 **sitemap 提交量被主动砍掉后，Google 忘掉了那批只从 sitemap 得知的 URL**（见 §2.3）。
   **Known pages 总数同步从 37,821 掉到 24,754**，是同一个原因。

### 2.3 Sitemap 现状 —— 只提交了全站 4.7% 的 URL

`/sitemap.xml` 是 sitemapindex，GSC 显示：Submitted Oct 9 / **Last read Oct 18（今天）** / **Status Success** / **Discovered 1,083 pages**。

线上实测子表（2026-10-18 `curl`）：

| 子表 | URL 数 | 是否在 index 里 |
|---|---|---|
| `/sitemaps/tags.xml` | 996 | ✅ |
| `/sitemaps/models.xml` | 75 | ✅ |
| `/sitemaps/static.xml` | 12 | ✅ |
| **合计提交** | **1,083** | ← 与 GSC 的 1,083 完全吻合 |
| `/sitemaps/prompts-en.xml` | 7,289 | ❌ **不在 index 里** |
| `/sitemaps/prompts-zh.xml` | 7,289 | ❌ 不在 |
| `/sitemaps/prompts-ja.xml` | 7,289 | ❌ 不在 |
| **可提交但未提交** | **21,867** | |

**这不是 bug，是有意为之**：`src/lib/sitemap-builders.ts:84` 有 `SUBMIT_PROMPT_DETAIL_PAGES = false`
（2026-10-15 设置），代码注释给了完整依据：30 天曝光 204、Google 已爬 13,046 条详情页全拒、每页日均曝光 0.005 次。
子表路由仍然在线（`prompts-en.xml` 等均返回 HTTP 200），改回 `true` 即可一键恢复。

> ⚠️ **文档与代码不一致（需修正）**：`docs/SEO-INDEXATION-PLAN.md` §0.5 与 §3 写的是
> "P2-3 只提交 en 的 prompt 详情页 → 21,468 → ~7,900"。
> **实际线上是 0 条 prompt URL**（`SUBMIT_PROMPT_DETAIL_PAGES = false` 是 10-15 的进一步决策，计划文档未同步）。
> 后续任何人读计划文档都会得出错误结论，建议尽快修订。

### 2.4 抓取统计（GSC，数据截止 2026-10-16）

| 指标 | 10-06 基线 | **10-16 实测** |
|---|---|---|
| Total crawl requests | 8.94K | **8.86K** |
| Total download size | 301 MB | **236 MB** |
| Average response time | 332 ms | **342 ms** |
| 200 占比 | — | 49% |
| **404 占比** | — | **12%** |
| 抓取目的 | — | Refresh **87%** / Discovery **13%** |
| 文件类型 | — | Other 37% / **HTML 29%** / Image 11% / JS 8% |
| Googlebot 类型 | — | Smartphone 70% / Image 14% / Page resource 10% |

**两个信号**：

- **Discovery 只占 13%** —— Google 几乎不再发现新 URL，只在刷新已知的。站点的"可发现性"已经停滞。
- **12% 的抓取喂给了 404**，而 404 页面**不缓存**（§4.2 实测 `cf-cache-status: MISS`）→ 这部分是纯烧 CPU 且零收益。

### 2.5 搜索表现（GSC Performance，2026-07-17 ~ 2026-10-16）

| 指标 | 10-08 基线 | 10-15 | **10-18** |
|---|---|---|---|
| 有曝光的 query 数 | 2 | 2 | **2** |
| 总曝光 | 235 | 204 | **19**（近 3 个月滚动窗口） |
| 总点击 | 4 | 6 | **1** |

**只有 2 个 query**：

```
site:awesomevideoprompts.com    1 click / 18 impressions   ← 自查查询，不是真实需求
awesome video                   0 click / 1 impression     ← 唯一真实 query，1 次曝光
```

**自然搜索实际输入 ≈ 0。** 这解释了为什么 `Crawled - not indexed` 不动：
Google 爬完发现这批页面没有任何查询能承接，判定无索引价值。

### 2.6 外链权威 —— 这是最硬的天花板

GSC Links 报告（2026-10-18 原文）：

```
External links: Total 27
  Top linked pages:  https://awesomevideoprompts.com/en  → 27   ← 全部指向首页
  Top linking sites: x.com 23 | github.com 2 | jyang.top 1 | twstalker.com 1

Internal links: Total 17
  Top linked pages:  https://awesomevideoprompts.com/en  → 17
```

**三个致命读数**：

1. **全站外链只有 27 条**，其中 **23 条来自你自己的 x.com**。第三方真实外链 = 4 条。
2. **27 条全部指向 `/en` 首页，没有任何一条指向任何内容页。**
   即：你 21,867 个详情页 + 996 个 tag 页，**一条外部引用都没有**。
3. **GSC 只数到 17 条内部链接** —— 说明 Google 近期抓取的页面极少（与"只收录 3 页"一致）。

**这就是`Crawled - not indexed` 的真正成因**：在零外链权威下，Google 对新增 URL 的默认判断是"不值得收录"。
代码层面怎么改，都改不动这一条。

### 2.7 三语言重复度（实测）

`curl -A Googlebot` 抓 `/en`、`/zh`、`/ja` 去标签后做 `difflib.SequenceMatcher`：

| 对比 | 正文相似度 |
|---|---|
| en ↔ zh | **87.8%** |
| en ↔ ja | **89.4%** |
| zh ↔ ja | **92.3%** |

页面体积几乎相同（213,700 / 213,798 / 218,397 字节），`<html lang>` 与 `<title>` 是翻译的，
但**正文 88%–92% 完全一致** —— 因为 prompt 原文是英文，只翻译了 chrome（导航按钮等）。

**旁证**：`/en` 和 `/ja` 被收录，而 **`/zh` 被抓取后拒绝**（出现在 `Crawled - not indexed` 的 example 里，最后抓取 10-13）。
Google 在 3 个近似重复页里挑了 2 个，拒了 1 个。这是标准的重复内容行为。

### 2.8 处罚与安全状态：干净（排除了"被惩罚"）

| 检查 | GSC 原文 |
|---|---|
| Manual actions | **No issues detected** |
| Security issues | **No issues detected** |

**这条很重要**：13,076 条 `Crawled - currently not indexed` **不是**处罚造成的，
而是 Google 的**算法判断**（内容质量 / 站点权威 / 搜索需求）。
所以：不存在"申诉解封"这条捷径，只能靠 §6.1 的外链权威和 §6.4 的需求承接来改变判断。

### 2.9 工程修复实测：P0/P1 全部生效（所以这不是代码问题）

按基线文档 §5.3 的矩阵复测 legacy URL（2026-10-18，Googlebot UA，跟随重定向）：

| 旧 URL | 基线 (10-08) | **10-18 实测** | 判定 |
|---|---|---|---|
| `/ja/prompts/2026-02/{slug}/` | 200 / 2 跳 | **200 / 2 跳 → `/ja/prompts/{slug}`** | ✅ |
| `/ja/ja/prompts/2026-02/{slug}/` | **404** | **200 / 2 跳 → `/ja/prompts/{slug}`** | ✅ **P0 已修** |
| `/zh-cn/zh-cn/prompts/2026-02/{slug}/` | **404** | **200 / 2 跳 → `/zh/prompts/{slug}`** | ✅ **P0 已修** |
| `/zh-cn/tags/group-scene/` | 200 / 2 跳 | **200 / 2 跳 → `/zh/tags/group-scene`** | ✅ |

分页路径复测（P1）：

| 路径 | HTTP | robots meta | canonical |
|---|---|---|---|
| `/en/tags/cinematic/p/2` | 200 | 无（可索引） | self ✅ |
| `/en/tags/cinematic/p/3` | 200 | 无（可索引） | self ✅ |
| `/en/tags/cinematic/p/4` | **404** | noindex | — ← 深度上限 3 正确生效 |
| `/en/models/seedance2/p/2` | 200 | 无（可索引） | self ✅ |

`robots.txt` 仍封锁 `?page=` / `?tag=` / `?model=` / `?q=`（与计划 §0 的有意决策一致），并声明 sitemap。

**结论：P0（双前缀 404）与 P1（真实分页路径 + 深度上限）在线上都已正确生效。**
这恰恰证明了核心判断：**收录上不去不是代码没修好，而是代码修好了也无法解决"零权威 + 零需求"。**
不要再在"修技术 bug"上投入，剩余收益极低。

---

### 2.10 内链与孤儿 prompt（实测 —— 唯一明显正向的工程成果）

全量实测（332 个 en tag + 159 个 `/p/N` 页，491 请求，0 超时；详见 `docs/SEO-RECHECK-2026-10-18.md`）：

| 口径 | 可达 | 孤儿 | 孤儿率 |
|---|---|---|---|
| Tier A：tag 第 1 页（与基线口径对齐） | 4,096 | 3,193 | 43.8% |
| **Tier B：tag p1 + `/p/N`（主口径）** | **6,170** | **1,119** | **15.4%** |
| Tier C：+ models / static | 6,297 | 992 | 13.6% |

基线（10-08）`6,804 / 2,061 / 4,743 = 69.7%` → 主口径**孤儿率 −54.3pt，孤儿数 −76.4%**。
（口径自校验：由索引页计数推导的应有分页链接 = 94 tags / 159 links，与实测零差异。）

→ **P1「分页死区」修复确认生效，孤立 prompt 从 4,743 降到 1,119。**
**但这没有转化为收录**（Indexed 反而 21 → 3）—— 再次印证：**可发现性 ≠ 可收录**。
内链已不再是瓶颈，不要再投。

### 2.11 三个待确认的瑕疵（其中一个是真 bug）

**(a) tag 关联数"−72.8%"，大概率是基线口径错误，不是数据丢失**

| | 10-08 基线 | 10-18 实测 |
|---|---|---|
| tag-prompt 关联总数 | 109,596 | **29,821** |
| tag 数 | 313 | 332 |
| 头部 `360` | **3,604** | **4** |
| 头部 `cinematic` | 4,511 | 4,909（↑，正常增长） |
| 头部 `action` | 2,108 | 2,221（↑，正常增长） |

**算术核对**：基线自己的分位数是 `median 19 / p75 80 / p90 188 / max 4,511`。
按这个分布估算全站总和应在 **3–4 万**量级 —— **109,596 比它自己的分位数能支撑的总和高约 3 倍**，
所以基线那个总数很可能是统计口径错误（重复计数）。现在的 29,821 与 `median 15.5 / mean 90` 自洽。
→ **结论：「−72.8%」主要不是真丢数据。**

**但 `360` 从 3,604 → 4 是真实变化**：`/en/tags/360` 实测只有 4 条，
而用 `q=360-degree` 能搜到 **70 条** → tag 归一化把 360 收窄得过头了。
**需要你确认这是否是你跑的 `scripts/_fix_*.py` 的有意结果。** 若是误伤，这是可以免费修的（补 tag 关联即可）。

**(b) ⚠️ hreflang 协议冲突（真 bug，修复成本 $0）**

| 页面 | HTTP 响应头 `Link:` | HTML `<link>` |
|---|---|---|
| `/en` | **`http://awesomevideoprompts.com/en`** ❌ | `https://...` ✅ |
| `/ja` | `https://...` ✅ | `https://...` ✅ |
| `/en/tags/cinematic` | — | `https://...` ✅ |

并且响应头的 `x-default` 指向 **`http://awesomevideoprompts.com/`（根）**，
而 HTML 里的 `x-default` 指向 **`https://awesomevideoprompts.com/en`** —— **同一页面两套冲突信号**。
当前 `Duplicate canonical = 0` 所以不是主要矛盾，但属明显瑕疵，且修复不值钱。
（根因方向：`/en` 走的代码路径从请求 URL 取 protocol，在 CF 反代后拿到的是 `http`。）

**(c) `src/db/queries.ts:207` 的 `listPrompts` 默认 `limit = 24` 仍是旧值**
（调用点都显式传 `PAGE_SIZE`，线上无影响；但以后有人不传就会静默拿 24 条，建议顺手改成 `PAGE_SIZE`。）

---

## 3. Cloudflare 成本现状（摘要，详见成本文档）

| 项 | 实测 | 额度 | 占比 | 计费 |
|---|---|---|---|---|
| **Workers CPU ms**（唯一计费项） | 137.27M（10 天） | 30M / 月 | **457%** | **$2.16** |
| Workers 请求数 | 1.83M（10 天） | 10M / 月 | ~18% | $0 |
| D1 rows read | 1.77B（10 天） | 25B / 月 | 7.1% | $0 |
| D1 rows written | 13.1k | 50M / 月 | 0.026% | $0 |
| R2 存储 / A / B | 1.34 GB-mo / 3.73k / 321.9k | 10GB / 1M / 10M | 13% / 0.37% / 3.2% | $0 |
| Observability Logs | 1.37M | 20M / 月 | 6.9% | $0 |

- 账号是 **Workers Paid $5/月**（不是 Free），30M ms 是 Paid 包含额度，不是免费额度。
- 上一完整周期（Sep 8–Oct 7）实测 **224.56M ms**，账单 $8.68（$5 + ~$3.7 CPU）。
- **10-15 的 CPU 优化没有可测量的效果**：部署后单请求 CPU 反而 **72.0 → 81.7 ms（+13.4%）**，缓存命中率 47.2% → 47.9% 无改善。
- **CRITICAL：只有 CPU 计费。请求数、D1、R2 全部大幅余量。**

**关键结构性事实**：成本 = `缓存未命中的请求数 × 单请求 CPU × $0.02/M ms`。
**请求数有 5.5 倍余量，CPU 超 4.6 倍** → 你的问题是"每请求太贵"，不是"请求太多"。

---

## 4. 边缘缓存实测（决定 SEO 是否免费的关键）

用 Googlebot UA 实测（2026-10-18）：

| URL | HTTP | `cf-cache-status` | `age` |
|---|---|---|---|
| `/en` | 200 | **HIT** | 1259 |
| `/en/tags/cinematic` | 200 | **HIT** | 175 |
| `/en/models/seedance2` | 200 | **HIT** | 14 |
| `/en/prompts/{slug}` | 200 | **HIT** | — |
| `/en/prompts/does-not-exist-12345` | **404** | **MISS** | — |
| `/zh-cn/tags/room/` | **308** | **BYPASS** | — |
| `/ja/ja/prompts/2026-02/.../` | **308** | **BYPASS** | — |

**结论**：

1. ✅ **所有正常页面（含详情页）在边缘是 HIT** —— Googlebot 抓取已缓存页面**不执行 Worker，CPU 计费为 0**。
   `[cache] enabled = true` 生效了（虽然对**用户**流量的 CPU 没帮助，见成本文档 §4.3）。
2. ❌ **404 是 MISS** —— 每次被 Google 抓都完整跑一次 Worker。12% 的抓取流量在这里被浪费掉。
3. ⚠️ **308 重定向是 BYPASS** —— 旧 Hugo URL 每次抓取都不走缓存。而 GSC 的 `Crawled - not indexed`
   example 里明确还有 `/prompts/2026-04/...`（10-11 还在被抓）—— 说明旧 URL 仍在持续消耗抓取预算。

---

## 5. 为什么"成本不是 SEO 的约束"（决定性推导）

### 5.1 Googlebot 占比

```
Googlebot 抓取：GSC "Total crawl requests" = 8.86K
                查看窗口 ≈ 2026-07-20 ~ 2026-10-12（约 84 天）
                → ≈ 105 次/天

站点总请求：    1,827,503 / 10 天 = 182,750 次/天

占比 = 105 / 182,750 = 0.057%
```

### 5.2 折算成钱

```
最坏假设：Googlebot 抓的每一次都是缓存未命中的完整 SSR
         105 次/天 × 81.65 ms/次 = 8,573 ms/天
         月成本 = 8,573 × 30 / 1,000,000 × $0.02 = $0.005 / 月
```

**即使 Googlebot 抓取量放大 10 倍 / 100 倍：$0.05 / $0.5 每月。**

### 5.3 把全部 21,867 个详情页重新塞回 sitemap 的代价

```
一次性：21,867 × 81.65 ms = 1.79M ms
月成本： 1.79M / 1000 × ... = 1,785 / 1000 × $0.02 ≈ $0.036 / 月
```

**≈ 4 美分/月。** 对比当前 $2.16（10 天）的 CPU 账单，这个数字可以忽略。

### 5.4 结论

| 问题 | 答案 |
|---|---|
| 提升收录会不会推高 CF 成本？ | **不会。** SEO 侧的天花板是 $0.5/月量级，即使激进扩张 100 倍 |
| 那 CF 成本该担心什么？ | **用户流量 × 单请求 CPU**。82 ms/请求偏高 + 命中率 46% → 这才是 $2.16 的来源 |
| 省成本和做 SEO 冲突吗？ | **不冲突，方向一致**：§6.2 的两项（404/308 缓存）既降 CPU 又改善抓取效率 |

**所以策略上应当彻底放开"成本护栏"对 SEO 的束缚**（原计划 §5 的 G1–G5 是为 Error 1102 事故设计的，
当时没有缓存；现在边缘命中率已实测 HIT，约束前提已变），
把节省下来的判断力全部投到**外链与需求**这两道真闸门上。

---

## 6. 零 / 负成本提升收录的方案（按杠杆从高到低）

### 6.1 【最高杠杆，CF 成本 $0】修外链权威 —— 唯一能撬动 13,076 的动作

**现状**：27 条外链，23 条来自自己的 x.com，全部指向首页，内容页 0 条。

**这是不需要改代码的事，也是唯一真正有效的事。** 具体：

1. **你已经有现成的最佳渠道：1,015 个 X 原作者。**
   实测确认详情页**已经**外链到原始推文与作者：
   ```html
   <a href="https://x.com/RizwanAly07/status/2110654938472952253"
      class="meta-link meta-link--source" target="_blank" rel="noopener noreferrer">
   <a href="..." class="author-name" ...>
   ```
   JSON-LD 里也有 `"author":{"@type":"Person","name":"RizwanAly07"}`。
   → **1,015 个作者，每人一条"你被收录了"的 outreach，就是 1,015 个潜在真实外链来源**，
   且完全符合站点定位（你不抄内容、署名外链，作者有理由转发）。
   这是当前数据能导出的**最高性价比动作，CF 成本 $0**。
2. **造"可被引用"的资产页**（不是 6,800 条详情页，而是聚合层）：
   - 按模型分：`/en/models/{model}` 已有（75 个 URL），但内容只是列表 → 补成"该模型提示词最佳实践 + 精选 20 条 + 参数速查"。
   - 按场景/年份/榜单：`/en/best/{topic}` 这类**有搜索量的词**（如 "cinematic AI video prompts"、"seedance 2.0 prompts"）。
   - 目标：让别人**有理由**链接到一个页面，而不是链接到你首页。
3. **分发渠道**：x.com 已验证（23 条链接）。扩到 Reddit（r/aivideo, r/StableDiffusion）、HN、GitHub awesome-list PR、AI 工具目录站。
4. **成本**：$0 CF 成本，纯人力。**这一步没做，其余全是优化噪音。**

### 6.2 【负成本】修 404 / 308 的缓存 —— 既省 CPU 又省抓取预算

| 动作 | 现状实测 | 效果 |
|---|---|---|
| **给 404 / 410 加边缘缓存** | 404 = `MISS`，每次都跑 Worker | 12% 的抓取流量不再烧 CPU；成本**下降** |
| **给 308 重定向加缓存** | 308 = `BYPASS`，旧 Hugo URL 持续被抓 | 省 Worker 调用；把抓取预算让给真实页面 |
| **清理仍在被抓的旧 URL** | GSC example 仍有 `/prompts/2026-04/...`（10-11 抓） | 减少 404/redirect 两桶 |

这是**唯一同时降成本 + 提 SEO 的动作**，优先级最高。
注意 404 桶 validation 已 Failed，**必须先修再重新提交验证**，否则会二次失败。

### 6.3 【零成本】三语言重复收敛 —— 提升单 URL 质量密度

**证据**：正文相似度 87.8% / 89.4% / 92.3%；`/zh` 被抓但拒收。

**方案（三选一，按激进程度）**：

| 方案 | 做法 | 提交面 | 风险 |
|---|---|---|---|
| A（保守） | zh/ja 页 `canonical` 指向 en 对应页 | 不减少，但消除重复信号 | hreflang 需同步调整，否则可能冲突 |
| B（推荐） | zh/ja 加 `noindex, follow`，只保 en 作为索引主力 | 提交面降 2/3 | 放弃日文/中文市场（但当前 0 曝光，实际无损失） |
| C（最彻底） | 只保留 en 路由可索引，zh/ja 退化为纯 UI 语言 | 最干净 | 改动最大 |

**成本影响：负**（可抓取 URL 减少 = 抓取预算集中 + 渲染面缩小）。
**前提**：如果未来真的翻译正文（而不是只翻译 chrome），才可以解开。

### 6.4 【零成本】tag 页做深 —— 唯一有真实搜索需求的层

- 996 个 tag URL 已提交，边缘已 HIT，抓取成本 ≈ 0。
- 但**中位数只有 19 条**（尾部大量 1–3 条），头部 `cinematic` 4,511 / `360` 3,604 / `action` 2,108。
- **动作**：
  1. **砍尾部**：内容 < 5 条的 tag 不提交 sitemap（减少低质 URL 稀释）；这一步**降提交量**。
  2. **做深头部 ~30 个**：数据派生概览（数量/时间分布/模型分布）+ 精选 + 使用说明 + FAQ + `ItemList`/`FAQPage` 结构化数据。
  3. 头部 tag 页是目前**唯一有可能承接真实 query** 的页面类型（"cinematic AI video prompts" 这类）。

### 6.5 【零成本】保持详情页不进 sitemap —— 这个决策是对的

`SUBMIT_PROMPT_DETAIL_PAGES = false` 有实测依据（13,076 爬过全拒、每页日均 0.005 曝光）。
**不要因为"想多收录"而改回 true。** §5.3 证明了这不是为了省钱 —— 省钱的理由不成立，
但**效果的理由成立**：提交零需求 URL 只会让 Google 进一步确认"这个站不值得抓"。

**什么时候可以改回 true**：等 §6.1 拿到真实外链、tag/model 页开始有曝光之后，再逐个 locale 灰度。

### 6.6 【省钱，与 SEO 解耦但决定你能否负担扩张】修 CPU 效率

这**不**是 SEO 动作，但它决定 SEO 能不能无痛扩张。三个实测线索：

1. **68.2% 的 D1 rows read 来自 tag 过滤列表页**（单条查询 1.20B rows / 200,886 次），
   而**详情页 slug 查询仅 1,499,313 rows = 0.085%**，「相关/上下篇」在 top-20 里完全没出现。
   → `AGENTS.md` 里"详情页相关/上下篇查询是 99% D1 rows read 来源"的结论**实测不成立，需更正**。
   （不过 D1 只用了 7.1% 额度，不产生费用，所以这条只影响延迟不影响账单。）
2. **单请求 CPU 81.65 ms 偏高 + 全量缓存命中率 46.21%** → 真正的账单来源。
3. **真正该打的是"根本不查缓存"的请求**：可缓存口径命中率其实已经有 **90.6%**，
   剩下的量在 `none`（2,825,273 = 全部**边缘**请求 6,435,070 的 **43.9%**）和 `bypass`（319,812）上 ——
   这两类是**完全不做缓存查找**的请求，10-15 的 `[cache] enabled=true` **没有打中它们**
   （它只是把原先记为 `none` 的请求改记为 `bypass`，命中率反而没动，`miss` 从 13–32k 升到 37–53k）。

> 这条对 SEO 的意义：**先修 CPU 效率，再谈扩张抓取**。不是因为扩张贵（§5 已证明不贵），
> 而是因为 CPU 效率是唯一在花钱的项，修好它能让你在"完全不看成本"的前提下做后续所有 SEO 动作。

---

## 7. 明确不做的事

| 不做 | 原因（都基于本次实测） |
|---|---|
| 为了"多收录"把 21,867 个详情页塞回 sitemap | 13,076 条已被 Google 爬过并拒绝；成本不是理由（只 $0.036/月），**效果才是** |
| 无脑点 GSC 的 "Validate fix" | `404` 与 `Crawled - not indexed` 的 validation **已经 Failed 过一次**，根因未改前重提必再失败 |
| 买外链 / 站群 / 刷索引 | 当前 27 条外链的构成（23 条来自自己账号）已经说明站点没有真实推荐；伪造信号会触发垃圾判定 |
| 重新开启 Workers Cache L2 | 已被 `43948b8` 因成本关闭；且 SEO 侧成本本就不是问题，无必要引入变量 |
| 用"成本"作为限制 SEO 扩张的理由 | §5 已量化：SEO 侧天花板 $0.5/月，100 倍扩张也不影响账单 |

---

## 8. 执行顺序（按"每单位投入的收录收益"排序）

```
第 0 步（顺手，$0，30 分钟）
  └─ 修 §2.11 的三个瑕疵：
       a) /en 的 Link: 响应头 http:// → https://（改取 CF 的 CF-Visitor / X-Forwarded-Proto）
       b) 响应头 x-default 与 HTML 的 x-default 统一到 https://awesomevideoprompts.com/en
       c) queries.ts:207 默认 limit = 24 → PAGE_SIZE
       d) 确认 tag 360 只挂 4 条是否为 _fix_*.py 有意结果；若误伤则补关联

第 1 步（本周，$0，不改代码）
  └─ 修 404 / 308 边缘缓存 + 清理仍在被抓的旧 Hugo URL
       → 立即降 CPU，且把抓取预算从垃圾 URL 让给真实页面
       → 修完等 3-5 天，再对 GSC 的 404 桶重新点 Validate（现在就点会二次 Failed）

第 2 步（本周，$0，纯人力 —— 唯一真正有效的一步）
  └─ 外链：先用现成的 1,015 个 X 原作者做 outreach（详情页已署名外链），
       再开 3 个新渠道（Reddit / HN / GitHub awesome-list）
       每个渠道指向一个**具体内容页**（tag 页或 model 页），不要指向首页

第 3 步（1-2 周，$0）
  └─ 三语言收敛（方案 B：zh/ja noindex,follow）
       提交面 1,083 → ~360，单 URL 质量密度上升

第 4 步（2-4 周，$0）
  └─ 头部 ~30 个 tag 页做深 + 砍尾部 tag（内容 <5 条不提交）

第 5 步（持续）
  └─ CPU 效率排查：打 `none`（43.9%）+ `bypass` 这两类根本不查缓存的请求
       —— 省钱，与 SEO 并行不冲突

第 6 步（4 周后复测）
  └─ 回填 GSC 数据，看 Indexed 是否离开 3
```

**判断标准（诚实版）**：
- **只有第 2 步（外链）可能让 Indexed 离开 3。**
- 第 1、3、4 步是"把地基修干净 + 降低抓取浪费"，会让 `Crawled - not indexed` 的**构成**变健康，
  但**不会**显著提升绝对收录数 —— 因为 13,076 条是 Google 对"零需求 + 零权威"的判决，不是技术故障。
- **第 0、1 步是纯白送的**：修 bug + 省 CPU，不依赖任何外部条件，先做掉。
- ⚠️ **不要再往"修内链/修分页死区"投人力**：§2.10 已实测孤儿率从 69.7% 降到 15.4%（−76.4% 孤儿），
  收录数反而从 21 掉到 3 —— 内链这条路的边际收益已经归零，是本次审计最明确的"别再投"信号。

---

## 9. 数据缺口（下次复测要补）

| 项 | 卡点 | 怎么补 |
|---|---|---|
| Googlebot 精确请求占比与 CPU | CF GraphQL 未按 UA 维度拆分 | 用 `httpRequestsAdaptiveGroups` 加 `userAgent` / `clientRequestPath` 维度试；或 CF Logpush 采样 |
| `Crawled - not indexed` 的完整 URL 清单 | GSC 只给 5 个 example | GSC 里点 "EXPORT" 导出全量（本次未导出） |
| `Discovered - not indexed` 的构成 | 未展开 | 同上导出 |
| CPU 优化真实效果 | 仅 2 个完整部署后自然日 | 再等 1-2 周，前后各 ≥7 天对比 |
| `Error 1102 是否复发 | 未查 | Workers Metrics 里看 5xx / exceededResources |
| `?page=` 分页与 `/p/N` 现状复测 | ✅ **已完成**（本次，见 §2.9 / §2.10） | 详表见 `docs/SEO-RECHECK-2026-10-18.md` |

---

## 10. 对既有文档的更正建议

| 文档 | 原表述 | 应更正为 |
|---|---|---|
| `AGENTS.md` | "D1 cost 控制：详情页相关/上下篇查询是 99% D1 rows read 来源" | **列表页 tag/model 过滤查询占 ~89%**；详情页 slug 查询 avgRows=0 |
| `AGENTS.md` / 所有提到"免费额度"的地方 | "CPU 181M/月 vs 免费 30M" | 账号是 **Workers Paid**，30M 是包含额度；实测上一周期 **224.56M ms** |
| `docs/SEO-INDEXATION-PLAN.md` §0.5 / §3 | "P2-3 提交 en 详情页 ~7,900" | 实际 **0 条**（`SUBMIT_PROMPT_DETAIL_PAGES = false`，2026-10-15） |
| `docs/SEO-INDEXATION-BASELINE-2026-10-08.md` §5.0 | "wrangler OAuth 过期，无法取成本" | `.dev.vars` 有可用 `CLOUDFLARE_API_TOKEN`，注入后 wrangler 全可用（见成本文档 §6.1） |
| `docs/SEO-INDEXATION-BASELINE-2026-10-08.md` §2 | "Sitemap URL 总数 21,429" | 现为 **1,083**（prompt 子表被 `SUBMIT_PROMPT_DETAIL_PAGES=false` 移出 index） |
| `docs/SEO-INDEXATION-BASELINE-2026-10-08.md` §3 根因 A | "70% 的 prompt 没有任何入口链接（4,743/6,804）" | 已修复：主口径 **15.4%（1,119/7,289）**，见 §2.10 |
| `docs/SEO-INDEXATION-BASELINE-2026-10-08.md` §3 根因 B | "tag-prompt 关联总数 ≈109,596" | 实测 **29,821**；且 109,596 与该文档自身分位数不自洽，疑为口径错误，见 §2.11(a) |
| `docs/SEO-INDEXATION-PLAN.md` §5.0 成本护栏 | "G1 可抓取 URL ≤1,500 / G3 请求 ≤1.5×" | 护栏前提是 Error 1102 事故 + 无缓存；现已实测边缘 HIT、请求余额 5.5×，**该护栏应放宽** |
| `docs/SEO-INDEXATION-BASELINE-2026-10-08.md` §5.3 | legacy URL 基线 `200/404/404/200` | 该行**混用了"首跳码"与"终态码"两种口径**；按终态口径现为 `200/200/200/200`（目标达成） |

---

## 11. 已实施：只把 en 送去 SEO（2026-10-18）

用户决策：**zh / ja 不参与 SEO，只送 en。**

### 11.1 改了什么

| 提交 | 内容 |
|---|---|
| `ebd6952` | `seo: 只把 en 送去 SEO，zh/ja 改为 noindex,follow` |
| `703ff69` | `fix(seo): 关闭 next-intl alternateLinks，消除 hreflang 第二来源` |

**核心设计**：新增 `src/lib/seo.ts` 作为**单一真源**

```ts
export const SEO_INDEXABLE_LOCALES = ['en'];   // 想恢复某语言只需改这一行
export const SEO_PRIMARY_LOCALE = 'en';        // x-default 指向它
isSeoIndexable(locale)        // true/false
buildSeoAlternates(localePath) // 只含可索引 locale + x-default
seoRobots(locale, {noindex})   // 非 SEO locale → {index:false, follow:true}
```

三处由它推导：**sitemap 提交面 / hreflang / robots meta**。

**具体改动**：

1. **sitemap 只提交 en** — `tags.xml` 996→332、`models.xml` 75→25、`static.xml` 12→4，
   **合计 1,083 → 361（−67%）**。
2. **zh/ja 全部 `noindex, follow`** — `[locale]/layout.tsx` 兜底，
   首页 / tag 页 / model 页 / 详情页显式调用 `seoRobots()` 保证两处口径一致。
   **不是 robots.txt 封禁**：封了 Google 就看不到 noindex，已收录的 URL 也不会消失。
3. **hreflang 只剩 `en` + `x-default`**。
4. 顺带修 `src/db/queries.ts` 的 `listPrompts` 默认 `limit = 24` → `PAGE_SIZE`。

### 11.2 ⚠️ 踩到的坑：hreflang 有两个来源

改完 metadata 后线上 HTML 已经只剩 `en + x-default`，但 **HTTP 响应头里仍然列出 en/zh/ja**。

根因：**next-intl 3.26 的中间件默认 `alternateLinks: true`**，会按 `routing.locales`
给每个 HTML 响应追加 `Link: <...>; rel="alternate"; hreflang="..."`。
它与页面 metadata 是**两个独立来源**，只改 metadata 完全无效。

顺带解释了长期存在的怪现象：`/en`、`/zh` 的 Link 头是 `http://` 而 `/ja` 是 `https://`
—— 因为 next-intl 从 `x-forwarded-proto` 现取协议。

→ 已设 `createMiddleware({ alternateLinks: false })`，此后 hreflang 唯一真源是页面 metadata。

### 11.3 线上验收（2026-10-18 20:15 CST，两次 CI 均 success）

| 检查 | 结果 |
|---|---|
| `/sitemaps/tags.xml` | **332** 条，zh/ja 命中 **0** |
| `/sitemaps/models.xml` | **25** 条，zh/ja 命中 **0** |
| `/sitemaps/static.xml` | **4** 条，zh/ja 命中 **0** |
| 合计提交面 | **1,083 → 361** |
| `/en`、`/en/tags/cinematic`、`/en/about` | 无 robots 标签（**可索引**），hreflang `en,x-default` |
| `/zh`、`/ja`、`/ja/tags/cinematic` | `robots = noindex, follow`，hreflang `en,x-default` |
| `Link:` 响应头 | **已消失**（不再有第二套 hreflang） |
| `robots.txt` | 未改动，**没有**封 zh/ja（否则 Google 看不到 noindex） |
| 边缘缓存 | 部署后自然失效，关键 URL 已实测为新内容，**未需要 purge** |

测试：`tsc` 0 错；`vitest` **154/154 通过**（新增 `src/lib/seo.test.ts` 12 条不变量 +
sitemap 用例改为由 `SEO_INDEXABLE_LOCALES` 驱动并新增「sitemap 绝不出现 zh/ja」断言）；`next build` 成功。

### 11.4 接下来看什么（别盯错指标）

> **不要再盯 Indexed 总数**。它的分母是 24,754 的垃圾池，这个数字永远难看，也不代表任何东西。
> 改盯这两个：

| 观察项 | 预期变化 | 在哪看 | 什么时候看 |
|---|---|---|---|
| `Excluded by 'noindex' tag` 桶 | 199 → **上升**（zh/ja 从 `Crawled - not indexed` 转移过来） | GSC → Page indexing | **3–7 天后** |
| Known pages 总数 | 24,754 → **下降**（zh/ja 退出已知集） | 同上 | 3–7 天后 |
| Sitemap「Discovered pages」 | 1,083 → **约 361** | GSC → Sitemaps | 1–3 天（需 Google 重读 sitemap） |
| **目标页（361 条里的 model/tag 页）收录率** | 从 2/361 开始爬 | GSC 手动 URL 检查 | 4–8 周 |

⚠️ **这是"收敛"，不是"增长"**：本次改动不会让收录数上升。
它的作用是**停止向 Google 递交重复内容**（三语同正文），把提交面和抓取预算集中到
en 的 tag / model 页 —— 为 §6.1 的外链和 §6.4 的内容深化创造干净的前提。

### 11.5 仍未做（下一步真正能提升收录的）

1. **外链**（§6.1）—— 1,015 个 X 作者 outreach。**唯一可能让 Indexed 离开个位数的动作。**
2. **头部 tag / model 页内容深化**（§6.4）—— 现在 leader 页仍只有 1 个 H2，
   16K 可见字符全是卡片摘要，零编辑性内容（实测）。
3. **404 / 308 边缘缓存**（§6.2）—— 负成本，12% 的 Googlebot 流量浪费在 MISS 的 404 上。
4. **`/en/tags/360` 只挂 4 条**（§2.11a）—— 而 `q=360-degree` 能搜到 70 条，tag 归一化收窄过头，需确认。
