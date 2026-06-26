# Awesome Video Prompts (Next.js) — 执行母版

> 状态：**Phase 3 完成**（架构 + 数据层 + 全量 4479 条 + 真瀑布流 + 触底加载 + 视频 hover 预览 + 详情页）
> 仓库：`awesome-video-prompts-nextjs`（独立仓库）
> 最后更新：2026-06-26
> 在线：`https://awesome-video-prompts-nextjs.semonxue.workers.dev`（en/zh/ja 三语言，全量数据已上线）

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
- ✅ **触底加载**（URL ?page=N + IntersectionObserver + router.push）
- ✅ 模型 / 标签按 count DESC 排序（修了 promptModels join 字段写反 bug）
- ✅ 极简视频加载动画（3 dot → 单 spinner）
- ✅ 详情页样式完整（之前完全缺失，补 130 行 CSS）
- ✅ 39 tests passing

### Phase 4：UAT 验收 + 性能优化 ⏳ 当前进行中
- ☐ Playwright e2e 关键路径（首页瀑布流 / 触底翻页 / 详情页 / 复制 / 跨语言切换）
- ☐ Lighthouse 评分（perf / a11y / SEO 4 项；目标 ≥ 90）
- ☐ Sitemap / robots.txt 动态生成
- ☐ ISR `/api/revalidate` 端到端验证
- ☐ OG image 生成（每个详情页独立 OG image）
- ☐ SEO 对齐（hreflang / canonical / meta description）
- ☐ 错误率 / 性能监控（CF Analytics + 自建 health check）
- ☐ R2 公开 URL 跨域检查 + CORS 配置

### Phase 5：移动端优化 + Admin 后台 ⏳ 待 UAT 后启动
- ☐ 移动端 UI 优化（响应式瀑布流 / 移动端筛选抽屉 / 触屏 hover 替代）
- ☐ Admin 后台（prompt 编辑 / 上传 / 审核 / 删除）
- ☐ 内容更新工作流自动化（GitHub Action 监听老仓库 MD 改动 → 自动 import + revalidate）
- ☐ Open Graph image 服务端生成器（edge function）
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

### 8.2 Phase 4 UAT（待跑）
- [ ] Playwright e2e 5 个关键路径全绿
- [ ] Lighthouse perf ≥ 90 / a11y ≥ 95 / SEO ≥ 95 / best-practices ≥ 90
- [ ] Sitemap 4479 个详情页 + 3 个 locale alternates 完整
- [ ] CF Cache 命中率 ≥ 90%（24h 监控）
- [ ] P95 延迟 < 500ms
- [ ] 错误率 < 0.1%

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

---

## 11. 当前 commit 历史

```
8b163c1 feat: 前端表达对齐老站（Phase 2.7）
c31bc29 fix: 前端表达对齐老站
0140b52 fix: 静态资源 404 + 双 Header 渲染
bc14433 feat: 视觉 1:1 还原 awesomevideoprompts.com
96444e3 docs: 更新 EXECUTION.md — 反映 Phase 2 实际状态 + 后续工作计划
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
| **Last Version** | `d3d3e211-435e-45c2-876c-9b3fc3868553` |
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

### P0 — Phase 4 UAT 验收前必做（目标：本周内）

1. **Playwright e2e 5 个关键路径**
   - 首页瀑布流加载（验证 24 张卡 + 5 列网格 + 错落排列）
   - 触底翻页（滚到底 → URL ?page=2 → cards 替换为下 24 张）
   - 详情页（点击 card title → 跳 `/[locale]/prompts/[slug]` → 4 格 meta + Copy prompt + You Might Also Like）
   - 复制功能（点击 description → toast "✓ Copied!" + 剪贴板内容正确）
   - 跨语言切换（点 EN → ZH → JA，UI 文案全换，prompt 内容数据一致）
2. **Lighthouse 评分**
   - perf / a11y / SEO / best-practices 4 项；目标 ≥ 90
   - 优化点（按结果调整）：图片 lazy loading / 字体子集 / CSS 关键路径 / 第三方脚本
3. **Sitemap / robots.txt**
   - 动态生成 `/sitemap.xml`（4479 个详情页 + 3 个 locale alternates + 索引页）
   - robots.txt 指向 sitemap + 允许主流爬虫
4. **ISR `/api/revalidate` 实装 + 端到端验证**
   - 实现路由 `src/app/api/revalidate/route.ts`
   - 读 `REVALIDATE_SECRET` env var，POST 时校验
   - 调 `revalidatePath('/[locale]', 'page')` 失效指定 URL
5. **OG image 生成**
   - 每个详情页独立 OG image（用 prompt.coverUrl 拼背景 + 标题文字）
   - edge function 生成 + R2 缓存
6. **SEO 对齐**
   - hreflang（每页 3 个 locale alternate）
   - canonical URL
   - meta description（每页独立，从 prompt.description 截前 160 字符）
7. **R2 公开 URL CORS 检查**
   - `curl -I https://static.awesomevideoprompts.com/...` 确认 `access-control-allow-origin`
   - 没的话：改 R2 CORS 规则 或 走 CF Worker 反代

### P1 — Phase 5 移动端 + Admin（目标：UAT 通过后启动）

8. **移动端 UI 优化**
   - 响应式瀑布流（2 列 / 3 列断点已支持；优化 touch 体验）
   - 移动端筛选抽屉（MobileFilters 完善）
   - 触屏 hover 替代（mobile 不支持 hover → click thumbnail 触发视频播放）
   - 移动端详情页布局（视频全宽 / meta grid 单列）
9. **Admin 后台**（独立路由 `/admin/*`，Basic Auth 保护）
   - prompt 列表（搜索 / 筛选 / 分页）
   - prompt 编辑（title / description / tags / models / sourceUrl / author / promptDate / cover / video URL）
   - prompt 新增（手动录入 or 粘贴 URL 自动解析）
   - prompt 删除 / 标记 draft
   - tags / models 管理（合并 / 重命名 / 废弃）
   - 媒体上传（封面 + 视频，自动 R2 部署）
10. **内容更新工作流自动化**
    - GitHub Action：监听 `awesome-video-prompts` 仓库 content/ 目录改动
    - 触发 → 跑 import 脚本（限 changed files）→ 调用 `/api/revalidate`
    - 失败告警（邮件 / 飞书 / Slack）
11. **Open Graph image 服务端生成器**
    - edge function（`@cf-wasm/satori` 或 `@vercel/og`）生成 prompt.coverUrl + title
    - R2 缓存（URL hash → image）
12. **全文搜索**
    - Fuse.js 客户端（轻量，无需后端）— 4k prompts 客户端搜索 < 50ms
    - 后续：Algolia 服务端（如果规模扩到 10k+）
13. **作者主页**（按 `author` dedupe 后建 `/authors/[handle]`）
    - 类似 model/tag 独立页 + 该作者所有 prompt
14. **监控告警**
    - CF Analytics dashboard
    - 自建 health check（每 5min 跑 `curl /en?page=200` 验证深层翻页正常）
    - 告警：5xx > 0.5% / P95 > 500ms / D1 错误率 / ISR 缓存命中率

### P2 — Phase 6 灰度切流（业务方触发）

15. **CF Rules 配灰度分流**（10% → 30% → 50% → 100%）
16. **老 URL 301 规则部署**（`/zh-cn/...` → `/zh/...` 等）
17. **DNS 切主域**（`awesomevideoprompts.com` → 新 Workers）
18. **7 天稳定性观察** + 灰度全量
19. **Prompt 评分 / 收藏**（Phase 6 后）
20. **Plausible / CF Analytics view-more 点击率**（运营优化）
21. **订阅 / RSS**（按 model / tag 订阅）

### P3 — 长线优化（按需）

22. **R2 媒体迁移**（去依赖老 CDN `static.awesomevideoprompts.com`）
23. **MD editor 工具升级**（与新站 deploy 流程协同）
24. **历史数据治理**（重复 prompt 去重 / 标签字典规范化 / 媒体孤儿清理）
25. **多语言 LLM 翻译灌入**（可选：用 LLM 把 en 翻译成 zh/ja 写入 D1，UI 不变）
26. **社区功能**（用户登录 / 收藏 / 评论 / 投稿）

---

## 14. 附录：仓库结构

```
awesome-video-prompts-nextjs/
├── docs/
│   └── EXECUTION.md                  ← 本文件
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
# 本地 dev（需先 set CLOUDFLARE_API_TOKEN 等 env）
export CLOUDFLARE_API_TOKEN=$(awk -F'=' '/^CLOUDFLARE_API_TOKEN/{print $2}' .dev.vars)
export CLOUDFLARE_ACCOUNT_ID=$(awk -F'=' '/^CLOUDFLARE_ACCOUNT_ID/{print $2}' .dev.vars)
export CLOUDFLARE_D1_DATABASE_ID=$(awk -F'=' '/^D1_DATABASE_ID/{print $2}' .dev.vars)
export LEGACY_CONTENT_DIR=/Users/semonxue/Workplace/Works/ai-dev/awesome-video-prompts/content
export R2_PUBLIC_URL=https://static.awesomevideoprompts.com

# 1. 远程 D1 schema init（reset + recreate）
npx wrangler d1 execute awesomevideoprompts-db --remote --command "DELETE FROM prompt_tags; DELETE FROM prompt_models; DELETE FROM prompts; DELETE FROM tags; DELETE FROM models;"
npx wrangler d1 execute awesomevideoprompts-db --remote --file=./drizzle/migrations/0000_init.sql

# 2. 灌数据（10/30/全量）
npx tsx scripts/import-md-to-d1.ts --remote --limit 10     # 测试
npx tsx scripts/import-md-to-d1.ts --remote --limit 30     # UAT-1
npx tsx scripts/import-md-to-d1.ts --remote                # 全量（4479）

# 3. type-check + tests
npm run type-check && npm test

# 4. build + opennext build
npm run build && npm run build:cf

# 5. deploy
npx wrangler deploy

# 6. 验证
curl -sSL https://awesome-video-prompts-nextjs.semonxue.workers.dev/en | head -c 500
curl -sSL https://awesome-video-prompts-nextjs.semonxue.workers.dev/en?page=2 | head -c 500
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
