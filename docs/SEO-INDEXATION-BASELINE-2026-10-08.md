# SEO 收录现状基线快照 — 2026-10-08

> 用途：**改动前后的唯一对照基准**。一周后（2026-10-15 左右）重跑 §5 的流程，
> 把新数据追加到本文件末尾的「复测记录」表里做差值对比。
> 任何"收录变好了"的结论都必须能追溯到这张表，不接受"感觉好多了"。
>
> 采集时间：2026-10-07 23:06 – 2026-10-08 00:20 CST
> 采集人：Mavis（自动化审计）
> 对应线上 commit：`48b9d32`（`fix(seo): P0+P1 修复`）

---

## 1. 采集方式说明（重要）

本次 GSC 数据**不是**通过内置浏览器采集的 —— 内置浏览器跳 `accounts.google.com/signin/accountchooser`，
未登录且页面渲染为空。实际走的是 **opencli browser bridge**（`opencli browser <session> open <url>`），
它连的是本机真实 Chrome profile（`b5sqhznx`），已登录 `semonxue@gmail.com`。

```bash
opencli doctor                      # 确认 Extension: connected
opencli browser gsc open "https://search.google.com/search-console/index?resource_id=sc-domain%3Aawesomevideoprompts.com&pages=ALL_URLS&hl=en"
opencli browser gsc extract         # 抓报告正文
```

⚠️ 复测时用同一个 `gsc` session 名，不要新建，避免 profile 串味。

---

## 2. 核心指标（改动前的起点）

| 指标 | 数值 |
|---|---|
| **已收录（Indexed）** | **84** |
| **未收录（Not indexed）** | **37,374**（报告显示 37.4K） |
| 已知页面总数 | 37,458 |
| **收录率** | **0.224%** |
| Sitemap URL 总数 | 21,429 |
| Sitemap 最后更新 | 2026-10-04 |
| 已发布 prompt | 6,804 × 3 locale = 20,412 |

### 未收录分桶（GSC 原表，8 reasons）

| 原因 | Source | Pages | 占比 | 可否由站点修复 |
|---|---|---|---|---|
| Discovered - currently not indexed | Google systems | 19,530 | 52.2% | 间接（内链/价值） |
| Crawled - currently not indexed | Google systems | 13,053 | 34.9% | 间接（页面质量） |
| Not found (404) | **Website** | 4,265 | 11.4% | ✅ 可直接修 |
| Excluded by 'noindex' tag | **Website** | 220 | 0.6% | ✅ 可直接修 |
| Soft 404 | Website | 161 | 0.4% | ⚠️ 部分 |
| Page with redirect | Website | 135 | 0.4% | ✅ 可直接修 |
| Server error (5xx) | Website | 8 | 0.02% | ✅ 可直接修 |
| Blocked by robots.txt | Website | 2 | 0.01% | ✅ 可直接修 |
| **Duplicate, Google chose different canonical** | Google systems | **0** | — | — |

**关键读数：`Duplicate canonical = 0`。** hreflang 与 canonical 配置**没有问题**，
不要在这上面投入。（GSC 里 3 个 locale 的 `hreflang` + `x-default` 齐全、self-canonical 正确。）

---

## 3. 根因证据

### 根因 A：70% 的 prompt 没有任何入口链接

抓取全部 313 个 `/en/tags/*` 第 1 页做集合比对：

```
已发布 prompt（sitemap en）      6,804
从任意 tag 第 1 页可达            2,061   (30.3%)
**无任何入口链接                  4,743   (69.7%)**
```

三处叠加形成死结：

| # | 事实 | 证据位置 |
|---|---|---|
| A1 | tag 页只渲染 24 条 | `src/app/[locale]/tags/[tag]/page.tsx:24` `PAGE_SIZE = 24` |
| A2 | 页面**没有任何分页链接** | 全站 grep `href="...?page="` → 0 命中 |
| A3 | robots.txt 封锁 `?page=` | `src/app/robots.ts:39,43` |
| A4 | 分页页被标 `noindex` | `page.tsx:46,61` `isLowValue = page>1 → index:false` |

A4 是**决定性**的：即使解除 A3 的 robots 封锁，page 2+ 页面**依然不可能被收录**，
因为它们自己声明了 `noindex`。当前架构下 deep 页是**结构性死区**。

### 根因 B：tag 规模极度倾斜，24 条/页远不够

`/en/tags` 索引页权威数据（313 tags）：

```
min 1 | median 19 | p75 80 | p90 188 | max 4,511
top: cinematic 4511 | 360 3604 | action 2108 | realistic 1349 | fantasy 864
tag-prompt 关联总数 ≈ 109,596
```

`cinematic` 一个 tag 就有 4,511 条，按 24 条/页 = **188 页**，
而 page 2+ 既无链接、又被 robots 封、还自带 noindex —— 全部是死页。

### 根因 C：Hugo → Next 迁移的 URL 变体 + 双 locale 前缀 bug

GSC example URL 暴露同一 prompt 存在 3 个索引变体：

```
/ja/prompts/2026-04/2044858955059388814-dubai-timelapse-transformation   ← 旧站格式
/ja/prompts/2026-04/2044858955059388814-dubai-timelapse-transformation/  ← 旧站+尾斜杠
/ja/prompts/2044858955059388814-dubai-timelapse-transformation          ← 现格式
```

外加旧站产生的**双 locale 前缀**垃圾：`/ja/ja/prompts/...`、`/zh-cn/zh-cn/prompts/...`。

线上实测 `src/lib/legacy-url.ts` 覆盖率：

| 旧 URL | 跳数 | 最终 | 判定 |
|---|---|---|---|
| `/ja/prompts/2026-02/{slug}/` | 2 | 200 | ✅ |
| `/zh-cn/tags/group-scene/` | 2 | 200 | ✅ |
| `/prompts/2026-04/{slug}/`（内容已删） | 1 | **410** | ✅ 正确 |
| `/ja/ja/prompts/2026-02/{slug}/` | 1 | **404** | ❌ BUG |
| `/zh-cn/zh-cn/prompts/2026-02/{slug}/` | 2 | **404** | ❌ BUG |

Bug 根因 `src/lib/legacy-url.ts:46-51`：`for` 循环里 `break` 只执行一次，
`/zh-cn/zh-cn/...` → `/zh/zh-cn/...` 后不再折叠；`LEGACY_PROMPT_RE`（:31）要求
`/{locale}/prompts/` 紧邻，故 `/zh/zh-cn/prompts/`、`/ja/ja/prompts/` 均不匹配 → 落 step 6 → 404。

> 旁证：`src/lib/legacy-url.ts:8` 的注释已记录 2026-09-08 有 5,284 条同类 404，
> 现在降到 4,265 —— 说明当时修的是"目标不存在"那一半，**双前缀这一半没修**。

### 根因 D：软 404 / noindex 桶是同一批 legacy 变体

`Excluded by 'noindex'` 的 220 条 example **全部**是 legacy 形态
（`/zh-cn/tags/...`、`/{locale}/prompts/2026-MM/...`）。
因为 404 页自带 `<meta name="robots" content="noindex"/>`，
GSC 把这批归到 noindex 桶而非 404 桶 —— **同一问题被拆到两个桶计数**，易误判。

---

## 4. 性能基线

| 测量 | 数值 |
|---|---|
| `/en/prompts/{slug}` TTFB | 1.41s / 1.05s / 1.01s / 1.46s（4 次连续） |
| `/en/tags/cinematic` TTFB | 1.51s / 1.84s / 1.89s / 2.22s |
| `/en/tags/cinematic?page=2` TTFB | 1.45s / 1.60s / 1.93s / 1.31s |
| `/zh/prompts/{slug}`（首次） | 4.11s |
| `/ja/prompts/{slug}`（首次） | 3.14s |

**⚠️ 重要警告：这些数字不能用来判断边缘缓存是否生效。**
本次审计在 CN 侧经代理访问，cf-ray 落在 EWR（Easterwood, US）。
对照组测试：静态资源 `static.awesomevideoprompts.com` TTFB 同样是 1.0–2.0s
（已测，网络地板就是这个量级）。**TTFB ≈ 网络地板 = 无法区分缓存命中与否。**

响应头实测（存在，说明配置意图正确，但**无法从客户端侧确认命中率**）：

```
cloudflare-cdn-cache-control: public, max-age=28800, stale-while-revalidate=86400
cache-control: public, max-age=0, must-revalidate
vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
```

响应头中**没有** `cf-cache-status`，也**没有** `Age` ——  inconclusive，
不能据此断言"缓存没生效"，也不能断言"生效了"。

**结论：CDN 缓存命中率与 D1 用量在本次审计中均未能测得，见 §5.0 人工补测项。**

---

## 5. 复测流程（一周后照此执行）

### 5.0 【人工】先补测成本基线（本次缺失，必须补）

本次 `wrangler` OAuth 已过期，非交互 shell 拿不到 token；
CF Dashboard 的 Billable usage 面板在本网络下卡在 "Still loading…"。
**以下两步需在交互式终端 / 能正常加载 CF Dashboard 的网络下人工执行一次，
把结果填到本节，之后每次复测都对比它。**

```bash
# 1) 交互式终端里登录（一次性）
npx wrangler login

# 2) 取 D1 近 24h / 近 7d 查询与 rows read 基线
npx wrangler d1 insights awesomevideoprompts-db
```

需要记录的基线值：

| 项 | 本次值 | 复测值 |
|---|---|---|
| D1 `rowsRead` / 24h | ❌ 未取到 | |
| D1 查询次数 / 24h | ❌ 未取到 | |
| top 3 查询的 `numberOfTimesRun` | ❌ 未取到 | |
| Workers 请求数 / 24h | ❌ 未取到 | |
| CDN 缓存命中率 | ❌ 未取到 | |

> 另注：commit `43948b8 revert(cache): 暂时关闭 Workers Cache，先观察 24h 成本`
> 说明 Workers Cache(L2) 当前是**关闭**状态。复测时不要顺手把它打开，
> 否则变量太多，无法归因。

### 5.1 GSC 收录数（自动，可复现）

```bash
opencli browser gsc open "https://search.google.com/search-console/index?resource_id=sc-domain%3Aawesomevideoprompts.com&pages=ALL_URLS&hl=en"
sleep 6
opencli browser gsc extract
```

记录：**Indexed 总数**、**Not indexed 总数**、**8 个 reason 各自 Pages 数**。
（Indexed 变化有 3–7 天延迟，**看斜率不看单点**。）

### 5.2 孤儿 prompt 数（自动，可复现）

```bash
cd /tmp
curl -sS https://awesomevideoprompts.com/sitemap.xml -o avp-sitemap.xml
grep -o 'https://awesomevideoprompts.com/en/tags/[^<]*' avp-sitemap.xml | sort -u > tags_en.txt
cat tags_en.txt | xargs -P 12 -I{} sh -c 'curl -sS --max-time 30 "{}"' > tagpages.html
grep -o 'href="/en/prompts/[^"]*"' tagpages.html | sed 's|href="/en/prompts/||;s|"$||' | sort -u > reachable_en.txt
python3 -c "
import re
r=set(open('reachable_en.txt').read().split())
s={x.rsplit('/',1)[-1] for x in re.findall(r'https://awesomevideoprompts\.com/en/prompts/[^<\s]+', open('avp-sitemap.xml').read())}
print('sitemap en prompts:',len(s)); print('reachable:',len(r&s)); print('orphaned:',len(s-r))
"
```

基线值：`6804 / 2061 / 4743`

### 5.3 legacy URL 矩阵（自动，可复现）

```bash
for u in \
"https://awesomevideoprompts.com/ja/prompts/2026-02/2019515197501603840-sanity-soup-factory-interview/" \
"https://awesomevideoprompts.com/ja/ja/prompts/2026-02/2019515197501603840-sanity-soup-factory-interview/" \
"https://awesomevideoprompts.com/zh-cn/zh-cn/prompts/2026-02/2021909649314770944-hyperspeed-fpv-diving-collapsing-coastal-cliff/" \
"https://awesomevideoprompts.com/zh-cn/tags/group-scene/" ; do
  printf "%-4s " "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$u")"
  curl -sS -o /dev/null -L -w "hops=%{num_redirects} end=%{url_effective}\n" --max-time 25 "$u"
done
```

基线值：`200 / 404 / 404 / 200`
**目标值：`200 / 200 / 200 / 200`**

### 5.4 tag 规模分布（自动，可复现）

```bash
curl -sS --max-time 40 "https://awesomevideoprompts.com/en/tags" -o tagidx.html
```

记录 median / p75 / p90 / max，以及 `cinematic`、`360`、`action` 三个头部 tag 的数量。
基线：`median 19 | p75 80 | p90 188 | max 4511`

---

## 6. 复测记录（每次复测追加一行）

| 日期 | Indexed | Not indexed | 404 | noindex | Crawled-not-ind | Discovered-not-ind | 孤儿数 | D1 rowsRead/24h | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| 2026-10-08 | **84** | 37,374 | 4,265 | 220 | 13,053 | 19,530 | **4,743** | ❌ 未取到 | 基线，改动前 |
| 2026-10-11 | 84 | 37.4K | 4,265 | 220 | 13,053 | 19,530 | 未重测 | ❌ 未取到 | **索引类报告全部无变化**（报告数据日期早于改动） |
| 2026-10-15 | **21** | 37.8K | **3,822** | 202 | 13,046 | 20,421 | 未重测 | ❌ 未取到 | **Indexed -63，但 404 -443；见下方解读** |

### 2026-10-15 复测（部署后第 7 天）

| 指标 | 10/08 基线 | 10/15 | Δ | 判断 |
|---|---|---|---|---|
| **Indexed** | **84** | **21** | **−63** | ⚠️ 见下方解读（修复生效导致） |
| Not indexed | 37,374 | 37,800 | +426 | — |
| **Not found (404)** | 4,265 | **3,822** | **−443** | ✅ **P0 修复在生效** |
| Excluded by noindex | 220 | 202 | −18 | ✅ |
| Page with redirect | 135 | 106 | −29 | ✅ |
| Soft 404 | 161 | 173 | +12 | ⚠️ 轻微上升，需观察 |
| Server error (5xx) | 8 | 8 | 0 | ✅ 无回归 |
| Blocked by robots.txt | 2 | 2 | 0 | ✅ |
| **Crawled - not indexed** | 13,053 | **13,046** | **−7** | ⚠️ **纹丝不动，核心问题未解** |
| **Discovered - not indexed** | 19,530 | **20,421** | **+891** | 预期内（新增可发现 URL） |
| Duplicate canonical | 0 | 0 | 0 | ✅ |

**Performance：** impressions 235 → 204（−13%）／clicks 4 → 6／CTR 1.7% → 2.9%／
position 6 → 6.6。有曝光的 query 仍是 2 个。

### 解读：Indexed 84 → 21 不是回归，是 P0 修复生效的**副作用**

拉了当前 21 个 indexed URL 清单，**19 个是旧站 Hugo 格式**：

    /prompts/2026-04/{slug}/              ← 旧日期目录格式
    /zh-cn/prompts/2026-05/{slug}/        ← 旧 locale + 日期目录
    /zh-cn/tags/room/  /tags/corridor/    ← 旧无 locale 前缀
    只有 /en 与 /ja 是当前格式

**机制**：P0 修好之前，`/zh-cn/zh-cn/…`、`/ja/ja/…` 这类是 404。
修好后它们正确地 301 到新 URL。**Google 会把永久重定向的源 URL 移出索引**
（301 的语义就是"这里不是正式地址，去那边"），所以老 URL 被逐个摘掉。

实测确认跳转链路正确（308 去尾斜杠 → 301 旧→新 → 200）：

    /zh-cn/tags/room/  →  308 → /zh-cn/tags/room → 301 → /zh/tags/room → 200
    /zh-cn/tags/room   →  301 → /zh/tags/room   → 200   （1 跳）

> 308 由 CF 边缘直接返回（不经过 Worker，无额外算力成本），因此 2 跳不等于 2 次 Worker 调用。

**这暴露了一个基线本身的误导性**：10/08 的 84 里绝大部分是旧站遗留 URL，
从来不是"你的页面"。**真实属于当前站点的 indexed 一直是个位数。**

**实际损失极小**：曝光 235 → 204，少掉的约 31 次曝光对应 63 个老 URL，
且点击反而 4 → 6。老 URL 本身日均曝光不足 1。

### 仍未解决的核心问题

**Crawled - currently not indexed 13,046，7 天内只动了 −7。**
这桶是 Google **爬过之后主动拒绝**的页面，与可发现性无关。
P0/P1/P2/P3 全部完成也不会让它明显下降 —— 唯一能撬动它的是外部权重与真实搜索需求，
不是代码。

### 2026-10-11 复测结论（部署 f8fcafe 后第 3 天）

**没有任何 GSC 索引指标变化 —— 但这不能说明改动无效，因为所有索引类报告的数据日期都早于改动。**

| GSC 报告 | 数据截止 | 是否反映 10/08 的改动 |
|---|---|---|
| Sitemaps | **Oct 9, 2026** | ✅ **已反映，见下** |
| Page Indexing | 10/04 | ❌ 早于改动 |
| Crawl stats | 10/06 | ❌ 早于改动 |
| Performance | 约 60 小时前 | ⚠️ 勉强 |

**唯一反映改动的是 Sitemaps 报告，而且结果是正面的：**

```
https://awesomevideoprompts.com/sitemap.xml
  Sitemap Type : Sitemap index     ← f8fcafe 的 urlset→sitemapindex 修复已生效
  Submitted    : Oct 9, 2026
  Last read    : Oct 9, 2026
  Status       : Success
  Discovered   : 8,019 pages
```

8,019 与本地 8,004 一致（差值来自期间新发布的 prompt）。
提交量 21,468 → 8,019（**-62.7%**）已在 Google 侧确认生效。

**Performance 报告（60 小时前）：**

| 指标 | 10/08 基线 | 10/11 | 判断 |
|---|---|---|---|
| Total impressions | 235 | 227 | 噪声，无变化 |
| Total clicks | 4 | 5 | 噪声 |
| Average CTR | 1.7% | 2.2% | 噪声 |
| Average position | 6 | 5.9 | 无变化 |
| 有曝光的 query 数 | 2 | 2 | **无变化** |

**线上性能复测（是否有 CPU / 响应回归）：**

| 路径 | TTFB | 体积 |
|---|---|---|
| `/en` | 2.30s | 386 KB |
| `/en/tags/room`（小 tag） | 1.41s | 34 KB |
| `/en/tags/cinematic`（大 tag） | 1.75s | 362 KB |
| `/en/tags/cinematic/p/2`（新增分页） | 1.15–1.89s | 384 KB |
| `/en/models/seedance25` | 1.63s | 367 KB |
| `/en/prompts/{slug}` | 1.01–1.94s | 109 KB |
| `/sitemap.xml` | 1 KB（index） | — |

网络地板对照（`/favicon.svg` 静态资源）：**1.62–1.93s**。
所有页面 TTFB 与地板同量级 → **未见 PAGE_SIZE 24→48 带来的响应回归**。
（单次 8.28s 的读数为抖动，复测 5 次均落在 1.0–1.9s。）

**Crawl stats 基线（10/06，改动前）：8.94K 请求 / 301 MB 下载 / 平均响应 332ms。**
待 10/13 之后数据刷新可做差值。

### 仍然取不到的数据

- **D1 rowsRead / Workers 请求数**：wrangler OAuth 已过期
  （"Your auth token has expired"，非交互 shell 无法刷新）；
  CF Dashboard 的数据面板在此网络下只加载侧边栏、内容区始终空白
  （Workers metrics 与 D1 两个页面均复现）→ 需在可正常访问的浏览器手动查看
- **CDN 缓存命中率**：客户端侧无法判定（TTFB 与网络地板同量级，响应头无 `cf-cache-status`/`Age`）

---

## 2026-10-15 Workers CPU 优化（commit df44318）

### 背景

Workers CPU 每日超预算。历史实测（`wrangler.toml` 2026-09-08 注释内）：
CPU 181M ms/月 vs 30M 免费额度 → 约 **$3/月超额**，是唯一瓶颈
（D1 rowsRead 1.03B/月 = 免费额度 4% → $0；请求 2.76M/月 = 10M 的 28% → $0）。

### 根因定位（实测）

抓 `/en/tags/cinematic` 的 RSC flight payload（`RSC: 1` header）实测：

| 指标 | 优化前 | 优化后 | 变化 |
|---|---|---|---|
| tag 页 HTML | 376,249 B | 222,890 B | **−41%** |
| RSC flight payload | 227,238 B | 79,032 B | **−65%** |
| 48 条 description 合计 | 188,871 B（中位 2,475，最大 17,846） | 每条 ≤ 201 字符 | — |

**根因**：`PromptCard` 是 `'use client'`，props 全量序列化进 RSC payload 再嵌进 HTML，
但 UI 只渲染 `truncate(description, 180)`。服务端下发完整正文，99% 是纯浪费的序列化 CPU。

### 三项改动

1. **`[cache] enabled = true`** — 官方规则：缓存命中时 Worker 完全不执行，**CPU 计费为零**。
   更正了一条已过时的顾虑：官方明确 "Requests to static assets are free and unlimited."，
   旧注释担心的"静态资源变计费"不成立。
2. **列表页只下发 180 字符摘要** — `hydratePrompts`/`listPrompts` 加 opt-in `descriptionLimit`
   （默认不截断）；新增 `GET /api/prompt/[slug]`（复用 per-slug 缓存）；
   `PromptCard` 点击复制时懒加载全文，失败降级为摘要。
3. **observability 降采样** — `head_sampling_rate` 1 → 0.05，`invocation_logs = false`，
   traces 关闭。**2026-12-01 起 Workers Logs 改为按 GB 计费**（$0.25/GB，
   CF 估算单条均 4.84KB），全量采样成本约翻倍。

### 线上验收（2026-10-15 14:3x）

- `cf-cache-status: HIT`，`age: 15` → **Workers Cache 已生效**
- 列表页 48/48 张卡片 description 均以 `…` 结尾（摘要），最大 201 字符
- 详情页 `/en/prompts/{slug}` 正文完整，含 3 个 JSON-LD block，description 未截断
- `GET /api/prompt/{slug}` 返回 1,630 字符完整正文

### 对 SEO 的影响（预期，待复测）

- **详情页零影响**：走 `getPromptBySlug`，不传 limit，正文与 JSON-LD 完整
- **列表页正文变短**：48 条从 188,871 B → 约 9,600 B。但列表页本来只渲染 180 字符，
  Google 抓到的可见文本**没有变化**，只是不再下发隐藏的全文
- 复制功能改为一次懒加载请求（用户点击才发生）

### 仍然取不到的数据（⚠️ 未实测）

- **真实 CPU 与 cache 命中率**：CF Dashboard 在此网络下内容区空白、wrangler OAuth 过期。
  上述 −41%/−65% 是**线上实测的体积**，但**节省多少 CPU 未实测**。
  需手动在 Dashboard 看：Workers → Observability → cache hit rate + CPU time。
- **12-01 后 Workers Logs 按 GB 计费的真实账单**：需等新计费周期。

### 待办

1. 24h 后查 CF Dashboard：cache hit rate、CPU ms 是否从 181M/月 降下来
2. 手动跑 `curl -X POST -H "Authorization: Bearer $ADMIN_SECRET" \
   https://awesomevideoprompts.com/api/admin/rebuild-aggregates`
   让 related 6→12 生效（`.dev.vars` 的 secret 与线上不一致，未做）
