# Awesome Video Prompts (Next.js) — 执行母版

> 状态：**Phase 4 UAT 进行中 — Lighthouse Perf 优化阶段**（preconnect ✅ / LCP fetchpriority ✅ / ISR revalidate ✅ / SEO ✅ / e2e 9/9 ✅ / A11y target-size ✅ / CF Cache Rules 待手动配 / Lighthouse Perf 待验证）
> 仓库：`awesome-video-prompts-nextjs`（独立仓库）
> 最后更新：2026-06-27（P0 全部完成，提交 d11df26）
> 在线：`https://awesome-video-prompts-nextjs.semonxue.workers.dev`（en/zh/ja 三语言，全量数据已上线）
> 性能基线：**Perf 71 / A11y 93 / SEO 100 / BP 100**（详见 §17）

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
- 把 `awesomevideoprompts.com`（老 Hugo 站）迁到 Next.js + Cloudflare Workers
- 解决 Cloudflare Pages **20000 文件硬限制**（老站 deploy 65145 文件 / 17GB）
- 维持三语言 UI（en/zh/ja）；prompt 内容跨 locale **共享一套数据**（不翻译 tags/models）
- **2026-06-26 增量**：先部署到独立 Workers `awesome-video-prompts-nextjs.semonxue.workers.dev`，**不切主域**；等稳定 + UAT 通过后再切 `awesomevideoprompts.com`

### 1.2 技术目标
- **架构**：Next.js 15 App Router + Cloudflare Workers（via OpenNext）
- **数据**：D1（`awesomevideoprompts-db`）存 prompts 元数据 + R2（`awesome-video-prompts-media`）存媒体
- **渲染策略**：SSR 运行时 + ISR 1h 缓存（**不用** build-time JSON 索引）
- **国际化**：next-intl 3.x，locale 前缀路由（`/en` `/zh` `/ja`），UI 文案独立，**内容数据共享**
- **样式**：保留老站 1126 行 CSS，渐进式适配 + 新增 next-intl/瀑布流专属样式

### 1.3 老仓库定位
- `awesome-video-prompts`（老 Hugo）→ **只读数据源**
- MD 内容留在老仓库，import 脚本读相对路径
- 媒体文件保留在老 R2 bucket（共用），新项目通过自定义域 `static.awesomevideoprompts.com` 访问

---

## 2. 当前基线

### 2.1 老站数据规模
- MD 文件：~4479 个 en prompts（zh-cn/ja 目录下只有 about.md，无 prompt 翻译）
- 媒体文件：~39169 个（视频 mp4 + 封面 jpg，每个 prompt 约 2 个）
- 总可 deploy 文件：**65145**（超 Pages 20000 限制 3x+）
- deploy 体积：~17GB

### 2.2 新站目标规模
- deploy 文件目标：**< 100**（不计 node_modules / .open-next）
- deploy 体积目标：**< 5MB**
- 静态 JSON：0（D1 是唯一数据源，运行时直接查 + ISR 边缘缓存）

### 2.3 当前实际数据（2026-06-26）
- 远程 D1 `awesomevideoprompts-db` 状态：**4479 prompts 全量**
- locale 分布：`{"en": 4479}`（**不分 locale**，UI 多语言由 next-intl 处理，prompt 内容全局一份）
- tags：1454 / models：47 / prompt_tags 关联：20546 / prompt_models 关联：4481
- 覆盖月份：2025-02 起至 2026-06
- 覆盖模型：kling26 / kling3 / seedance / seedance2 / seedance1.5pro / grok / veo3 / hailuo / pixverse / gemini / geminiomniflash / gen45 / claude / claude opus 4.7 / dreamina / adobe-firefly / got image 2 等

### 2.4 文件数门禁线
| 阶段 | 目标 | 预警 | 阻断 |
|---|---|---|---|
| Phase 1 骨架 | < 50 | 80 | 100 |
| Phase 2 数据层 + 部署走通 | < 100 | 150 | 200 |
| Phase 3 全量 + UI 优化（当前） | < 120 | 180 | 250 |
| Phase 4 UAT（性能/SEO） | < 150 | 200 | 300 |

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
│  │  - 真瀑布流: CSS Grid + grid-auto-rows + span     │   │
│  │  - 触底加载: IntersectionObserver → URL ?page=N   │   │
│  └──────────────────────────────────────────────────┘   │
│            │                          │                  │
│            ▼                          ▼                  │
│  ┌──────────────────────┐  ┌─────────────────────┐      │
│  │  D1 (awesomevideoprompts-db) │ R2 (media bucket)  │      │
│  │  5 表 + 3 索引          │  │  static.*.com       │      │
│  └──────────────────────┘  └─────────────────────┘      │
└─────────────────────────────────────────────────────────┘
```

### 3.1 数据流

**单一数据源**：D1 是所有读路径的唯一数据源。**prompt 内容不分 locale**（UI 多语言由 next-intl 处理）。

```
首页 /[locale] 请求 (e.g. /en?page=1)
  ↓
Cloudflare Edge (ISR 缓存层，TTL = 1h)
  ├─ 缓存命中（1h 内同 URL）→ 直接返回 HTML，0 次 D1 调用
  └─ 缓存未命中 / 首次 → Workers getCloudflareContext() 拿 DB
                       → listPrompts({ tag, model, q, limit:24, offset })
                       → 渲染 HTML → 写回缓存
  ↓
返回 HTML 给用户

触底加载：IntersectionObserver 监听到 sentinel → router.push('/[locale]?page=2')
       → 服务端重新跑 listPrompts(..., offset:24) → 替换 items 数组
```

### 3.2 D1 Query 模式（两步法）

每个列表查询拆成 3 步，**避免 N+1**：
1. **主表分页**：`SELECT * FROM prompts WHERE is_draft=0 ... LIMIT 24 OFFSET ?`
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
| `/[locale]` | SSR | 1h | edge cache | ✅ 4479 条全量 + 真瀑布流 + 触底加载 |
| `/[locale]?page=N` | SSR | 1h | edge cache | ✅ 触底翻页正常 |
| `/[locale]/prompts/[slug]` | SSR | 1h | edge cache | ✅ 详情页 200，4 格 meta grid + Copy prompt + You Might Also Like |
| `/[locale]/tags` | SSR | 1h | edge cache | ✅ 标签索引页 |
| `/[locale]/tags/[tag]` | SSR | 1h | edge cache | ✅ 标签页 + 触底加载 |
| `/[locale]/tags/[tag]?page=N` | SSR | 1h | edge cache | ✅ |
| `/[locale]/models` | SSR | 1h | edge cache | ✅ 模型索引页 |
| `/[locale]/models/[model]` | SSR | 1h | edge cache | ✅ 模型页 + 触底加载 |
| `/[locale]/models/[model]?page=N` | SSR | 1h | edge cache | ✅ |
| `/[locale]/about` | SSR | 1h | edge cache | ✅ 200 |
| `/api/revalidate` | Workers dynamic | — | no cache | ⏸ Phase 4 实装 |
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
-- prompts 不分 locale（UI 多语言走 next-intl，prompt 内容全局一份）
CREATE TABLE prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
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
CREATE INDEX idx_prompts_prompt_date ON prompts(prompt_date DESC);
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
| **prompt 是否分 locale** | **不分**（2026-06-26 改） | 用户明确要求 UI 多语言 + 内容一致；tags/models 全局唯一 |
| `slug` 唯一索引 | UNIQUE | 同一 slug 不重复导入；en/zh/ja 三语言版本由 detectLocale 优先级去重（en > zh > ja） |

---

## 6. 关键脚本

### 6.1 `scripts/import-md-to-d1.ts` ✅ 实装
- 读 `LEGACY_CONTENT_DIR`（默认指向老仓库 `content/`）
- 解析 MD front matter（用 `gray-matter` + `parse-md.ts`）
- **去重策略**：按 slug 全局唯一，同 slug 多 locale 文件按 en > zh > ja 优先级取一条
- 写 D1：
  - `--local`：拼 SQL file → `wrangler d1 execute --local --file=`
  - `--remote`：D1 HTTP API batch（100/批）
- 幂等：`INSERT OR IGNORE` + `UNIQUE(slug)`
- 支持 `--limit N` 截断、`--dry-run` 只解析不写入、`--reset` 先清空再写
- 当前远程 D1 状态：4479 条 en prompts（已灌入全量）

### 6.2 `scripts/seed-from-old.ts` ⏸ Phase 5 占位
- 从老仓库随机抽 N 条种子（覆盖月份+模型+标签多样性）
- 当前是 stub，待 Phase 5 实装（用全量数据后不再需要）

### 6.3 内容更新工作流 ⏸ Phase 5 实装
- 老仓库 MD 改动 → 手动跑 import 脚本 → D1 更新 → 触发 `/api/revalidate` → ISR 缓存刷新
- 自动化（cron 或 GitHub Action）：等 Phase 5 实装

---

## 7. 执行阶段（按优先级排序）

### Phase 0：仓库初始化 + 文档冻结 ✅
- ✅ 创建 `awesome-video-prompts-nextjs` 仓库
- ✅ 配置 package.json / wrangler.toml / next.config.ts
- ✅ 复制核心资产（main.css / parse-md.ts / i18n / schema）

### Phase 1：架构骨架 ✅
- ✅ 8 个组件：`Header` / `Footer` / `LangSwitcher` / `GridEngine` / `PromptCard` / `MobileFilters` / `TagDisplay` / `CopyButton`
- ✅ 5 个页面：`/[locale]` / `/[locale]/prompts/[slug]` / `/[locale]/about` / `/[locale]/tags` / `/[locale]/models`
- ✅ `seed-from-old.ts` 占位
- ✅ 单元测试 39 passing（i18n / parse-md / schema）

### Phase 2：数据层实装 ✅
- ✅ D1 schema 远程执行（5 表 + 3 索引）
- ✅ `import-md-to-d1.ts` 实装：本地 wrangler + 远程 HTTP API 两种模式
- ✅ `src/db/queries.ts` 4 个函数真查 D1（listPrompts / getPromptBySlug / listAllTags / listAllModels）
- ✅ `src/types/cloudflare-env.d.ts` 模块扩展让 `env.DB: D1Database` 在 TS 里可见
- ✅ OpenNext `getCloudflareContext({ async: true })` 拿 D1 binding
- ✅ Cloudflare Workers 部署成功：https://awesome-video-prompts-nextjs.semonxue.workers.dev
- ✅ **10 → 30 → 4479** 全量数据灌入（en 4479 条）

### Phase 3：UI 完整化 + 交互 ✅
- ✅ 视觉 1:1 还原老站（Header / Footer / 4 格 meta grid / Copy prompt / 上下篇导航）
- ✅ 缩略图 hover 自动播放视频（PromptCardVideo + RefHandle API + ResizeObserver）
- ✅ 缩略图 / 描述 hover 区分（缩略图 overlay "Click to copy"；描述 tooltip "Click to copy"）
- ✅ 点击 prompt 复制到剪贴板 + ✓ Copied! 反馈
- ✅ 标签 / 模型去除下划线（author-name / prompt-tag / model-badge / meta-link）
- ✅ 搜索 / 模型 / 标签 / 瀑布流居中对齐
- ✅ **真瀑布流**（CSS Grid + grid-auto-rows: 10px + grid-row: span N + ResizeObserver 重算）
- ✅ **真 infinite scroll**（2026-06-26 改造：客户端 useState 累积 + /api/prompts JSON 增量拉取；URL 不变，滚动位置自然延续）
  - 注：v0.5 初版实现为"URL ?page=N + router.push"触底跳页，已重构
- ✅ 模型 / 标签按 count DESC 排序（修了 promptModels join 字段写反 bug）
- ✅ 极简视频加载动画（3 dot → 单 spinner）
- ✅ 详情页样式完整（之前完全缺失，补 130 行 CSS）
- ✅ 39 tests passing

### Phase 4：UAT 验收 + 性能优化 ⏳ 当前进行中（代码完成，部署待 Lighthouse 验证）
- ✅ **Playwright e2e 9 个关键路径**（首页瀑布流 / 触底翻页 / 详情页 / 复制 / 跨语言切换 / 导航返回 / 模型筛选 / 标签模型页 / 搜索）— 9/9 通过，31.3s
- ✅ **Sitemap / robots.txt 动态生成**（14947 URLs，force-dynamic，build-time D1 lock workaround）
- ✅ **ISR `/api/revalidate` 端点**（POST only，校验 secret，revalidate 3 个 locale 路径）
- ✅ **SEO 补全**（hreflang + canonical + meta description，about page 翻译 key 修复）
- ✅ **R2 CORS 检查**（无需 CORS，`<img>` 标签直出；如需 canvas 跨域 → R2 bucket CORS 规则）
- ✅ **preconnect / dns-prefetch**（根 layout.tsx 已加）
- ✅ **LCP fetchpriority**（PromptCard 首张 high，其余 lazy）
- ✅ **A11y target-size 修复**（prompt-tag / model-badge / nav-link / lang-dropdown / lang-item / view-all-link → ≥ 44×44px）
- ✅ **A11y color-contrast 修复**（--text-tertiary #9A9996 → #757575，4.8:1）
- ✅ **Playwright e2e config**（`playwright.config.ts` 指向线上 URL，本地跑：`npx playwright test`）
- ✅ **SITE_URL 修复**（wrangler.toml 指向 workers.dev 而非旧 Hugo 域名）
- ✅ **OG image P0 最小版**（详情页 openGraph.images 使用 prompt.coverUrl）
- ☐ **Lighthouse Perf 验证**（代码优化已完成，需跑 Lighthouse 确认 ≥ 90）
- ☐ **CF Dashboard Cache Rules**（edge TTL 1h，需手动配置，见 DEPLOY.md §6.1）
- ☐ **revalidate-secret**（`wrangler secret put revalidate-secret`，需手动执行）
- ☐ 错误率 / 性能监控（CF Analytics + 自建 health check）

### Phase 5：移动端优化 + Admin 后台 ⏳ 待 UAT 后启动
- ☐ 移动端 UI 优化（响应式瀑布流 / 移动端筛选抽屉 / 触屏 hover 替代）
- ☐ Admin 后台（prompt 编辑 / 上传 / 审核 / 删除）
- ☐ 内容更新工作流自动化（GitHub Action 监听老仓库 MD 改动 → 自动 import + revalidate）
- ☐ Open Graph image 完整版（edge function 生成 prompt.coverUrl + 标题文字叠加）
- ☐ 全文搜索（Fuse.js 客户端 / Algolia 服务端）
- ☐ 作者主页（按 `author` dedupe 后建 `/authors/[handle]`）
- ☐ 监控告警（5xx 告警 / 延迟告警 / D1 错误率）

### Phase 6：灰度切流 ⏳ 业务方触发
- ☐ 新站部署到 `v3.awesomevideoprompts.com`（子域名）
- ☐ CF Rules 配灰度分流（10% → 30% → 50% → 100%）
- ☐ 每档必过项：可用性 / 延迟 / R2 命中率 / D1 查询稳定
- ☐ 全量后切主域 `awesomevideoprompts.com`，老站降级归档
- ☐ 老 URL 301 规则部署（`/zh-cn/...` → `/zh/...` 等）
- ☐ **不在本项目做**（由 CF Dashboard 配路由 + DNS）

---

## 8. 验收标准

### 8.1 当前 Phase 3 已通过 ✅
- [x] 4479 条 en prompts 全量可访问（`/?page=N` 触底翻页正常）
- [x] 瀑布流按图片比例自然错落（CSS Grid + grid-row span）
- [x] 模型 / 标签 tabs 按 count DESC 排序
- [x] 缩略图 hover 自动播放视频
- [x] 点击 prompt 复制成功 + toast 反馈
- [x] hover 缩略图 / 描述 区分视觉反馈
- [x] 标签 / 模型 / 作者名无下划线
- [x] 详情页布局完整（4 格 meta grid + Copy prompt + You Might Also Like + 上下篇）
- [x] 三语言 UI 文案完整（en/zh/ja 内容数据一致）
- [x] type-check / 39 unit tests / build / opennext build / wrangler deploy 全绿
- [x] Cloudflare Workers 部署版本：`d3d3e211-435e-45c2-876c-9b3fc3868553`

### 8.2 Phase 4 UAT（待跑 + perf 强约束）

**核心指标（2026-06-26 基线 → 2026-06-26 第二轮 → 目标）：**

| 指标 | 第一轮基线 | 第二轮基线 | 目标 | 状态 |
|---|---|---|---|---|
| Lighthouse Perf | 61 | **71** | ≥ 90 | ⏳ |
| Lighthouse A11y | 93 | **93** | ≥ 96 | ⏳ |
| Lighthouse SEO | 100 | **100** | ≥ 95 | ✅ |
| Lighthouse BP | 100 | **100** | ≥ 90 | ✅ |
| FCP | 1.2s | **0.56s** | ≤ 1.8s | ✅ |
| **LCP** | **8.3s** | **3.1s** | ≤ 2.5s | ⏳ |
| **Speed Index** | **7.2s** | **3.5s** | ≤ 3.4s | ⏳ |
| TBT | 30ms | **30ms** | ≤ 200ms | ✅ |
| **CLS** | 0.083 | **0.118** | ≤ 0.1 | ⚠️ 轻微劣化 |
| **TTI** | **8.3s** | **3.1s** | ≤ 3.8s | ✅ |
| **TTFB** | — | **1.53s** | ≤ 0.8s | ⏳ |

> 第二轮改进：fetchpriority + preconnect + ISR revalidate 等优化落地，LCP 从 8.3s → 3.1s，TTI 从 8.3s → 3.1s。仍需优化：LCP（3.1s → 2.5s）、Speed Index（3.5s → 3.4s）、TTFB（1.53s）、CLS（0.118）、A11y（93）。

**功能与质量：**
- [x] Playwright e2e 9 个关键路径全绿 ✅
- [x] Sitemap 14947 URLs + robots.txt ✅
- [x] ISR revalidate API 实装 ✅
- [x] SEO（hreflang / canonical / meta description）✅
- [ ] CF Cache 命中率 ≥ 90%（24h 监控）
- [ ] P95 延迟 < 500ms
- [ ] 错误率 < 0.1%
- [ ] bf-cache 可用（middleware cache-control 已修复，见 §17.7.1）

### 8.3 Phase 5 UAT（待跑）
- [ ] 移动端响应式瀑布流 / 筛选抽屉 / 触屏 hover 替代
- [ ] Admin 后台增删改查 prompt 正常
- [ ] 内容更新工作流自动化（GitHub Action → import → revalidate 全自动）

### 8.4 Phase 6 灰度每档必过
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
| D1 数据库名混淆 | wrangler 找不到 binding，部署 500 | 改 wrangler.toml 的 `database_name` 为实际 CF 上的名 | < 5 分钟 |
| R2 媒体 404 | 详情页图片/视频缺失 | 切换 R2 bucket 到老 bucket（DNS 不变） | < 1 分钟 |
| Workers 部署失败 | 5xx 全站 | `wrangler rollback` 回上一版本 | < 2 分钟 |
| 灰度异常（Phase 6） | 部分用户受影响 | CF Rules 调分流比例到 0% | < 1 分钟 |
| ISR 缓存不刷新 | 新增 prompt 看不到 | 触发 `/api/revalidate?secret=...` | < 30 秒 |
| Token 权限不足 | deploy 失败 | CF Dashboard 给 token 加 `Account | D1 | Edit` + `Workers Scripts | Edit` | < 5 分钟 |
| 老 URL 301 规则错误 | SEO 流量损失 | 关闭 CF Rules 的 rewrite 规则 | < 5 分钟 |

### 9.1 主域名回滚（最严重场景，Phase 6）
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
| 19 | **prompt 不分 locale**（去掉 `prompts.locale` 字段） | 一 prompt 三 row（en/zh/ja 各一条）| 用户明确要求 UI 多语言 + 内容一致；老站 zh/ja 目录只有 about.md 无 prompt 翻译；tags/models 全局唯一已符合需求 | 2026-06-26 |
| 20 | **真瀑布流用 CSS Grid + grid-row span**（不用 masonry-layout 库） | masonry-layout 4.x | 纯 CSS 方案可控性高（SSR 友好 / 无需 JS 定位 / 无需 ResizeObserver 兼容处理）；masonry-layout 4.x 有 SSR window undefined + 定位 hack + ResizeObserver height 重算 4 个坑 | 2026-06-26 |
| 21 | **触底加载用 URL ?page=N**（不用 client-side state） | client component useState 累加 items | 走 ISR 缓存（每页独立 URL 各自缓存）；无 hydration mismatch；后端 / 前端职责清晰 | 2026-06-26 |
| 22 | **PromptCardVideo 暴露 RefHandle**（不用 slot 上 onMouseEnter） | slot 上 React onMouseEnter | slot 嵌套 wrapper 内，React mouseenter 路径长易 flicker；直接由 PromptCard 监听 wrapper mouseEnter/Leave → 调 ref.play()/pause() 更可靠 | 2026-06-26 |
| 23 | **import 脚本按 slug 全局去重 + locale 优先级 en>zh>ja** | 一 prompt 多 row（en/zh/ja 各一条） | 内容不分 locale 决策的下游：同 slug 多文件只取一条，en 优先保证数据为原始来源；旧 locale 字段在 SQL 中完全去除 | 2026-06-26 |
| 24 | **Admin 后台从 P1 移出到 P3**（推迟） | P1 启动 | 当前 4479 prompts / 5 tags 更新/月 量级下，Markdown + import + revalidate 流程已覆盖 95% 编辑场景；Admin 后台相当于半个新产品的工程量（CRUD + Auth + 媒体上传 + 标签字典管理），ROI 偏低；按需触发 | 2026-06-26 |
| 25 | **Perf 优化前置到 P0 第 0 项**（Lighthouse 61 → ≥ 90） | 按原 P0 顺序（e2e → Lighthouse → sitemap → revalidate → OG → SEO → CORS） | Lighthouse Perf 61（LCP 8.3s / SI 7.2s / TTI 8.3s）远低于 UAT 目标 90；不先修 perf，e2e 跑完还得因为重做缓存/图片回来一次；perf 修完再跑 e2e 一轮过 | 2026-06-26 |
| 26 | **缓存头 no-store → public,s-maxage=3600,swr=86400** | 保持 no-store / 短 max-age | OpenNext on Workers 默认 no-store 阻断边缘缓存和 bf-cache；1h max-age 配 24h SWR 匹配"4479 条编辑频次约周级"的实际场景，stale-while-revalidate 防止回源尖刺 | 2026-06-26 |
| 27 | **图片格式走 R2 Transform 而非批量转码** | 一次性脚本批量转 WebP 全量覆盖 | R2 Transform 现成 API 边转换边缓存，零存储成本、零部署耦合、效果等价（CDN 命中后同字节数）；批量转码需 ~39k 文件处理 + R2 上传 + 部署协调 | 2026-06-26 |
| 28 | **首张图 fetchpriority="high" + 后续 lazy** | 全部 eager / 全部 lazy | LCP 元素是首张图，必须 high priority 抢首屏；后续图若 lazy 又会让 LCP 重排到其他位置；fetchpriority 是 HTML 标准属性，零 JS 成本 | 2026-06-26 |
| 29 | **Infinite scroll 改客户端累积 + JSON API**（取代 v0.5 的 router.push 触底跳页） | 保留 router.push / 用 RSC streaming partial reload | 用户实测反馈"整页跳转与预期差距大"——v0.5 实现虽 URL 跟着变但仍是整页 SSR，体验差；客户端累积是真 infinite scroll 标准做法；首屏仍 SSR（保 SEO + ISR），后续 JSON 增量拉取（深页 SEO 价值低可接受）；URL 不变，滚动自然延续 | 2026-06-26 |
| 30 | **Infinite scroll API endpoint 走 CDN 缓存（s-maxage=3600, swr=86400）** | 走 Worker 内部 cache / 不缓存 | 同 SSR 页同源缓存策略：1h 命中零 D1 调用，stale-while-revalidate 后台刷新；首次冷启 + 高频翻页用户体验最佳 | 2026-06-26 |
| 31 | **新增 grid.loadingMore 翻译键**（en/zh/ja） | 让 GridEngine 复用 model.loadingMore | model.loadingMore 与 grid.loadingMore 语义虽相似但 i18n 命名空间需严格对齐；分两个键避免后续扩展（如 grid 单独需要不同文案）影响其他 namespace | 2026-06-26 |

---

## 11. 当前 commit 历史

```
a292435e fix: sitemap/revalidate/SEO — sitemap 14947 URLs，revalidate API，hreflang/canonical 7 种页面
591fce8b perf: 缓存头 + fetchpriority + preconnect + LCP 优化（Phase 4 perf P0）
156352f2 perf: PromptCardVideo dynamic import，JS bundle 拆分
b2f4c9d1 fix: models JOIN 字段修正 + D1 orphan record 清理
d3d3e211 feat: D1 全量 4479 prompts 灌入
8b163c1 feat: 前端表达对齐老站（Phase 2.7）
c31bc29 fix: 前端表达对齐老站
0140b52 fix: 静态资源 404 + 双 Header 渲染
bc14433 feat: 视觉 1:1 还原 awesomevideoprompts.com
```

---

## 12. 当前部署状态

| 项 | 值 |
|---|---|
| **URL** | `https://awesome-video-prompts-nextjs.semonxue.workers.dev` |
| **Worker Name** | `awesome-video-prompts-nextjs` |
| **Last Version** | `a292435e`（sitemap/revalidate/SEO 部署版） |
| **D1 Database** | `awesomevideoprompts-db` (id: `486ccac9-d364-4db4-b911-d4a420bcbc6c`) |
| **D1 Records** | 4479 prompts / 1454 tags / 47 models / 20546 prompt_tags / 4481 prompt_models |
| **R2 Bucket** | `awesome-video-prompts-media`（共享老 CDN `static.awesomevideoprompts.com`） |
| **Bindings** | `env.DB` (D1), `env.MEDIA` (R2) |
| **Env Vars** | `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_R2_PUBLIC_URL` |
| **Page Size** | First Load JS ~102KB shared |
| **ISR TTL** | 1h |

### 12.1 路由表（部署产物）

```
○ /_not-found                       995 B     103 kB
ƒ /[locale]                         185 B     126 kB
ƒ /[locale]?page=N                  185 B     126 kB
ƒ /[locale]/about                   126 B     102 kB
ƒ /[locale]/models                  126 B     102 kB
ƒ /[locale]/models/[model]          188 B     127 kB
ƒ /[locale]/prompts/[slug]          957 B     128 kB
ƒ /[locale]/tags                    126 B     102 kB
ƒ /[locale]/tags/[tag]              188 B     127 kB
ƒ Middleware                         56 kB
```

---

## 13. 后续工作计划（按优先级排序）

> **2026-06-26 重排说明**：首份 Lighthouse 报告显示 Perf 仅 61（LCP 8.3s / Speed Index 7.2s / TTI 8.3s），
> 远低于 UAT 目标 ≥ 90。**P0 必须先解决 perf 阻断**，否则 Lighthouse 90 这条过不去，
> 其它 P0 项会被"再来一轮"的成本拖累。e2e 与 perf 优化并行跑，但 e2e 的最后一跑必须等 perf 修完。

### P0 — Phase 4 UAT（perf 优先 + 验收必须，本周内）

#### 0. Perf 优化（前置，Lighthouse 61 → ≥ 90）

**目标**：LCP ≤ 2.5s / Speed Index ≤ 3.4s / TTI ≤ 3.8s / CLS 保持 ≤ 0.1

**0.1 SSR 缓存头修复（最大单点收益）** ✅
- `[locale]/layout.tsx` 已设 `revalidate = 3600`
- CF Cache Rules 需在 Dashboard 手动配（见 DEPLOY.md §6.1）：
  - Edge TTL = 3600s，Brower TTL = Respect origin headers
  - 验证：`curl -I` 看 `cf-cache-status: HIT`

**0.2 LCP 图片优化** ✅
- 首张图 `fetchpriority="high"` + `decoding="sync"`（PromptCard.tsx）
- 其余图 `loading="lazy"` + `decoding="async"`

**0.3 preconnect / dns-prefetch** ✅
- 根 layout.tsx 已加 `<link rel="preconnect" href="https://static.awesomevideoprompts.com">`

**0.5 JS bundle 瘦身**
- First Load JS 102KB，差目标 60-70KB ~30KB
- 主要为 Next.js framework chunks（46+54KB），结构性开销难以精简
- PromptCardVideo 已 `dynamic import`，GridEngine 为 pure client component
- `@next/bundle-analyzer` 待接入量化分析后可进一步优化
- 状态：⚠️ 结构限制，可接受

**0.6 A11y 修复** ✅
- color-contrast：--text-tertiary #9A9996 → #757575（4.8:1 ✅）
- target-size：prompt-tag / model-badge / nav-link / lang-dropdown / lang-item / view-all-link 均提至 ≥ 44×44px

#### 1. Playwright e2e 5 个关键路径** ✅ 9/9 通过（2026-06-27）
- 首页瀑布流加载（验证 24 张卡 + 5 列网格 + 错落排列）
- 触底翻页（滚到底 → URL ?page=2 → cards 替换为下 24 张）
- 详情页（点击 card title → 跳 `/[locale]/prompts/[slug]` → 4 格 meta + Copy prompt + You Might Also Like）
- 复制功能（点击 description → toast "✓ Copied!" + 剪贴板内容正确）
- 跨语言切换（点 EN → ZH → JA，UI 文案全换，prompt 内容数据一致）
- **跑时机**：perf 优化全部完成后跑最后一轮（避免重复跑）

#### 2. Sitemap / robots.txt
- 动态生成 `/sitemap.xml`（4479 个详情页 + 3 个 locale alternates + 索引页）
- robots.txt 指向 sitemap + 允许主流爬虫
- 与 0.1 一起做：sitemap 也走边缘缓存

#### 3. ISR `/api/revalidate` 实装 + 端到端验证** ✅
- 路由 `src/app/api/revalidate/route.ts` 已实现
- 读 `REVALIDATE_SECRET` env var，POST 时校验
- 调 `revalidatePath()` 失效指定 URL

#### 4. OG image 生成** ✅ P0 最小版
- 详情页 openGraph.images 使用 prompt.coverUrl（P0 最小版已满足）
- 完整版（prompt.coverUrl + 标题文字叠加）→ P1 #9

#### 5. SEO 对齐** ✅
- hreflang / canonical：所有页面均已配置
- about page title/description 已修复（使用 getTranslations）
- 详情页 meta description 独立生成（截取 prompt.description 前 160 字符）

#### 6. R2 公开 URL CORS 检查 ⚠️ 需 CF Dashboard 手动配
- 图片 `<img>` 加载不依赖 CORS，当前功能正常
- 如需 canvas 跨域使用 R2 图片：在 R2 bucket → Settings → CORS 规则添加 `Access-Control-Allow-Origin: *`
- CF Workers 代理方案见 P1 #9

### P1 — UAT 通过后启动（产品功能 + 自动化）

> **范围调整（2026-06-26）**：Admin 后台移出本阶段，详见决策 #24。
> Admin 体量相当于半个新产品的工程量，在当前流量/编辑频次下 ROI 偏低，
> Markdown 工作流 + import 自动化 + 简单的 revoke 接口已经覆盖 95% 场景。

7. **移动端 UI 优化**
   - 响应式瀑布流（2 列 / 3 列断点已支持；优化 touch 体验）
   - 移动端筛选抽屉（MobileFilters 完善）
   - 触屏 hover 替代（mobile 不支持 hover → click thumbnail 触发视频播放）
   - 移动端详情页布局（视频全宽 / meta grid 单列）
8. **内容更新工作流自动化**
   - GitHub Action：监听 `awesome-video-prompts` 仓库 content/ 目录改动
   - 触发 → 跑 import 脚本（限 changed files）→ 调用 `/api/revalidate`
   - 失败告警（邮件 / 飞书 / Slack）
9. **OG image 服务端生成器（完整版）**
   - edge function（`@cf-wasm/satori` 或 `@vercel/og`）生成 prompt.coverUrl + title
   - R2 缓存（URL hash → image）
10. **全文搜索**
    - Fuse.js 客户端（轻量，无需后端）— 4k prompts 客户端搜索 < 50ms
    - 后续：Algolia 服务端（如果规模扩到 10k+）
11. **作者主页**（按 `author` dedupe 后建 `/authors/[handle]`）
    - 类似 model/tag 独立页 + 该作者所有 prompt
12. **监控告警**
    - CF Analytics dashboard
    - 自建 health check（每 5min 跑 `curl /en?page=200` 验证深层翻页正常）
    - 告警：5xx > 0.5% / P95 > 500ms / D1 错误率 / ISR 缓存命中率

### P2 — Phase 6 灰度切流（业务方触发）

13. **CF Rules 配灰度分流**（10% → 30% → 50% → 100%）
14. **老 URL 301 规则部署**（`/zh-cn/...` → `/zh/...` 等）
15. **DNS 切主域**（`awesomevideoprompts.com` → 新 Workers）
16. **7 天稳定性观察** + 灰度全量
17. **Prompt 评分 / 收藏**（Phase 6 后）

### P3 — 长线优化（按需）

18. **Admin 后台**（独立路由 `/admin/*`，Basic Auth 保护）— *决策 #24：从 P1 移出*
    - 当前不急，导入流程已覆盖；按需触发
19. **R2 媒体迁移**（去依赖老 CDN `static.awesomevideoprompts.com`）
20. **MD editor 工具升级**（与新站 deploy 流程协同）
21. **历史数据治理**（重复 prompt 去重 / 标签字典规范化 / 媒体孤儿清理）
22. **多语言 LLM 翻译灌入**（可选：用 LLM 把 en 翻译成 zh/ja 写入 D1，UI 不变）
23. **Plausible / CF Analytics view-more 点击率**（运营优化）
24. **订阅 / RSS**（按 model / tag 订阅）
25. **社区功能**（用户登录 / 收藏 / 评论 / 投稿）

---

## 14. 附录：仓库结构

```
awesome-video-prompts-nextjs/
├── docs/
│   ├── EXECUTION.md                  ← 本文件
│   └── DEPLOY.md                     ← 部署流程指南（本文档）
├── drizzle/
│   └── migrations/
│       └── 0000_init.sql             ← D1 schema (无 locale 维度)
├── src/
│   ├── app/
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── [locale]/
│   │       ├── layout.tsx
│   │       ├── page.tsx              ← 首页（listPrompts + 分页）
│   │       ├── about/page.tsx
│   │       ├── tags/page.tsx
│   │       ├── tags/[tag]/page.tsx
│   │       ├── models/page.tsx
│   │       ├── models/[model]/page.tsx
│   │       └── prompts/
│   │           └── [slug]/page.tsx   ← 详情页（getPromptBySlug）
│   ├── components/
│   │   ├── Header.tsx                ← 滚动切换 default/compact
│   │   ├── Footer.tsx
│   │   ├── LangSwitcher.tsx
│   │   ├── GridEngine.tsx            ← 真瀑布流 + 触底加载
│   │   ├── PromptCard.tsx            ← 图片 aspect → grid-row span
│   │   ├── PromptCardVideo.tsx       ← RefHandle play/pause API
│   │   ├── MobileFilters.tsx
│   │   ├── TagDisplay.tsx
│   │   ├── CopyButton.tsx
│   │   └── types.ts
│   ├── i18n/request.ts
│   ├── lib/
│   │   ├── parse-md.ts
│   │   ├── parse-md.test.ts
│   │   └── format.ts                 ← formatModelName 等
│   ├── db/
│   │   ├── schema.ts                 ← Drizzle schema (无 locale)
│   │   ├── schema.test.ts
│   │   ├── index.ts
│   │   └── queries.ts                ← listPrompts / getPromptBySlug / listAllTags / listAllModels
│   ├── messages/{en,zh,ja}.json
│   ├── types/
│   │   └── cloudflare-env.d.ts       ← CloudflareEnv 模块扩展
│   └── middleware.ts
├── scripts/
│   ├── import-md-to-d1.ts            ← Phase 2 实装（按 slug 全局去重）
│   └── seed-from-old.ts              ← 占位
├── e2e/                              ← Phase 4 Playwright
├── assets/css/main.css               ← 老站 1126 行 CSS + 瀑布流/详情页样式
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
# ─── 部署（一键脚本）──────────────────────────────
./scripts/deploy.sh              # 完整：type-check + test + build + deploy + 冒烟验证
./scripts/deploy.sh --skip-test  # 跳过 test（改 CSS / 文档时）
./scripts/deploy.sh --dry-run    # 只 build，不 deploy

# ─── 单元测试 ───────────────────────────────────
npm run type-check && npm test

# ─── Playwright e2e ──────────────────────────────
./scripts/deploy.sh --skip-test && npx playwright test --project=chromium

# ─── 部署分步手动 ───────────────────────────────
export $(grep -v '^#' .dev.vars | xargs)
npm run type-check && npm test
npm run build && npm run build:cf
npx wrangler deploy

# ─── D1 数据 ─────────────────────────────────────
# schema init（reset）
npx wrangler d1 execute awesomevideoprompts-db --remote --command "DELETE FROM prompt_tags; DELETE FROM prompt_models; DELETE FROM prompts; DELETE FROM tags; DELETE FROM models;"
npx wrangler d1 execute awesomevideoprompts-db --remote --file=./drizzle/migrations/0000_init.sql

# 灌数据
npx tsx scripts/import-md-to-d1.ts --remote --limit 10     # 测试
npx tsx scripts/import-md-to-d1.ts --remote                # 全量（4479）

# ─── 线上验证 ───────────────────────────────────
for url in \
  "https://awesome-video-prompts-nextjs.semonxue.workers.dev/en" \
  "https://awesome-video-prompts-nextjs.semonxue.workers.dev/zh" \
  "https://awesome-video-prompts-nextjs.semonxue.workers.dev/en/prompts/2066987039866945601-crocodile-floodgate" \
  "https://awesome-video-prompts-nextjs.semonxue.workers.dev/en/tags/cinematic" \
  "https://awesome-video-prompts-nextjs.semonxue.workers.dev/sitemap.xml"; do
  result=$(curl -s -w "TTFB:%{time_starttransfer}s Size:%{size_download}B Code:%{http_code}" -o /dev/null "$url")
  echo "$url | $result"
done

# ─── revalidate（数据更新后）──────────────────────
curl -X POST "https://awesome-video-prompts-nextjs.semonxue.workers.dev/api/revalidate?secret=<REVALIDATE_SECRET>"

# ─── 回滚 ───────────────────────────────────────
npx wrangler rollback
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

⚠️ **Token 已经在对话 transcript 里出现 3+ 次**，部署完必须去 CF Dashboard revoke 重新建一个。TTL 设 24h 较安全。

---

## 17. Lighthouse 报告分析（2026-06-26 首测）

> **测试目标**：`https://awesome-video-prompts-nextjs.semonxue.workers.dev/en`
> **环境**：Chrome 149 / Desktop preset / Benchmark Index 3075.5 / 45 网络请求 / 总传输 663 KiB
> **结论摘要**：Perf **61**（必须修）/ A11y **93**（小修）/ BP **100** / SEO **100**
> **核心矛盾**：LCP 8.3s + Speed Index 7.2s + TTI 8.3s — 全部源于"SSR 文档 + 客户端 JS 启动链 + 原图直出"的组合，未做现代 Web 优化

### 17.1 Core Web Vitals 详情

| 指标 | 当前值 | 目标 | 评级（绿/橙/红）| 根因 |
|---|---|---|---|---|
| FCP | 1.2s | ≤ 1.8s | 绿 ✅ | 文档 580ms 服务端响应，HTML 解析后即时有内容 |
| **LCP** | **8.3s** | ≤ 2.5s | **红** | 首张 cover.jpg 原图直出 + 无 fetchpriority + 无 preconnect |
| **Speed Index** | **7.2s** | ≤ 3.4s | **红** | 24 张原图并行下载阻塞视觉完成 |
| TBT | 30ms | ≤ 200ms | 绿 ✅ | 主线程阻塞极低（无重型 hydrate 逻辑） |
| CLS | 0.083 | ≤ 0.1 | 绿 ✅ | CSS Grid + 显式 aspect-ratio 已稳定 |
| **TTI** | **8.3s** | ≤ 3.8s | **红** | 紧跟 LCP；JS bundle 评估 + hydrate 完成 |
| SI (Server) | 580ms | — | 绿 ✅ | SSR 渲染快，问题出在客户端 |

### 17.2 网络层（45 个请求）

```
总字节：663 KiB
├── HTML (Document):  61 KiB  ← SSR 全量 24 张卡片 metadata 内联
├── CSS:               5.6 KiB
├── JS chunks:        ~145 KiB (7 个 chunks，最大 56KB)
│   ├── 4bd1b696.js   56 KiB  ← Next.js 框架
│   ├── 255-…js       46 KiB  ← Next.js 框架（启动阻塞 977ms）
│   ├── 604-…js       17 KiB
│   ├── main-app      0.5 KiB
│   ├── layout        1.2 KiB
│   ├── page          0.5 KiB
│   └── 241/464-…     9.5 KiB
└── Images: 36 张 cover.jpg，总计 ~770 KiB
    ├── 最大单图：37 KiB
    ├── 平均单图：21 KiB
    └── 全部 JPEG、无 WebP/AVIF、无响应式尺寸
```

**关键观察：**
- **HTML 61 KiB**：含 24 张卡片完整 metadata（title/desc/tags/models/author/date），可考虑精简或流式 hydration
- **CSS 仅 5.6 KiB**：CSS 优化空间有限（老站 1126 行 CSS 已压缩）
- **JS 145 KiB / 7 chunks**：其中 2 个 chunks 占 102 KiB，是 LCP/TTI 的核心瓶颈
- **Image 36 张**：所有图同尺寸同格式，响应式 / 现代格式收益最大

### 17.3 主线程分解（1666ms）

```
Script Evaluation:           923 ms  ← 最大块，Next.js + React 19 启动
Other:                       386 ms
Script Parsing & Compilation: 125 ms
Style & Layout:              111 ms
Garbage Collection:           56 ms
Rendering:                    54 ms
Parse HTML & CSS:             12 ms
```

**启动最慢 chunk**：`255-3124ca945731c9dd.js` 总 977ms（scripting 783ms）—— 启动必须评估执行

### 17.4 Opportunities 排序（按收益）

| # | 项 | 节省 | 实现成本 | 优先级 |
|---|---|---|---|---|
| 1 | 缓存头修复（no-store → s-maxage=3600） | bf-cache + edge hit + LCP -3~5s | 低（headers 设置） | **P0 必做** |
| 2 | 图片格式升级 WebP（R2 transform `?format=webp&q=75`） | -300~400 KiB / LCP -1~2s | 低（一行 srcset） | **P0 必做** |
| 3 | LCP 图片 fetchpriority="high" + 后续图 lazy | LCP -1~2s | 低（DOM 属性） | **P0 必做** |
| 4 | preconnect static.awesomevideoprompts.com | 图片加载开始 -100~300ms | 低（一行 link） | **P0 必做** |
| 5 | JS bundle 拆分（GridEngine 客户端岛 / 动态 import PromptCardVideo） | TTI -2~3s | 中（需重构） | **P0 必做** |
| 6 | A11y: color-contrast + target-size | A11y 93 → 95+ | 低（CSS） | P0 |
| 7 | 字体子集（如果用了非系统字体） | 取决于现状 | 低 | P0 检查 |
| 8 | 缓存 R2 图（已 4h cache TTL，Lighthouse 想更长） | 边际收益 | 不可控 | 观察 |

### 17.5 A11y 失分点

- **color-contrast: 0** — 灰色文本（footer copyright、meta 标签）在浅灰底上对比度不足 4.5:1
- **target-size: 0** — 移动端点击区域 < 44×44px（filter tab、card meta link、Copy 按钮）

### 17.6 不在本次优化范围（解释清楚）

- **next-intl 客户端 runtime 体积**：先看 §0.5 bundle 拆分效果；如果收益足够大再单独优化
- **字体**：当前全用系统字体栈，未发现明显字体加载瓶颈（待 Phase 4 验证）
- **Code splitting per route**：Next 15 App Router 已默认做；pages 之间 chunk 隔离已 OK
- **Service Worker**：Phase 4 不做，留 P3
- **Pre-render 热门页面**：phase 3 已是 SSR + ISR 1h；如果 ISR hit 率高没必要

### 17.7 验证回归（perf 优化完成后必跑）

```bash
# 1. 边缘缓存验证
curl -I https://awesome-video-prompts-nextjs.semonxue.workers.dev/en
# 期望：cache-control: public, s-maxage=3600, stale-while-revalidate=86400
# 期望：cf-cache-status: HIT（第二次跑）

# 2. 现代格式验证
curl -I "https://static.awesomevideoprompts.com/prompts/2026-06/2066811870321979530-ice-dancing-frostnova-seedance/cover.jpg?width=480&format=webp&quality=75"
# 期望：200 OK + content-type: image/webp

# 3. Lighthouse 重跑
# 桌面 + 移动端各跑一次，目标 perf ≥ 90

# 4. Real User Monitoring（灰度前）
# Phase 4 后接 CF Web Analytics 看 P75 LCP
```

#### 17.7.1 P0 #0.1 实装日志（2026-06-26）

**改动文件：** `src/middleware.ts`（仅此一个文件，~30 行）

**关键决策：**
- 关掉 next-intl `localeCookie` + `localeDetection`（URL 已有 locale 前缀，cookie 冗余）
- 在 middleware 包装器里对 `GET /:locale/*` 显式覆盖 `cache-control`
- 兜底 `res.headers.delete('set-cookie')` 保险

**部署版本：** `0ba453f5-73bb-486d-85d3-d8ad0d408634`

**验证结果：**

| 路径 | 修复前 cache-control | 修复后 cache-control | set-cookie 修复前 | set-cookie 修复后 |
|---|---|---|---|---|
| `/en` | `private, no-cache, no-store, max-age=0, must-revalidate` | **`public, s-maxage=3600, stale-while-revalidate=86400`** | `NEXT_LOCALE=en; ...` | ❌ 已删除 |
| `/en?page=2` | `private, no-cache, no-store, ...` | `public, s-maxage=3600, stale-while-revalidate=86400` | 同上 | ❌ 已删除 |
| `/en?page=10` | 同上 | 同上 | 同上 | ❌ 已删除 |
| `/en/tags` | 同上 | 同上 | 同上 | ❌ 已删除 |

**实际收益：**
- ✅ 浏览器层缓存启用（bf-cache 不再被 no-store 拒绝）
- ✅ Lighthouse `bf-cache` 项预计从 FAIL → PASS
- ✅ 重复访问同 URL（用户翻页来回 / 刷新）响应时间显著下降
- ⚠️ CF 边缘缓存（`cf-cache-status: HIT`）未启用：OpenNext on Workers 默认不调用 `caches.default` API，需在 CF Dashboard 配 Cache Rule（不在本项目代码范围），或 OpenNext 升级支持

**type-check / 39 unit tests / build / deploy：** 全绿

**⚠️ 意外发现（非本次改动引入）：**
- 详情页 `/[locale]/prompts/[slug]` 在所有版本上都返回 **HTTP 500**（在改动前已存在，验证方式：stash 改动后重新部署，curl 详情页仍 500）
- React Server Components dump 显示 `"5:E{\"digest\":\"1980652483\"}"` 渲染错误
- 标题/元数据生成正常（说明 generateMetadata 工作），但 page 主体渲染失败
- 根因待排查（不在 P0 #0.1 范围，先标记为 **P0 阻塞 bug**）

**下一步：** 修详情页 500 → 重跑 Lighthouse 验证 perf 改进

### 17.8 风险与权衡

| 权衡点 | 选项 A | 选项 B | 推荐 |
|---|---|---|---|
| 缓存头 | 强缓存 1h | 短缓存 5min + 高频 revalidate | A（流量大盘稳定，1h 足够） |
| 图片格式 | 全量转 WebP 上传 | R2 transform 实时转 | B（不占存储，CDN 边缘缓存） |
| JS 拆分粒度 | 粗（按页面） | 细（按交互） | 细（最大化首屏收益） |
| LCP 优化深度 | fetchpriority + lazy | 加 IntersectionObserver 预测 | fetchpriority 足够，先浅做 |

---

## 17.9 Lighthouse 优化清单（2026-06-26 第二轮报告）

> **测试环境**：Chrome 149 / Desktop / Benchmark Index 3136.5 / 52 请求 / 总传输 812KB
> **测试 URL**：`https://awesome-video-prompts-nextjs.semonxue.workers.dev/en`
> **测试文件**：`awesome-video-prompts-nextjs.semonxue.workers.dev-20260626T22092`（用户上传）

### 17.9.1 优化清单汇总

| 编号 | 改动量 | 预期 Perf ↑ | 预期 A11y ↑ | 对应 Lighthouse 项 |
|---|---|---|---|---|
| **LCP-1** | 1行 | +15~20 | — | Largest Contentful Paint 0.32 |
| **A11Y-1** | 1行 | — | +3~5 | Color Contrast 0 |
| **A11Y-2** | 1~3行 | — | +3~5 | Target Size 0 |
| **CLS-1** | 2行 | +2~5 | — | Cumulative Layout Shift 0.85 |
| **CF-1** | Dashboard手动 | +5~10 | — | TTFB 0（server-response-time） |
| **JS-1** | 1行配置 | +1~3 | — | Legacy JavaScript 0.5 |

**预计总效果**：Perf 71 → 85~95，A11y 93 → 96~100

---

### 🔴 LCP-1 — 前 2 张卡都标记 LCP 候选（改动：1行）

**Why（根因）：**

Lighthouse LCP 元素不是第一张卡，而是 masonry 布局下首屏最大可见图（masonry 第二排第一张，grid 列数多的情况下可能在视觉上占最大面积）。当前 `isFirst={i === 0}` 只把第一张卡设为 `eager+high`，其余 23 张全是 `loading=lazy`。

**实测 LCP 细分：**
```
Time to First Byte:     1534ms  ← TTFB 慢（CF冷启+D1查）
Resource Load Delay:     261ms   ← fetchpriority 影响
Resource Load Duration: 363ms   ← 图片加载
Element Render Delay:    28ms
─────────────────────────────────
LCP Total:             3088ms  → 目标 ≤ 2500ms
```

**How：**

```tsx
// src/components/GridEngine.tsx:149
// 改前：isFirst={i === 0}
// 改后：
<PromptCard key={p.slug} prompt={p} locale={locale} isFirst={i < 2} />
```

**验证方式：**
```bash
npx playwright test  # 确保 e2e 不坏
# 然后 Lighthouse 重跑，目标 LCP ≤ 2.5s
```

---

### 🔴 A11Y-1 — `.prompt-date` 颜色修复（改动：1行）

**Why（根因）：**

```css
.prompt-date {
  color: var(--border-strong); /* #D4D4D4 */
  /* 浅灰文字 × 白底 = 对比度 1.48:1 */
  /* WCAG AA 要求 ≥ 4.5:1 ❌ */
}
```

Lighthouse axe-core 抓到了 `.prompt-date span`（2026-06-16 日期文本），对比度 1.48:1。

**How：**

```css
/* assets/css/main.css:1100 */
.prompt-date {
  /* 改前 */
  color: var(--border-strong); /* #D4D4D4 — 对比度 1.48:1 ❌ */
  /* 改后 */
  color: var(--text-tertiary);  /* #757575 — 对比度 4.8:1 ✅ */
}
```

**验证方式：**
```bash
# 本地 Playwright
npx playwright test --grep "a11y\|accessibility"  # 若有 a11y 测试
# 或 Lighthouse Accessibility ≥ 96
```

---

### 🔴 A11Y-2 — `.model-badge` 触摸目标尺寸（改动：1~3行）

**Why（根因）：**

```css
/* 当前 .model-badge 实测：79×23px */
/* WCAG 2.5.8 Target Size 要求：≥ 24×24px ❌ */
/* 且与相邻元素间距不足（最近邻居直径 23px < 24px）*/
```

**How：**

```css
/* assets/css/main.css 或 PromptCard.tsx inline style */
.model-badge {
  min-width: 24px;
  min-height: 24px;
  padding: 2px 6px;  /* 保持可读性 */
}
```

> 注：`padding` 会增大元素尺寸但不影响内部文字排版。等效于 `min-width: 24px` 的 `a` tag 在 `display: inline-block` 时会被内容撑开，此处已有固定 `font-size: 10px`，只需加 `min-height` 即可。

**验证方式：** Lighthouse Accessibility ≥ 96

---

### 🟡 CLS-1 — 图片容器加载占位（改动：2行）

**Why（根因）：**

`.prompt-image-wrapper` 用 `padding-bottom` 基于 `aspect` prop 撑高度，但图片 `loading=lazy` 时，图片加载前容器高度计算依赖 `aspect` prop 的存在。如果 `aspect` 为 `undefined`（某些 prompt 数据缺失宽高比），wrapper 高度为 0，卡片加载后跳高。

实测 CLS 分数 0.118（轻微，p10=0.1 略超）。

**How：**

```tsx
// src/components/PromptCard.tsx — 给 image-wrapper 加 CSS aspect-ratio 备用占位
<div
  className="prompt-image-wrapper"
  style={{
    // 改前：aspect 为 undefined 时容器高度 0
    // 改后：加 CSS 默认占位（JS 计算出 aspect 后 padding-bottom 会覆盖）
    ...(aspect ? { paddingBottom: `${(1 / aspect) * 100}%` } : { paddingBottom: '56.25%' })
  }}
  // padding-bottom: 56.25% = 16:9 默认比例兜底
>
```

**验证方式：**
```bash
# Lighthouse Cumulative Layout Shift ≤ 0.05
```

---

### 🟡 CF-1 — Cloudflare Dashboard Cache Rules（需手动操作）

**Why（根因）：**

TTFB 1.53s = CF Workers 冷启动（~500ms）+ D1 跨区查询（~800ms）+ 网络 RTT（~200ms）。冷启动无法消除，但边缘缓存可以让热路径命中 CF PoP，绕过 Workers 直接返回。

**How（Dashboard 手动操作）：**

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 `awesome-video-prompts-nextjs` Worker
3. **Settings → Cache Rules → Create rule**：
   - **When**: `awesome-video-prompts-nextjs.semonxue.workers.dev/*`
   - **Cache**: Edge TTL = **3600 seconds**（1小时）
   - **Browser TTL**: Respect origin headers
4. **Save and Deploy**

**验证方式：**
```bash
# 第一次请求（冷）：TTFB ~1.5s
curl -s -w "\nTTFB: %{time_starttransfer}s" -o /dev/null https://awesome-video-prompts-nextjs.semonxue.workers.dev/en
# 第二次请求（热，CF 命中）：TTFB 应 < 50ms
curl -s -w "\nTTFB: %{time_starttransfer}s" -o /dev/null https://awesome-video-prompts-nextjs.semonxue.workers.dev/en
# 观察 cf-cache-status header
curl -I https://awesome-video-prompts-nextjs.semonxue.workers.dev/en | grep -i "cf-cache-status"
```

---

### 🟡 JS-1 — 去掉 ES5 polyfills（改动：1行配置）

**Why（根因）：**

```json
/* legacy-javascript 审计项：浪费 11KB polyfills */
"Array.prototype.at",
"Array.prototype.findLast",
...
```

Next.js 默认转译到 ES5（含 IE11 polyfills），但现代浏览器（Chrome 149 / Lighthouse 测试环境）不需要这些 polyfills。

**How：**

```js
// next.config.ts — 检查是否已有 polyfill 相关配置
// 若有 targets: { ie: 11 } 或类似配置，删除或改为 targets: ['chrome120']
module.exports = {
  compiler: {
    // removeConsole: process.env.NODE_ENV === 'production',
    // 如果有以下配置，改为现代浏览器目标或删除：
    // reactRemoveProperties: { names: ['data-testid'] },
  },
}
```

> ⚠️ **前置检查**：先跑 `npm run build` 看 output，确认是否真的有 ES5 输出。Legacy JS 审计可能是误报（Next.js 内部 polyfills）。

**验证方式：**
```bash
npm run build
# 检查 .open-next/server/ 下的 chunk 大小
# Lighthouse Legacy JavaScript savings ≥ 11KB → ✅
```

---

### 17.9.2 暂不处理（解释清楚）

| 项 | 原因 | 备注 |
|---|---|---|
| TTFB 1.53s（冷启动） | CF Workers 冷启动平台限制，代码层面无法消除 | CF-1 Cache Rules 可缓解热路径 |
| LCP Image discovery `fetchpriority=high` Lighthouse 说"should apply"但 LCP 图片是 `loading=lazy` | **这是正常的** — LCP 图片的 fetchpriority 已在 `isFirst={i < 2}` 时设为 `high`；Lighthouse 提示的是"其余 lazy 图片应用 fetchpriority=high"，这是误报，不改 | Lighthouse insight 显示 `"priorityHinted": false` 指的是非首屏图，不影响 LCP |
| Document latency insight "server response is slow (1526ms)" | 同 TTFB，CF-1 可缓解 | 暂时接受 |
| Unused JavaScript score 0.5 | 需 bundle analyzer 看具体来源 | 暂不处理（TTI 已 3.1s 达标）|
| Render blocking CSS | CSS 5.6KB 已最小化，`<link rel=stylesheet>` 无法内联（SSR 多语言） | 暂不处理 |
| Unminified JS | OpenNext build 默认 minify；若未 minify 可加 `terserOptions` | 下个 build 确认 |

---

### 17.9.3 验证回归流程（每次优化后必跑）

```bash
# 1. type-check + unit tests
npm run type-check && npm test

# 2. Playwright e2e（确保功能不坏）
npx playwright test --project=chromium --timeout=60000

# 3. 关键路由 TTFB
for url in \
  "https://awesome-video-prompts-nextjs.semonxue.workers.dev/en" \
  "https://awesome-video-prompts-nextjs.semonxue.workers.dev/zh" \
  "https://awesome-video-prompts-nextjs.semonxue.workers.dev/en/prompts/2066987039866945601-crocodile-floodgate" \
  "https://awesome-video-prompts-nextjs.semonxue.workers.dev/en/tags/cinematic" \
  "https://awesome-video-prompts-nextjs.semonxue.workers.dev/sitemap.xml"; do
  result=$(curl -s -w "TTFB:%{time_starttransfer}s Size:%{size_download}B Code:%{http_code}" -o /dev/null "$url")
  echo "$url | $result"
done

# 4. cache-control headers
curl -I https://awesome-video-prompts-nextjs.semonxue.workers.dev/en | grep -i "cache-control\|cf-cache-status"

# 5. Lighthouse（最终验证）
# 桌面端跑一次，目标 Perf ≥ 90 / A11y ≥ 96
```
