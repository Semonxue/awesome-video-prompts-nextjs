# 静态化机会梳理

> 背景：Cloudflare Workers **免费版**，单请求 CPU 上限 **10ms**。线上持续 Error 1102。
> 本文盘点全站每条路由的静态化可行性，按「投入产出比」排序。
> 数据采集时间：2026-08-07，基于线上实测 + 源码分析。

---

## 0. 先明确两个前提事实（这决定了所有结论）

### 事实 1：现有的两层缓存**全部是空操作**

| 机制 | 现状 | 证据 |
|---|---|---|
| Next.js ISR | **完全未生效** | `defineCloudflareConfig()` 的 `incrementalCache` 默认值是 `"dummy"`（`node_modules/@opennextjs/cloudflare/dist/api/config.js:45`）。所有 `export const revalidate = 3600` 都是装饰性的 |
| CF 边缘缓存 | **完全未生效** | 实测 SSR HTML 响应**没有 `cf-cache-status` 头**；而 `/favicon.svg`、`/_next/static/*` 是 `cf-cache-status: HIT`。原因：CF 缓存位于 Worker **之后**，不缓存 Worker 自己返回的 Response。`middleware.ts:141` 和 `wrappers/cache-control-cloudflare-node.js:77` 设的 `s-maxage=3600` 对 CF 自身无效，只对下游浏览器有意义 |

**结论：目前 100% 的请求都在跑完整 SSR。** 之前多次针对 1102 的修复（`05743dc` 删 vary、`a4223b7` sitemap 走 wrapper、`3c82855` single-flight）都没有触及这个根因。

### 事实 2：CPU 的大头是 React SSR，不是数据查询

| 操作 | CPU 量级 | 10ms 内可行？ |
|---|---|---|
| React SSR 渲染整页 | 50–200ms | ❌ |
| D1 查一条 + `JSON.stringify` | 1–3ms | ✅ |
| R2 读对象直接透传 | 1–3ms | ✅ |
| Cache API 命中 | <1ms | ✅ |

**推论：只要 HTML 不在请求时渲染，免费版就够用。** 反之，任何优化查询的努力都救不了（那些是 I/O 等待，本来就不算 CPU）。

---

## 1. 🔴 最高优先级：查询串爬取放大（这不是静态化，但影响更大）

**这是目前最严重、最容易修、收益最大的问题。**

全站有 6 处把标签/模型链接指向了**首页的查询串变体**：

```
src/components/PromptCard.tsx:225   href={`/${locale}?model=${modelLabel}`}
src/components/PromptCard.tsx:298   href={`/${locale}?tag=${tag.slug}`}
src/components/Header.tsx:157       href={`/${locale}?model=${m.slug}`}
src/components/Header.tsx:186       href={`/${locale}?tag=${tt.slug}`}
src/app/[locale]/prompts/[slug]/page.tsx:239  href={`/${locale}?tag=${tag.slug}`}
src/app/[locale]/prompts/[slug]/page.tsx:252  href={`/${locale}?model=${m.slug}`}
```

而 `PromptCard` 每页出现 24 次，每张卡最多 4 个 tag 链接 + 1 个 model 链接 →
**每个列表页向爬虫暴露约 120 个动态首页 URL。**

这些 URL：
- `page.tsx:35-39` 标了 `index: false`，但 **`follow: true`** —— 爬虫照样会抓
- `robots.ts:16` 是 `allow: '/'`，**没有对查询串做任何 Disallow**
- 内容与 `/tags/[tag]` 和 `/models/[model]` **完全重复**（后者才是 canonical 版本）

**净效果：1486 个 tag × 3 语言 = 4458 个零 SEO 价值的 URL，被爬虫反复抓取，每次都是一个完整 SSR miss。**
真人流量只有 500/天，压垮 Worker 的是这个自我放大的爬取面。

### 修法（改动极小，收益立竿见影）

1. 把这 6 处链接全部改成指向 canonical 页面：`?tag=x` → `/tags/x`，`?model=x` → `/models/x`
2. `robots.ts` 增加 `disallow: ['/*?tag=', '/*?model=', '/*?q=', '/*?page=']`

**副作用是好的**：改完之后首页就不再需要处理 `?tag`/`?model` 了，为第 2 节的首页静态化直接扫清障碍。

---

## 2. 路由级静态化盘点

页面规模（线上 `_cache/*.json` 实测）：prompts **4479**、tags **1486**、models **49**。

| 路由 | 页数(×3语言) | 阻碍静态化的因素 | SEO 权重 | 难度 |
|---|---|---|---|---|
| `/[locale]` 首页 | 3 | `?tag/model/q/page`（**均已 noindex**） | 高（canonical） | ★ 易 |
| `/[locale]/prompts/[slug]` | **13,437** | 3 个全局依赖 | **最高** | ★★ 中 |
| `/[locale]/tags/[tag]` | 4,458 | `?page`（>1 已 noindex） | 中 | ★ 易 |
| `/[locale]/models/[model]` | 147 | `?tag`/`?page`（均已 noindex） | 中 | ★ 易 |
| `/[locale]/tags` | 3 | 无 | 低 | ★ 易 |
| `/[locale]/models` | 3 | 无 | 低 | ★ 易 |
| `/[locale]/about` | 3 | 无 | 低 | ★ 已可静态 |
| `/sitemap.xml` | 1 | 无 | 高 | ★ 易 |
| `/robots.txt` | 1 | 无（`force-dynamic` 是**多余的**） | — | ★ 已可静态 |
| **合计** | **≈18,054** | | | |

### 2.1 首页 —— 你的判断完全正确 ✅

首页的动态部分**全部已经是 `noindex`**（`page.tsx:35-39`）：

```ts
const isLowValue =
  (sp.page && parseInt(sp.page, 10) > 1) ||
  Boolean(sp.q) || Boolean(sp.tag) || Boolean(sp.model);
```

也就是说 **`?tag=` / `?model=` / `?q=` / `?page=` 这些变体对 SEO 零价值**，而且 `/api/prompts` 已经能提供完整的分页 + 筛选数据（`api/prompts/route.ts`），`GridEngine.tsx:96` 已经在用它做无限滚动。

**所以首页只需要静态化「无筛选 + 第 1 页」这一个版本**，其余全部交给客户端走 API：

- 搜索 → 客户端调 `/api/prompts?q=`（`Header.tsx:57` 现在是 `router.push`，改成本地状态即可）
- 标签/模型筛选 → 改成跳转 `/tags/x`、`/models/x`（见第 1 节，本来就该这样）
- 翻页 → `GridEngine` 的无限滚动已经在做了

**首页静态版本数：3 个（每语言 1 个）。**

### 2.2 详情页 —— 占 74% 的页面量，是重点

4479 × 3 = 13,437 页，占全站 74%，且 SEO 权重最高（`page.tsx:137-166` 输出 `Article` + `VideoObject` + `BreadcrumbList` 三段 JSON-LD）。

当前每次渲染的开销：

| 依赖 | 代价 | 是否必要 |
|---|---|---|
| `getPromptBySlugCached(slug)` `:99` | 1 次 D1 | ✅ 必要 |
| `listRecentPromptsCached(48)` `:107` | 拉 48 行**全字段**（含最长的 `description`）+ hydrate 出 48 份 tag/model | ❌ 只为挑 6 条相关 + 2 条上下篇 |
| `listAllModels()` + `listAllTags()` `:131` | 2 次 R2 读 + **128KB JSON 解析** + **1535 个对象序列化进 RSC 载荷** | ❌ 详情页没传 `activeTag`/`activeModel`，这两排 tab 纯装饰 |

> 实测佐证：首页因为同样的 `Header` 全量传参，HTML 有 **303KB，其中 77%（235KB）是 RSC 载荷，含 1520 个 tag/model 对象**——而页面上只渲染了 13 个 model chip + 15 个 tag chip。详情页背着同样的包袱。

**这三个全局依赖同时是「CPU 大户」和「增量生成的障碍」** —— 摘掉它们，每个详情页就变成纯粹是它自己那行数据的函数，发布 1 条 = 生成 1 页。

改法：
1. 详情页**不给 `Header` 传** `modelOptions`/`tagOptions` —— `Header.tsx:149`/`:177` 已有 `length > 0` 判断，会自动隐藏这两排 tab
2. `listRecentPromptsCached(48)` 拆成两条专用 SQL：
   - 上下篇：按 `promptDate` 前后各取 1 条，只 select `slug/title/coverUrl`
   - 相关推荐：按共享 tag/model JOIN 取 6 条，只 select 卡片需要的列

### 2.3 tag / model 页

`?page`、`?tag` 变体均已 noindex → 同首页逻辑，只静态化第 1 页，翻页交给客户端。

`tags/[tag]/page.tsx:86` 仍在调 `listAllTags()` 拿全量 1486 个 tag 传给 `Header`，与详情页同病，同法可治。
`models/[model]/page.tsx:95` 已经做了 `.slice(0, 12)`，是**目前唯一做对的地方**，可作为其他页面的改造参照。

### 2.4 tags / models 索引页

`tags/page.tsx` 把 1486 个 tag 全部渲染成 chip，`models/page.tsx` 同理。两者都是纯函数式的全局数据，**发布时生成一次即可**。

### 2.5 sitemap.xml

13,437 个 URL 构造成一个巨型数组 → 塞进 Cache API → 每次 miss 重新 `JSON.parse` → 再序列化成 XML。CPU 很重。

改法：发布时直接生成静态 XML 文件写 R2。若超过 50,000 URL / 50MB 再考虑分片（当前远未触及）。

### 2.6 robots.txt

`robots.ts:9` 的 `export const dynamic = 'force-dynamic'` 是**为了绕过缓存问题加的，但那个前提本身是错的**（见事实 1：wrapper 设的 `s-maxage` 对 CF 无效）。内容是完全静态的，应该直接静态化。

---

## 3. 增量生成：为什么不会「越来越慢」

`next build` 全量预渲染 18,054 页约需 5–20 分钟，且 **`next build` 本质不支持增量**（`.next/cache` 只加速编译，预渲染每次全跑）。

但**发布一条 prompt，真正需要重算的页面只有约 20–25 个**：

```
它自己的详情页        × 3 语言 =  3
首页第 1 页           × 3 语言 =  3
它所属的 tag 页       × 3 语言 = 3~9
它所属的 model 页     × 3 语言 =  3
相邻两篇（上下篇变了） × 3 语言 =  6
────────────────────────────────
合计约 20–25 页 → 几秒钟
```

相关推荐即使短暂过期也无害，不必级联重算。

**前提是先完成 2.2 的解耦** —— 否则「改一条影响全部」，增量无从谈起。

全量生成只在两种情况下需要：**首次迁移**（一次性）和**改模板/样式后**（低频，可挂 GitHub Actions，仓库公开所以 Actions 时长免费）。

建议把增量生成挂在现有的 `tools/md-editor/`（`server.py` + `/api/admin/publish`）里 —— 它本来就跑在本机、知道刚发布的是哪个 slug、没有时间限制。

---

## 4. 产物托管：为什么建议 R2 而不是 Workers Assets

Next.js App Router 静态导出每个路由产出 `.html` + `.txt`（RSC 载荷）两个文件：

| 方案 | 文件数 | Workers Assets / Pages 上限 20,000 |
|---|---|---|
| 3 语言全量 | ≈36,000 | ❌ 超出 |
| 3 语言 + 裁剪长尾 tag（count<3 共 1108 个） | ≈29,000 | ❌ 超出 |
| 仅 en | ≈12,100 | ✅ 可行 |

**R2 没有文件数限制**，所以若要保留三语言，产物应放 R2，配一个**不含 Next.js 的瘦 Worker**（约 100 行）：
`middleware.ts:77` 的 `legacyRedirect()` 逻辑原样搬过来 + pathname 映射 R2 key + 套一层 Cache API。CPU 约 1–3ms。

> 附注：三个语言的**正文内容完全相同**，只有 UI 文案翻译。这本身对 SEO 是负担（近似重复内容）而非资产。若愿意收敛到 en-only，可直接用 Workers Static Assets，连 R2 和瘦 Worker 都省了。这是个值得单独评估的产品决策。

---

## 5. 建议的推进顺序

| 阶段 | 内容 | 风险 | 收益 |
|---|---|---|---|
| **P0** | 第 1 节：6 处链接改指 canonical 页 + robots 屏蔽查询串 | 极低 | **最大** —— 直接砍掉 4458 个 URL 的爬取面 |
| **P0** | 第 2.2 节：详情页摘掉 3 个全局依赖 | 低（纯减法，无用户可见变化） | 大 —— 占 74% 页面量，且为增量生成铺路 |
| **P1** | `tags/[tag]`、首页的 `Header` 全量传参同法收敛 | 低 | 中 |
| **P1** | `readAggregateCache()` 接入 `cache.ts` 的 `getCachedData()` 加内存层 | 低 | 中 —— 免去同实例内重复解析 149KB JSON |
| **P2** | 观察 1102 发生率，再决定是否推进完整静态化 | — | — |
| **P3** | 静态导出 + 增量生成 + R2 + 瘦 Worker | 高（架构改动） | 根治 |

**P0 两项是纯减法，不改变任何用户可见行为，建议立刻做。**
做完之后再观察一段时间，很可能不需要走到 P3 就已经稳定了。

---

## 附：本文结论所依据的实测数据

```
# 线上响应（2026-08-07 07:0x UTC）
/en                    连续 12 次请求仅 1 次 200（3.48s），其余 503
/en/about              503
/sitemap.xml           503
/api/prompts?page=1    503
/favicon.svg           200  cf-cache-status: HIT
/_next/static/*.js     200  cf-cache-status: HIT
→ SSR 路由全线 1102，静态资源正常

# 首页 HTML 构成（那次 200 的响应）
总 HTML                303,191 字符
RSC flight 载荷        235,490 字符 (77%)
序列化的 tag/model 对象  1,520 个
实际渲染的 chip          model 13 + tag 15

# R2 聚合缓存文件（每次请求重新拉取并解析，无内存层）
_cache/tags.json        123,900 bytes
_cache/model-tags.json  147,391 bytes
_cache/counts.json       20,713 bytes
_cache/models.json        4,137 bytes

# 数据规模
prompts 4479 / tags 1486 / models 49
tags 中 count<=1 的有 835 个，count<=3 的有 1108 个
```
