# Awesome Video Prompts (Next.js) — 执行母版

> 状态：Phase 2 完成（架构骨架 + 数据层 + D1 接通 + 部署走通）
> 仓库：`awesome-video-prompts-nextjs`（独立仓库）
> 最后更新：2026-06-26

---

## 0. 决策记录：为什么是新建仓库

**背景**：原计划是在 `awesome-video-prompts` 仓库的 `feature/nextjs-v3` 分支上做迁移，但实操中发现：

1. **git 历史污染**：原 init commit 含 14k+ 老 Hugo 文件，Phase 1 改任何东西都被淹没
2. **merge 必爆**：将来合回 main 时几乎每条都会 conflict
3. **dev 体验糟**：本地 dev 时 `git status` 全是噪音

**决策**：建独立仓库 `awesome-video-prompts-nextjs`，只搬运需要的资产（CSS / i18n / schema），老仓库降级为**只读数据源**。

---

## 1. 项目目标

### 1.1 业务目标
- 把 `awesome-video-prompts.com`（老 Hugo 站）迁到 Next.js + Cloudflare Workers
- 解决 Cloudflare Pages **20000 文件硬限制**（老站 deploy 65145 文件 / 17GB）
- 维持三语言（en/zh/ja）+ SEO + 老 URL 301 兼容
- **2026-06-26 增量**：先部署到独立 Workers `awesome-video-prompts-nextjs.semonxue.workers.dev`，**不切主域**；等稳定 + UAT 通过后再切 `awesomevideoprompts.com`

### 1.2 技术目标
- **架构**：Next.js 15 App Router + Cloudflare Workers（via OpenNext）
- **数据**：D1（`awesomevideoprompts-db`）存 prompts 元数据 + R2（`awesome-video-prompts-media`）存媒体
- **渲染策略**：SSR 运行时 + ISR 1h 缓存（**不用** build-time JSON 索引）
- **国际化**：next-intl 3.x，locale 前缀路由（`/en` `/zh` `/ja`）
- **样式**：保留老站 1126 行 CSS，渐进式适配

### 1.3 老仓库定位
- `awesome-video-prompts`（老 Hugo）→ **只读数据源**
- MD 内容留在老仓库，import 脚本读相对路径
- 媒体文件保留在老 R2 bucket（共用），新项目通过自定义域 `static.awesomevideoprompts.com` 访问

---

## 2. 当前基线

### 2.1 老站数据规模
- MD 文件：~13437 个（4479 prompts × 3 语言）
- 媒体文件：~39169 个（视频 mp4 + 封面 jpg，每个 prompt 约 2 个）
- 总可 deploy 文件：**65145**（超 Pages 20000 限制 3x+）
- deploy 体积：~17GB

### 2.2 新站目标规模
- deploy 文件目标：**< 100**（不计 node_modules / .open-next）
- deploy 体积目标：**< 5MB**
- 静态 JSON：0（D1 是唯一数据源，运行时直接查 + ISR 边缘缓存）

### 2.3 当前实际数据（2026-06-26）
- 远程 D1 `awesomevideoprompts-db` 状态：**10 条 en prompts**（测试种子）
- 覆盖月份：2025-02 / 2025-12 / 2026-01
- 覆盖模型：kling26 / seedance2 / seedance1.5pro / grok / kling3
- locale 分布：`{"en": 10}`（zh/ja 空）
- tags + models 关联表已填充

### 2.4 文件数门禁线
| 阶段 | 目标 | 预警 | 阻断 |
|---|---|---|---|
| Phase 1 骨架 | < 50 | 80 | 100 |
| Phase 2 数据层 + 部署走通（当前） | < 100 | 150 | 200 |
| Phase 3 UAT-1（30 条种子 + 视觉对齐） | < 120 | 180 | 250 |
| Phase 4 UAT-2（4479 全量） | < 200 | 300 | 500 |

---

## 3. 目标架构

```
┌─────────────────────────────────────────────────────────┐
│  用户                                                     │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  Cloudflare Edge                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Workers (Next.js App Router via OpenNext)        │   │
│  │  - next-intl middleware (locale 路由)              │   │
│  │  - ISR 1h + revalidate API                        │   │
│  │  - getCloudflareContext() 拿 D1 binding            │   │
│  └──────────────────────────────────────────────────┘   │
│            │                          │                  │
│            ▼                          ▼                  │
│  ┌──────────────────────┐  ┌─────────────────────┐      │
│  │  D1 (awesomevideoprompts-db) │ R2 (media bucket)  │      │
│  │  5 表 + 4 索引          │  │  static.*.com       │      │
│  └──────────────────────┘  └─────────────────────┘      │
└─────────────────────────────────────────────────────────┘
```

### 3.1 数据流

**单一数据源**：D1 是所有读路径的唯一数据源，**不**预生成 JSON 索引、不 build-time 注入静态数据。

```
首页 /en 请求
  ↓
Cloudflare Edge (ISR 缓存层，TTL = 1h)
  ├─ 缓存命中（1h 内同 URL）→ 直接返回 HTML，0 次 D1 调用
  └─ 缓存未命中 / 首次 → Workers getCloudflareContext() 拿 DB → 查 D1 → 渲染 HTML → 写回缓存
  ↓
返回 HTML 给用户

详情页 /[locale]/prompts/[slug]、/tags/[tag]、/models/[model] 同模式
```

### 3.2 D1 Query 模式（两步法）

每个列表查询拆成 3 步，**避免 N+1**：
1. **主表分页**：`SELECT * FROM prompts WHERE locale=? AND is_draft=0 ... LIMIT 24 OFFSET 0`
2. **批量查 tags**：`SELECT prompt_id, name FROM prompt_tags JOIN tags ... WHERE prompt_id IN (?,?,...)`
3. **批量查 models**：`SELECT prompt_id, slug, name FROM prompt_models JOIN models ... WHERE prompt_id IN (?,?,...)`
4. JS 端按 `promptId` 索引拼成 `PromptCardData[]`

单次列表查询 = 3 次 D1 round-trip（10~20ms 总耗时），比单次 JOIN + group_concat 易读且易调试。

### 3.3 媒体外置
- 老 R2 bucket `awesome-video-prompts-media` + 自定义域 `static.awesomevideoprompts.com`
- 媒体 URL 形式：`https://static.awesomevideoprompts.com/prompts/{YYYY-MM}/{slug}/cover.jpg`
- 新项目不动 R2，URL 原样使用

---

## 4. 路由级渲染策略

| 路径 | 渲染 | ISR | 缓存策略 | 状态（2026-06-26） |
|---|---|---|---|---|
| `/[locale]` | SSR | 1h | edge cache | ✅ 10 条 en 已渲染 |
| `/[locale]/prompts/[slug]` | SSR | 1h | edge cache | ✅ 详情页 200 |
| `/[locale]/tags` | SSR | 1h | edge cache | ⚠️ 页面存在但内容空（Phase 1 骨架） |
| `/[locale]/models` | SSR | 1h | edge cache | ⚠️ 同上 |
| `/[locale]/about` | SSR | 1h | edge cache | ✅ 200 |
| `/api/revalidate` | Workers dynamic | — | no cache | ⏸ 待验证 |
| `static.*.com/...` | R2 public | — | CDN | ✅ 老 CDN 共用 |

### 4.1 URL 变化（待 Phase 5 灰度期配 CF Rules）
| 老 URL | 新 URL | 状态 |
|---|---|---|
| `/zh-cn/...` | `/zh/...` | ⏸ |
| `/prompts/YYYY/MM/slug/` | `/{locale}/prompts/slug/` | ⏸ |
| `/tags/{name}/` | `/{locale}?tag={name}` 或 `/{locale}/tags/{name}/` | ⏸ |
| `/models/{slug}/` | `/{locale}?model={slug}` 或 `/{locale}/models/{slug}/` | ⏸ |

---

## 5. D1 Schema

文件：`drizzle/migrations/0000_init.sql`

```sql
CREATE TABLE prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  video_url TEXT,
  cover_url TEXT,
  source_url TEXT,
  author TEXT,
  prompt_date TEXT,                     -- ISO 8601 YYYY-MM-DD 或 YYYY-MM-01
  is_draft INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_prompts_slug_locale ON prompts(slug, locale);
CREATE INDEX idx_prompts_prompt_date ON prompts(prompt_date DESC);
CREATE INDEX idx_prompts_locale ON prompts(locale);
CREATE INDEX idx_prompts_is_draft ON prompts(is_draft);

CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
CREATE TABLE prompt_tags (prompt_id, tag_id, PRIMARY KEY (prompt_id, tag_id));
CREATE TABLE models (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
CREATE TABLE prompt_models (prompt_id, model_id, PRIMARY KEY (prompt_id, model_id));
```

### 5.1 关键决策
| 项 | 决策 | 原因 |
|---|---|---|
| `prompt_date` 类型 | TEXT ISO 8601 | D1 无原生 DATE；ISO 排序天然按字典序=时间序 |
| `created_at`/`updated_at` | TEXT ISO 8601 + NOT NULL | 同上；NOT NULL 强制写入 |
| 是否上 FTS5 | **不上** | CJK FTS5 分词效果差，全用 LIKE %q% 兜底；老站实测可行 |
| 是否用 KV | **不用** | CF Cache API 替代；KV 增加 binding 复杂度 |
| `is_draft` | INTEGER 0/1 | D1 无原生 BOOLEAN |
| 多对多关联 | `prompt_tags` / `prompt_models` 中间表 | 跨多表 JOIN 灵活 |

---

## 6. 关键脚本

### 6.1 `scripts/import-md-to-d1.ts` ✅ 实装
- 读 `LEGACY_CONTENT_DIR`（默认指向老仓库 `content/`）
- 解析 MD front matter（用 `gray-matter` + `parse-md.ts`）
- 写 D1：
  - `--local`：拼 SQL file → `wrangler d1 execute --local --file=`
  - `--remote`：D1 HTTP API batch（100/批）
- 幂等：`INSERT OR IGNORE` + `UNIQUE(slug, locale)`
- 支持 `--limit N` 截断（Phase 2 验证用 10 条，Phase 3 扩到 30 条，Phase 4 跑全量）
- 支持 `--dry-run` 只解析不写入

### 6.2 `scripts/seed-from-old.ts` ⏸ Phase 3 占位
- 从老仓库随机抽 30 条种子（覆盖月份+模型+标签多样性）
- 当前是 stub，待 Phase 3 实装

### 6.3 `scripts/migrate-cold-hot.js` ⏸ Phase 3 R2 用
- 把老 R2 上 4479 prompts × 2 媒体文件分类
- hot（封面图）保留自定义域访问
- cold（视频）按需迁移到 R2

---

## 7. 执行阶段（6 个 Phase）

### Phase 0：仓库初始化 + 文档冻结 ✅
- ✅ 创建 `awesome-video-prompts-nextjs` 仓库
- ✅ 配置 package.json / wrangler.toml / next.config.ts
- ✅ 复制核心资产（main.css / parse-md.ts / i18n / schema）

### Phase 1：架构骨架 ✅
- ✅ 8 个组件：`Header` / `Footer` / `LangSwitcher` / `GridEngine` / `PromptCard` / `MobileFilters` / `TagDisplay` / `CopyButton`
- ✅ 5 个页面：`/[locale]` / `/[locale]/prompts/[slug]` / `/[locale]/about` / `/[locale]/tags` / `/[locale]/models`
- ✅ `seed-from-old.ts` 占位
- ✅ 单元测试 40 passing
- ⚠️ 列表页 `listPrompts` / `getPromptBySlug` 等 query 是 stub（"Phase 2 实现后真实查 D1"）

### Phase 2：数据层实装 ✅
- ✅ D1 schema 远程执行（5 表 + 4 索引，70KB）
- ✅ `import-md-to-d1.ts` 实装：本地 wrangler + 远程 HTTP API 两种模式
- ✅ 远程 D1 灌入 10 条 en 测试数据
- ✅ `src/db/queries.ts` 4 个函数真查 D1（listPrompts / getPromptBySlug / listAllTags / listAllModels）
- ✅ `src/types/cloudflare-env.d.ts` 模块扩展让 `env.DB: D1Database` 在 TS 里可见
- ✅ OpenNext `getCloudflareContext({ async: true })` 拿 D1 binding
- ✅ Cloudflare Workers 部署成功：https://awesome-video-prompts-nextjs.semonxue.workers.dev
- ✅ 部署版本：`8c5fe82c-deae-47e5-a377-47e087f2a385`
- ⏸ `/api/revalidate` 端到端验证
- ⏸ 视觉 1:1 还原（视觉对齐老站，Phase 3 实装）

### Phase 3：UAT-1 演示数据 ⏳
- ☐ 灌 30 条种子到 D1（en/zh/ja 各 10 条）
- ☐ 视觉 1:1 还原（masonry 瀑布流 / 视频 hover / 详情页 meta grid / Copy prompt）
- ☐ 移动端筛选抽屉
- ☐ 三语言 UI 文案完整化
- ☐ Lighthouse 评分 ≥ 90
- ☐ Playwright e2e 关键路径

**UAT-1 验收**：
- [ ] 三语言页面可访问，筛选/分页正常
- [ ] 视频 hover 预览与老站一致
- [ ] `/api/prompts?locale=zh&tag=cinematic` 可消费
- [ ] 文件数 < 80，部署体积 < 5MB
- [ ] 三语言 UI 完整（无英文 fallback）

### Phase 4：UAT-2 全量数据 ⏳
- ☐ 全量 import 4479 prompts × 3 语言 = 13437 条
- ☐ 性能压测（CF Cache 命中率、ISR 命中、D1 查询延迟）
- ☐ SEO 对齐（hreflang / sitemap / robots）
- ☐ 老 URL 301 规则部署
- ☐ Sitemap / robots.txt 生成

**UAT-2 验收**：
- [ ] 全量数据对账通过（vs 老 Hugo 静态站）
- [ ] SEO 字段完整（meta description / og:image / hreflang）
- [ ] 性能阈值（LCP < 2.5s @ P75，CF Cache 命中率 > 90%）
- [ ] 错误率 < 0.1%（24h 监控）
- [ ] 文件数 < 200

### Phase 5：灰度切流 ⏳
- ☐ 新站部署到 `v3.awesomevideoprompts.com`（子域名）
- ☐ CF Rules 配灰度分流（10% → 30% → 50% → 100%）
- ☐ 每档必过项：可用性 / 延迟 / R2 命中率 / D1 查询稳定
- ☐ 全量后切主域 `awesomevideoprompts.com`，老站降级归档
- ☐ **不在本项目做**（由 CF Dashboard 配路由 + DNS）

**UAT-3 验收**：
- [ ] 主域 100% 流量到新站
- [ ] 老 URL 301 全过
- [ ] 7 天 0 严重事故

### Phase 6：后续优化 ⏳
- ☐ 历史数据治理（重复 prompt 去重 / 标签字典规范化）
- ☐ MD editor 工具升级（与新站 deploy 流程协同）
- ☐ 监控告警（CF Analytics + 自建 health check）
- ☐ Plausible / CF Analytics view-more 点击率
- ☐ R2 视频迁移（去依赖老 CDN）
- ☐ OG image server-side 生成
- ☐ 全文搜索（Fuse.js 客户端 / Algolia 服务端）

---

## 8. 验收标准

### 8.1 UAT-1（30 条演示数据）
- [ ] 三语言 `/en` `/zh` `/ja` 页面可用
- [ ] 筛选（tag / model / q）与老站结果一致
- [ ] 视频 hover 预览与老站行为一致
- [ ] `/api/prompts?locale=zh&tag=cinematic` 可消费
- [ ] 文件数 < 80，部署体积 < 5MB
- [ ] 三语言 UI 完整（无英文 fallback）

### 8.2 UAT-2（4479 全量）
- [ ] 全量数据对账通过（vs 老站）
- [ ] SEO 字段完整（meta description / og:image / hreflang）
- [ ] 性能阈值（LCP < 2.5s @ P75，CF Cache 命中率 > 90%）
- [ ] 错误率 < 0.1%（24h 监控）
- [ ] 文件数 < 200

### 8.3 灰度每档必过
- [ ] 5xx 错误率 < 0.5%
- [ ] P95 延迟 < 500ms
- [ ] R2 媒体命中率 > 95%
- [ ] D1 P99 延迟 < 100ms
- [ ] SEO 收录数不下降（vs 灰度前 7 天均值）

---

## 9. 风险与回滚

| 风险 | 影响 | 回滚步骤 | 恢复时间 |
|---|---|---|---|
| D1 导入失败/数据损坏 | 全站不可用 | `wrangler d1 execute awesomevideoprompts-db --remote --file=drizzle/migrations/0000_init.sql` + 重跑 import | ~30 分钟 |
| D1 数据库名混淆（`prompts-db` vs `awesomevideoprompts-db`） | wrangler 找不到 binding，部署 500 | 改 wrangler.toml 的 `database_name` 为实际 CF 上的名 | < 5 分钟 |
| R2 媒体 404 | 详情页图片/视频缺失 | 切换 R2 bucket 到老 bucket（DNS 不变） | < 1 分钟 |
| Workers 部署失败 | 5xx 全站 | `wrangler rollback` 回上一版本 | < 2 分钟 |
| 灰度异常（Phase 5） | 部分用户受影响 | CF Rules 调分流比例到 0% | < 1 分钟 |
| ISR 缓存不刷新 | 新增 prompt 看不到 | 触发 `/api/revalidate?secret=...` | < 30 秒 |
| Token 权限不足 | deploy 失败 | CF Dashboard 给 token 加 `Account | D1 | Edit` + `Workers Scripts | Edit` | < 5 分钟 |
| 老 URL 301 规则错误 | SEO 流量损失 | 关闭 CF Rules 的 rewrite 规则 | < 5 分钟 |

### 9.1 主域名回滚（最严重场景，Phase 5）
1. CF Rules 关闭新站 rewrite → **5 分钟**
2. 老 Hugo 站恢复部署（CF Pages 已有 artifact）→ **5 分钟**
3. 老 R2 切回（如果新 bucket 有问题）→ **5 分钟**
4. 总恢复时间：**≤ 15 分钟**

---

## 10. 决策日志

| # | 决策 | 替代方案 | 选择理由 | 日期 |
|---|---|---|---|---|
| 1 | 新建独立仓库 | 分支迁移 | 14k+ 老文件污染；merge 必爆 | 2026-06-24 |
| 2 | Cloudflare Workers 部署 | Cloudflare Pages | Workers 无 20000 文件限制；架构更灵活 | 2026-06-24 |
| 3 | 准静态 Hybrid（SSG + ISR） | 纯 SSR / 纯 SSG | SSR 太慢；纯 SSG 边际成本高 | 2026-06-24 |
| 4 | D1 存 prompts | KV / 外部 DB | D1 与 Workers 同生态；免费额度够 | 2026-06-24 |
| 5 | R2 存媒体 | Cloudflare Images | R2 已就位；Images 收费 | 2026-06-24 |
| 6 | 不上 FTS5，全 LIKE | FTS5 | CJK FTS5 分词差；4479 条规模 LIKE 够 | 2026-06-24 |
| 7 | 不用 KV 缓存 | KV | CF Cache API 替代；KV 增加 binding | 2026-06-24 |
| 8 | prompt_date 用 TEXT ISO | DATE / INTEGER | D1 无原生 DATE；TEXT ISO 排序=时间序 | 2026-06-24 |
| 9 | 路由 `/prompts/[slug]/` | `/prompts/YYYY/MM/[slug]/` | 老 URL 不带年月更简洁；年月信息已在 prompt_date | 2026-06-24 |
| 10 | locale 路由 `/zh` `/ja` `/en` | `/zh-cn/` | `/zh-cn/` 改成 `/zh/`，更国际化 | 2026-06-24 |
| 11 | 老站降级为只读数据源 | 删老仓库 | R2 媒体共用；MD 内容作 import 源 | 2026-06-24 |
| 12 | import 用 HTTP API | wrangler 子进程 | 子进程慢（每条 ~500ms）；HTTP API 批量 100/批 | 2026-06-24 |
| 13 | **去掉** build 时预生成 prompts-index.json | build 时生成静态 JSON | D1 是唯一数据源；ISR 1h 边缘缓存已覆盖性能；预生成会增加构建耦合（新增 prompt 必须重 deploy）+ 部署体积（+4.5MB JSON）+ 缓存粒度差 | 2026-06-24 |
| 14 | **独立 Workers 部署**（`awesome-video-prompts-nextjs`） | 切主域名部署 | 新项目稳定性 + 主域流量分离；先在独立 URL 跑通 + UAT，**稳定后再切 awesomevideoprompts.com** | 2026-06-26 |
| 15 | D1 数据库名用 `awesomevideoprompts-db`（不是 `prompts-db`） | `prompts-db` | CF Dashboard 上真实数据库名是 `awesomevideoprompts-db`（与 binding 名解耦）；写错 `database_name` 会导致 schema init 找不到目标库 | 2026-06-26 |
| 16 | OpenNext Worker 风格（`main = ".open-next/worker.js"`） | Pages 风格（`pages_build_output_dir`） | `opennextjs-cloudflare` build 输出 worker bundle，配 Worker 风格 `main`；Pages 风格 wrangler 会报"Missing entry-point" | 2026-06-26 |
| 17 | D1 Query 两步法（主表分页 + 批量查 tags/models） | 单次大 JOIN + group_concat | 易读、易调；N+1 风险通过 inArray() 批量查询规避；单列表 = 3 次 round-trip（~20ms） | 2026-06-26 |
| 18 | CloudflareEnv 模块扩展（`env.DB: D1Database`） | 走 any 类型断言 | TS 静态类型 + IDE 自动补全；`@opennextjs/cloudflare` 的 CloudflareEnv 默认不包含 wrangler.toml 配的 binding | 2026-06-26 |

---

## 11. 当前 commit 历史

```
60a39c8 feat: 接通 D1 — 4 个 query 函数真查 Cloudflare D1
6987d73 Phase 1: 架构骨架 — UI 组件 + 三语言空壳页面 + 数据查询层
5290f24 Phase 0: 仓库初始化 + 文档冻结（去掉 build-time prompts-index 方案）
```

---

## 12. 当前部署状态

| 项 | 值 |
|---|---|
| **URL** | `https://awesome-video-prompts-nextjs.semonxue.workers.dev` |
| **Worker Name** | `awesome-video-prompts-nextjs` |
| **Last Version** | `8c5fe82c-deae-47e5-a377-47e087f2a385` |
| **D1 Database** | `awesomevideoprompts-db` (id: `486ccac9-d364-4db4-b911-d4a420bcbc6c`) |
| **D1 Records** | 10 en prompts（uot_date DESC） |
| **R2 Bucket** | `awesome-video-prompts-media`（共享老 CDN `static.awesomevideoprompts.com`） |
| **Bindings** | `env.DB` (D1), `env.MEDIA` (R2) |
| **Env Vars** | `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_R2_PUBLIC_URL` |
| **Page Size** | First Load JS ~102KB shared |
| **ISR TTL** | 1h |

### 12.1 路由表（部署产物）

```
○ /_not-found                       995 B     103 kB
ƒ /[locale]                       2.16 kB    124 kB
ƒ /[locale]/about                   126 B    102 kB
ƒ /[locale]/models                  126 B    102 kB
ƒ /[locale]/prompts/[slug]          927 B    119 kB
ƒ /[locale]/tags                    126 B    102 kB
ƒ Middleware                     54.6 kB
```

---

## 13. 后续工作计划（按依赖关系排序）

### P0 — UAT-1 验收前必做（目标：本周内）

1. **种子数据扩量 10 → 30 条**（保留 10 + 新增 20 覆盖更多模型/标签/月份）
   - 命令：`npx tsx scripts/import-md-to-d1.ts --remote --limit 30`
   - 验证：本地 dev + workers.dev 都能看到 30 张卡
2. **多语言扩量**：去掉 `--limit` 跑全量
   - 注意：LEGACY_CONTENT_DIR 里 `zh-cn/` `ja/` 两个目录的 md 已有；import 脚本按路径自动检测 locale
   - 跑完后 D1 locale 分布应该是 `{"en": ~4479, "zh": ~4479, "ja": ~4479}`（或更少，取决于老仓库是否有 zh/ja 内容）
3. **视觉 1:1 还原**（Phase 3 视觉对齐老站）
   - 复制 `awesome-video-prompts/src/app/globals.css` Phase 3 v1-v4 样式到 nextjs 项目
   - 复制 `awesome-video-prompts/src/{components,lib,messages}` i18n 扩展
   - **先**保留 nextjs 项目当前的 D1-SSR 架构，**不切换**到 build-time JSON 方案
   - 加 view-more 入口（点 model/tag 跳独立 page）
   - 加 compact header（scroll > 100px 浮 compact bar）
   - 适配 masonry-layout
4. **ISR `/api/revalidate` 端到端验证**
   - 实现路由 `src/app/api/revalidate/route.ts`
   - 读 `REVALIDATE_SECRET` env var，POST 时校验
   - 调 `revalidatePath()` 失效指定 URL
5. **R2 公开 URL 跨域检查**
   - 用 `curl -I` 测 `static.awesomevideoprompts.com` 资源是否带 `access-control-allow-origin: *`
   - 如果没：要么改 R2 CORS 规则、要么走 CF Worker 反代
6. **Lighthouse 评分**
   - 跑 perf / a11y / SEO 4 项；预期 ≥ 90
7. **Playwright e2e**（`e2e/` 目录）
   - 首页加载 → 10 张卡渲染
   - tag filter → URL 跳 → 卡数变
   - 详情页 → Copy prompt 按钮
   - 跨语言切换
8. **Sitemap / robots.txt**
   - 动态生成 `/sitemap.xml`（4479 个详情页 + locale alternates）
   - robots.txt 指向 sitemap
9. **Lighthouse 评分通过后通知 user 验收 UAT-1**

### P1 — UAT-1 通过后（目标：Phase 4 启动前）

10. **独立 `/tags` `/models` 索引页**（现在只有 list-prompts 的 tabs，没总览）
11. **独立 `/about` 三语言内容**（现在 aboutDescription 写死在 messages 文件）
12. **`/api/prompts` 公开 API**（给外部消费方用）
13. **Open Graph image 生成**（详情页用 prompt.coverUrl 拼 OG，但每个 prompt 独立 OG 需要 server-side 渲染器）
14. **R2 媒体迁移**（去依赖老 CDN `static.awesomevideoprompts.com`）
15. **历史数据治理**（重复 prompt 去重 / 标签字典规范化）

### P2 — Phase 5 灰度切流（业务方需求触发）

16. **CF Rules 配灰度分流**（10% → 30% → 50% → 100%）
17. **老 URL 301 规则部署**（`/zh-cn/...` → `/zh/...` 等）
18. **DNS 切主域**（`awesomevideoprompts.com` → 新 Workers）
19. **监控告警**（CF Analytics + 自建 health check）
20. **7 天稳定性观察** + 灰度全量

### P3 — 长线优化

21. **全文搜索**（Fuse.js 客户端 / Algolia 服务端）
22. **作者主页**（按 `author` dedupe 后建 `/authors/[handle]`）
23. **订阅 / RSS**（按 model / tag 订阅）
24. **prompt 评分 / 收藏**
25. **Plausible / CF Analytics view-more 点击率**
26. **Admin 后台**（prompt 编辑 / 上传 / 审核）

---

## 14. 附录：仓库结构

```
awesome-video-prompts-nextjs/
├── docs/
│   └── EXECUTION.md                  ← 本文件
├── drizzle/
│   └── migrations/
│       └── 0000_init.sql             ← D1 schema
├── src/
│   ├── app/
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── [locale]/
│   │       ├── layout.tsx
│   │       ├── page.tsx              ← 首页（listPrompts）
│   │       ├── about/page.tsx
│   │       ├── tags/page.tsx
│   │       ├── models/page.tsx
│   │       └── prompts/
│   │           └── [slug]/page.tsx   ← 详情页（getPromptBySlug）
│   ├── components/                   ← Phase 1
│   │   ├── Header.tsx
│   │   ├── Footer.tsx
│   │   ├── LangSwitcher.tsx
│   │   ├── GridEngine.tsx
│   │   ├── PromptCard.tsx
│   │   ├── PromptCardVideo.tsx
│   │   ├── MobileFilters.tsx
│   │   ├── TagDisplay.tsx
│   │   ├── CopyButton.tsx
│   │   └── types.ts
│   ├── i18n/request.ts
│   ├── lib/
│   │   ├── parse-md.ts
│   │   └── parse-md.test.ts
│   ├── db/
│   │   ├── schema.ts
│   │   ├── schema.test.ts
│   │   ├── index.ts
│   │   └── queries.ts                ← Phase 2 真查 D1
│   ├── messages/{en,zh,ja}.json
│   ├── types/
│   │   └── cloudflare-env.d.ts       ← CloudflareEnv 模块扩展
│   └── middleware.ts
├── scripts/
│   ├── import-md-to-d1.ts            ← Phase 2 实装
│   └── seed-from-old.ts              ← Phase 3 占位
├── e2e/                              ← Phase 3 Playwright
├── assets/css/main.css               ← 老站 1126 行 CSS
├── public/                           ← 媒体走 R2，本目录只放 favicon 等少量静态资源
├── .dev.vars                         ← gitignored
├── package.json
├── wrangler.toml                     ← main = ".open-next/worker.js"
├── next.config.ts
├── open-next.config.ts
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
└── .gitignore
```

---

## 15. 关键命令速查

```bash
# 本地 dev（需先 set CLOUDFLARE_API_TOKEN 等 env）
export CLOUDFLARE_API_TOKEN=$(awk -F'=' '/^CLOUDFLARE_API_TOKEN/{print $2}' .dev.vars)
export CLOUDFLARE_ACCOUNT_ID=$(awk -F'=' '/^CLOUDFLARE_ACCOUNT_ID/{print $2}' .dev.vars)
export CLOUDFLARE_D1_DATABASE_ID=$(awk -F'=' '/^D1_DATABASE_ID/{print $2}' .dev.vars)
export LEGACY_CONTENT_DIR=/Users/semonxue/Workplace/Works/ai-dev/awesome-video-prompts/content
export R2_PUBLIC_URL=https://static.awesomevideoprompts.com

# 1. 远程 D1 schema init
npx wrangler d1 execute awesomevideoprompts-db --remote --file=./drizzle/migrations/0000_init.sql

# 2. 灌数据（10/30/全量）
npx tsx scripts/import-md-to-d1.ts --remote --limit 10

# 3. type-check + tests
npm run type-check && npm test

# 4. build + opennext build
npm run build && npm run build:cf

# 5. deploy（默认 deploy 顶层 env = awesome-video-prompts-nextjs）
npx wrangler deploy

# 6. 验证
curl -sSL https://awesome-video-prompts-nextjs.semonxue.workers.dev/en | head -c 500
```

---

## 16. 凭证（保密）

`.dev.vars`（gitignored）当前包含：
- `CLOUDFLARE_API_TOKEN`：CF User API Token，权限 `Account | D1 | Edit` + `Workers Scripts | Edit` + `Account Settings | Read`
- `CLOUDFLARE_ACCOUNT_ID`：`a5dfcda3d7f7b488c2597d8dcdf54cca`
- `D1_DATABASE_ID`：`486ccac9-d364-4db4-b911-d4a420bcbc6c`
- `R2_BUCKET`：`awesome-video-prompts-media`
- `R2_PUBLIC_URL`：`https://static.awesomevideoprompts.com`
- `LEGACY_CONTENT_DIR`：指向老 hugo 仓库的 content/ 目录

⚠️ **Token 已经在对话 transcript 里出现 3 次**，部署完必须去 CF Dashboard revoke 重新建一个。TTL 设 24h 较安全。
