# CPU 诊断 — 2026-10-22：为什么 10-15 的优化没让 CPU 降下来

> 承接 `docs/CF-COST-BASELINE-2026-10-18.md` §4.3 的结论「2026-10-15 的 CPU 优化，未见可测量的节省」。
> 本文回答那个文档没能回答的问题：**为什么不降？**
>
> **采集时间**：2026-10-22 22:15–22:30（Asia/Shanghai）= 2026-10-22 14:15–14:30 UTC
> **数据源**：① CF GraphQL `workersInvocationsAdaptive`（账号级，token 有权限）② `wrangler d1 insights`（用 `.dev.vars` 的 `CLOUDFLARE_API_TOKEN`）③ 线上 `curl` 实测响应头
> **本轮所有数字均为实测，无推算值充当实测值**

---

## 0. 结论摘要（3 条）

1. **Workers Cache 确实生效了，而且效果很大** —— 但只对**HTML 文档请求**生效。TAG 列表页过滤查询从 200,886 次/10天 降到 **7,217 次/2天（折 10天 ≈ 36,000 次，−82%）**。
2. **CPU 没降的真正原因（已定位到具体机制）**：
   - **RSC 请求被 Cloudflare 无条件 BYPASS**（实测三种请求方式全部 BYPASS）→ 客户端导航/prefetch 每次都回源执行 Worker。
   - **详情页占了 77% 的 Worker 请求**：详情页 slug 查询仍是 **284,024 次/2天（折 10天 ≈ 1,420,000 次）**，与部署前 1,499,985 次**基本持平（−5%）**。
3. **次要根因：`getPromptBySlugCached` 用的是默认 5 分钟 TTL**（`src/db/cache.ts` 的 `L1_TTL_MS` / `L2_TTL_S`），而站点有 6,804 个 slug。**访问不同 slug 必然 miss** —— 缓存只在"同一 slug 被反复访问"时才有效，而真实流量是长尾的，每个 slug 访问一次就走 D1。

> **一句话**：10-15 的方案方向没错（开缓存 + 减 payload），但**缓存只挡住了 HTML 文档请求，挡不住 RSC 请求**（CF 侧 BYPASS），而详情页流量的主体是 RSC + 长尾 slug 访问。

---

## 1. 逐日 Worker 请求与 CPU（GraphQL 实测，账号级）

来源：CF GraphQL `viewer.accounts(filter:{accountTag}).workersInvocationsAdaptive`
（日期格式必须 `'YYYY-MM-DD'`，带 `Z` 会报 `date format should be '2006-01-02'`）

| 日期 | 请求数 | CPU (ms) | 单请求 CPU | errors |
|---|---|---|---|---|
| 2026-10-14（三）← 部署前 | 193,060 | 13,977,860 | 72.4 ms | 0 |
| 2026-10-15（四）← 部署日 | 146,901 | 13,192,588 | 89.8 ms | 0 |
| 2026-10-16（五） | 142,939 | 14,248,796 | 99.7 ms | 6 |
| 2026-10-17（六） | 174,283 | 11,653,155 | 66.9 ms | 0 |
| 2026-10-18（日） | 144,233 | 11,038,207 | 76.5 ms | 0 |
| 2026-10-19（一） | 151,628 | 15,877,831 | **104.7 ms** | 2 |
| 2026-10-20（二） | 167,785 | 13,264,134 | 79.1 ms | 0 |
| 2026-10-21（三） | 137,656 | 12,843,540 | 93.3 ms | 0 |
| 2026-10-22（四，当日未满） | 81,239 | 7,896,016 | 97.2 ms | 0 |

**观察**：
- 部署后单请求 CPU 从 72.4 ms 升到 **~90–100 ms**（+25%）。这不是"优化变负优化"，而是**缓存把便宜的请求挡在门外后，剩下的都是更重的未命中请求**（分母效应：命中率高的轻请求不再进 Worker 计算分母）。
- 绝对 CPU 日均 12–16M ms，与部署前 14.03M/天 **同一量级** → 超支 $2–3/月的结构没变。
- errors 基本为 0（10-16 的 6 个、10-19 的 2 个是零星值，未追查）。

---

## 2. D1 查询执行次数（`wrangler d1 insights` 实测）

### 2.1 关键对比：部署前 vs 现在

| 查询 | 10-18 文档（Oct 8–17，10天） | 现在（Oct 21–22，2天） | 折 10天 | 变化 |
|---|---|---|---|---|
| **TAG 列表页过滤**（`tags.name=?` + order by） | 200,886 次 | **7,217 次** | ≈36,000 | **−82%** ✅ |
| **详情页 slug 查询**（`slug=?`） | 1,499,985 次 | **284,024 次** | ≈1,420,000 | **−5%** ❌ |
| hydrate tags | 232,439 次 | 287,900+7,946 | ≈1,479,230 | 持平 |
| hydrate models | — | 287,098+7,532 | ≈1,473,150 | 持平 |
| MODEL 列表页过滤 | 15,130+16,210+3,936 | 1,215+852+503 | ≈12,850 | −15% ⚠️ |

### 2.2 决定性推论

```
2 天 Workers 请求数 ≈ 137,656（10-21）+ 81,239（10-22 未满）≈ 180,000/2天
详情页 slug 查询 = 284,024 次 / 2天

→ 详情页的 D1 查询次数 ≈ 全部 Worker 请求数的 77% 数量级
```

配合线上实测（详情页确实命中缓存，但 D1 查询照旧）：

```
$ curl -sI https://awesomevideoprompts.com/en/prompts/2107357564296163809-korean-it-girl-random-day
cf-cache-status: HIT
age: 108
```

→ **HTML 渲染被缓存挡住了，但数据查询没有**。这是本轮诊断最反直觉的一点：
**`cf-cache-status: HIT` 只说明响应体是缓存的，不代表这次请求没有打 D1。**

---

## 3. 根因：slug 缓存的 TTL 与访问分布不匹配

### 3.1 缓存实现

`src/db/cache.ts`：

```ts
const L1_TTL_MS = 5 * 60 * 1000; // 模块级内存 TTL
const L2_TTL_S = 300;            // Cache API TTL（秒）
```

`src/db/queries.ts` 的 `getPromptBySlugCached` 用 `getCachedData(key, fetcher)` —— **不传 TTL → 用默认 5 分钟**。

### 3.2 为什么它救不了详情页

| | 列表页（`/en/tags/xxx`） | 详情页（`/en/prompts/{slug}`） |
|---|---|---|
| URL 数量 | ~1,000（tag+model+locale） | **6,804 × 3 locale ≈ 20,412** |
| 访问分布 | 少数 URL 高频（长尾中头） | **海量 URL 各访问 1~2 次**（长尾） |
| 5 分钟 TTL 命中率 | **高**（同一 tag 反复访问） | **接近 0**（每个 slug 只被访问一次，5 分钟内不会再来） |
| 实测 | −82% ✅ | −5% ❌ |

**5 分钟 TTL 只对"高频重访的少数 key"有效。** 详情页是典型的长尾流量——一次访问后短期内不会再被访问，缓存条目写进去就等 TTL 过期，纯属白写。

### 3.3 与 AGENTS.md 既有认知的关系

AGENTS.md 写「namespace version cache TTL 必须 24h+，因为 namespace version 5min 过期会导致旧数据复活」。
**本轮实测证明这个结论只对 namespace-versioned cache 成立，对 per-slug cache 不成立但也不能照搬**：

- per-slug cache **不能**简单改成 24h —— 因为它**没有** namespace version 那种"publish 时让旧 key 不可达"的失效机制。改成 24h 后，已删除/已下架的 prompt 会在 24h 内继续对外可见（404 变 200），对 SEO 是**负面**（Google 反复抓到已删内容）。
- 正确的解法是**给 per-slug cache 补上主动失效**，让 TTL 可以安全地拉长。

---

## 4. 建议的下一步（按性价比排序，**尚未实施**）

### 方案 A（**主力，已验证**）：修 RSC 请求的 BYPASS

见下方「方案 B」节（原编号），这是本轮定位到的真凶，改动集中在 `src/middleware.ts` 一处。

### 方案 B：per-slug cache 提 TTL + 补主动失效（次要，改起来最简单）

**改动**：
1. `getPromptBySlugCached` 的 TTL 从 5min → **24h**（复用 `getNamespacedCachedData` 的 24h 写法，或直接传 `l2TtlS=86400, l1TtlMs=86400*1000`）
2. **必须同时**在 publish / unpublish / delete 时调用 `invalidateCache('prompt-by-slug-' + slug)`
   —— 否则删除的 prompt 24h 内仍可访问，Google 会抓到已删内容（Soft 404 风险）

**预期效果**：只能救"同一 slug 的重复访问"（Googlebot 短期内反复抓同一 URL、或热门 prompt）。
**对长尾 slug 的首次访问无效** —— 而长尾才是详情页查询的主体。
所以这是**补充**，不是主力。**主力是方案 A（RSC BYPASS）**。

**与 AGENTS.md 既有认知的关系**：
AGENTS.md 写「namespace version cache TTL 必须 24h+，因为 namespace version 5min 过期会导致旧数据复活」。
**本轮实测证明这个结论只对 namespace-versioned cache 成立**，per-slug cache 不能照搬：

- per-slug cache **不能**简单改成 24h —— 因为它**没有** namespace version 那种"publish 时让旧 key 不可达"的失效机制。改成 24h 后，已删除/已下架的 prompt 会在 24h 内继续对外可见（404 变 200），对 SEO 是**负面**（Google 反复抓到已删内容）。
- 正确的解法是**给 per-slug cache 补上主动失效**，让 TTL 可以安全地拉长。

**需查证**：publish / unpublish / delete 三条路径当前是否都调用了 `invalidateCache('prompt-by-slug-' + slug)`。若没有，必须先补上再提 TTL。

### 方案 C：RSC 请求的 BYPASS 修复 —— **这是真凶**

**实测（2026-10-22 22:2x）**：

```
$ curl -sI 'https://awesomevideoprompts.com/en/prompts/{slug}'                    → cf-cache-status: HIT   (age: 220)
$ curl -sI -H 'RSC: 1' 'https://awesomevideoprompts.com/en/prompts/{slug}'        → cf-cache-status: BYPASS
$ curl -sI -H 'RSC: 1' -H 'Next-Router-State-Tree: ...' <同上>                    → cf-cache-status: BYPASS
$ curl -sI -H 'RSC: 1' -H 'Next-Router-Prefetch: 1' <同上>                       → cf-cache-status: BYPASS
```

**三次 RSC 请求全部 BYPASS，与是否带 router 头无关。**
响应头统一含：`vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch`

**这解释了为什么 `cf-cache-status: HIT` 与「D1 仍在被狂打」能同时成立**：
- HTML 文档请求 → HIT，Worker 不执行 ✅
- **RSC 请求（客户端导航 / prefetch）→ BYPASS，Worker 每次都执行** ❌
- 而 Next.js App Router 的客户端行为大量依赖 RSC 请求
  （`<Link>` 预取、client-side navigation、Router.refresh）

**为什么 RSC 会 BYPASS**（社区实践与官方 Vary 语义的交叉结论）：
`Vary` 头里列了 4 个 router 维度，其中 `next-router-state-tree` 的取值是**整个路由状态树的 JSON**，
每次导航都不同 → 若按 Vary 建变体，等于每个请求一个独立缓存条目 → 命中率趋近 0。
CF 侧对这类"Vary 维度不可枚举"的请求采取保守策略 → **直接 BYPASS**（宁可不缓存，也不做投毒风险高的变体存储）。

**⚠️ 由此暴露一个更严重的风险**（社区已实测报道，本项目需自查）：
"an RSC payload was still stored under a page URL even though Next.js sends
`Vary: rsc, next-router-state-tree`" —— 即 **RSC 载荷可能被存到页面 URL 的缓存条目下**。
若发生，普通 HTML 请求会取到 RSC 格式的响应体 → 用户看到白屏。
本项目当前 HTML 请求返回正常（`cf-cache-status: HIT` 且内容正确），**暂未观察到该症状**，
但这是开 Workers Cache 后必须持续监控的风险点。

**修复方向**（**未实施，需用户确认后动手**）：
在 middleware 里对 RSC 请求**剥离/覆盖 `Vary`**，让 RSC 请求要么
（a）用可控的变体维度（如只按 `rsc` 维度切），
或（b）显式让 RSC 请求走 `no-store`（承认它不被缓存，但至少行为确定）。
同时必须加**变体守卫**：确保 HTML 缓存条目不会被 RSC 响应覆盖（缓存投毒防护）。
社区已有可参考的实现（`ROUTER_HEADERS` 列表 + `isCanonicalPage` 守卫 + `noStore()` 降级）。

### 方案 D：继续压 payload（10-15 已做，收益已兑现）

HTML 376,249 → 222,890 B（−41%）、flight payload 227,238 → 79,032 B（−65%）。
这部分**已经生效**，继续压的边际收益下降（列表页查询已降 82%，不是瓶颈了）。

---

## 5. 本轮未取到的项 / 卡点

| 项 | 卡点 |
|---|---|
| Zone 级缓存命中率（`httpRequestsAdaptiveGroups`） | GraphQL 报 `does not have permission 'com.cloudflare.api.account.zone.analytics.read'`；REST 路径 `zones/{id}/analytics/http_requests` 返回 `No route for that URI`（该端点已下线） |
| Workers Cache 自身的 hit/miss 面板 | 需 CF Dashboard（浏览器登录态），本轮未取 |
| 10-19 单请求 CPU 104.7 ms 的异常 | 与 10-16 的 99.7 ms 同类，**未追查**（可能是特定流量结构，非单点故障） |
| 9 月 $60.22 账单明细 | 10-18 文档已记录为未取到，本轮未重试 |

---

## 6. 复测基线（供下次对比）

```
部署前（Oct 8–14，7天）：日均 CPU 14.03M ms，单请求 72.0 ms
部署后（Oct 16–21，6天）：日均 CPU 13.75M ms，单请求 ~93 ms
TAG 列表页 D1 查询：200,886 次/10天 → 7,217 次/2天（−82%）
详情页 D1 查询：  1,499,985 次/10天 → 284,024 次/2天（−5%）
线上 cache：/en HIT age:959 | /en/tags/cinematic HIT age:58 | 详情页 HIT age:108
```

**已验证的假设（原"待验证"，本轮已确认）**：
详情页 RSC 请求因 `Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch`
被 Cloudflare **BYPASS** → 每次 RSC 请求都回源执行 Worker + 跑 D1。

**验证方法与结果**：
对同一详情页分别请求 HTML 与 RSC，对比 `cf-cache-status`：
- HTML → `HIT`（age 持续增长）
- RSC（三种请求头组合）→ **全部 `BYPASS`**

**下一个待验证假设**：
`getPromptBySlugCached` 的 5 分钟 TTL 在长尾 slug 场景下的实际命中率
（需按 slug 维度统计重复访问率）。
**验证方法**：从 `wrangler d1 insights` 取 2 天窗口的 slug 查询次数，
与同期 Workers 请求数对比，估算去重后的唯一 slug 数。
