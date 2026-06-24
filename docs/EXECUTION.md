# Awesome Video Prompts (Next.js) — 执行母版

> 状态：Phase 0（仓库初始化 + 文档冻结）
> 仓库：`awesome-video-prompts-nextjs`（新建，独立仓库）
> 最后更新：2026-06-24

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
- 把 awesome-video-prompts.com（老 Hugo 站）迁到 Next.js + Cloudflare Workers
- 解决 Pages 20000 文件硬限制（当前 deploy 65145 文件 / 17GB）
- 维持三语言（en/zh/ja）+ SEO + 老 URL 301 兼容

### 1.2 技术目标
- **架构**：Next.js 15 App Router + Cloudflare Workers（via OpenNext）
- **数据**：D1（prompts 元数据）+ R2（媒体文件）+ Workers KV（不用，决策见 §10）
- **渲染策略**：准静态 Hybrid（SSG + ISR + 边缘缓存），不用纯 SSR
- **国际化**：next-intl 3.x，locale 前缀路由
- **样式**：保留老站 1126 行 CSS，渐进式适配

### 1.3 老仓库定位
- `awesome-video-prompts`（老 Hugo）→ **只读数据源**
- MD 内容留在老仓库，import 脚本读相对路径
- 媒体文件保留在老 R2 bucket（共用），新项目通过自定义域访问

---

## 2. 当前基线（Phase 0 冻结）

### 2.1 老站数据规模
- MD 文件：~13437 个（4479 prompts × 3 语言）
- 媒体文件：~39169 个（视频 mp4 + 封面 jpg，每个 prompt 约 2 个）
- 总可 deploy 文件：**65145**（超 Pages 20000 限制 3x+）
- deploy 体积：~17GB

### 2.2 新站目标规模
- deploy 文件目标：**< 100**（不计 node_modules / .open-next）
- deploy 体积目标：**< 5MB**
- HTML 详情页：0（ISR 运行时渲染，不预生成）
- 媒体文件：0（外置 R2）
- 静态 JSON：0（D1 是唯一数据源，运行时直接查 + ISR 边缘缓存）

### 2.3 文件数门禁线
| 阶段 | 目标 | 预警 | 阻断 |
|---|---|---|---|
| Phase 1 骨架 | < 50 | 80 | 100 |
| Phase 3 UAT-1（30 条种子） | < 80 | 100 | 150 |
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
│  │  - 边缘缓存（CF Cache API）                       │   │
│  └──────────────────────────────────────────────────┘   │
│            │                          │                  │
│            ▼                          ▼                  │
│  ┌──────────────────┐      ┌─────────────────────┐      │
│  │  D1 (prompts-db) │      │  R2 (media bucket)  │      │
│  │  元数据查询       │      │  static.*.com       │      │
│  └──────────────────┘      └─────────────────────┘      │
└─────────────────────────────────────────────────────────┘
```

### 3.1 数据流

**单一数据源**：D1 是所有读路径的唯一数据源，**不**预生成 JSON 索引、不 build-time 注入静态数据。

```
首页 /en 请求
  ↓
Cloudflare Edge (ISR 缓存层，TTL = 1h)
  ├─ 缓存命中（1h 内同 URL）→ 直接返回 HTML，0 次 D1 调用
  └─ 缓存未命中 / 首次 → Workers 查 D1 → 渲染 HTML → 写回缓存
  ↓
返回 HTML 给用户

详情页 /[locale]/prompts/[slug]、/tags/[tag]、/models/[model] 同模式
API /api/prompts 直查 D1（不走 ISR，供外部消费方用）
```

**资源账**：
- D1 读：4479 个 URL × 1 次/h × 24h ≈ ~10w 次/天，CF D1 免费额度 5M/天，**余量 50x**
- CF Cache 命中：> 95%
- 部署文件：相比引入 prompts-index 方案少 3 个 JSON

### 3.2 媒体外置
- 老 R2 bucket 已用 `static.awesomevideoprompts.com` 自定义域
- 媒体 URL 形式：`https://static.awesomevideoprompts.com/prompts/{YYYY-MM}/{slug}/cover.jpg`
- 新项目不动 R2，URL 原样使用

---

## 4. 路由级渲染策略

| 路径 | 渲染 | ISR | 缓存策略 | 备注 |
|---|---|---|---|---|
| `/[locale]` | SSG + ISR | 1h | edge cache | 列表页 |
| `/[locale]/prompts/[slug]` | SSG + ISR | 1h | edge cache | 详情页 |
| `/[locale]/prompts/[slug]` (热门 Top 100) | SSG 预生成 | — | — | 提升 TTFB |
| `/[locale]/tags/[tag]` | SSG + ISR | 1h | edge cache | 标签聚合 |
| `/[locale]/models/[model]` | SSG + ISR | 1h | edge cache | 模型聚合 |
| `/[locale]/about` | SSG | — | static | 静态页 |
| `/api/prompts` | Workers dynamic | — | stale-while-revalidate | API |
| `/api/revalidate` | Workers dynamic | — | no cache | 手动失效 |
| `static.*.com/...` | R2 public | — | CDN | 媒体 |

### 4.1 URL 变化（301 重定向）
| 老 URL | 新 URL | 触发位置 |
|---|---|---|
| `/zh-cn/...` | `/zh/...` | CF Rules |
| `/prompts/YYYY/MM/slug/` | `/{locale}/prompts/slug/` | CF Rules |
| `/tags/{name}/` | `/{locale}?tag={name}` | CF Rules |
| `/models/{slug}/` | `/{locale}?model={slug}` | CF Rules |

---

## 5. D1 Schema（冻结）

文件：`drizzle/migrations/0000_init.sql`

```sql
-- 主表
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
  updated_at TEXT NOT NULL,
  UNIQUE(slug, locale)
);

-- 标签字典 + 多对多
CREATE TABLE tags (id, name UNIQUE);
CREATE TABLE prompt_tags (prompt_id, tag_id, PRIMARY KEY);

-- 模型字典 + 多对多
CREATE TABLE models (id, slug UNIQUE, name);
CREATE TABLE prompt_models (prompt_id, model_id, PRIMARY KEY);

-- 索引：按 locale + 日期排序（详情/列表主路径）
CREATE INDEX idx_prompts_locale_date ON prompts(locale, prompt_date DESC);
CREATE INDEX idx_prompts_locale_draft ON prompts(locale, is_draft);
-- 多对多索引
CREATE INDEX idx_prompt_tags_tag ON prompt_tags(tag_id);
CREATE INDEX idx_prompt_models_model ON prompt_models(model_id);
```

### 5.1 关键决策
| 项 | 决策 | 原因 |
|---|---|---|
| `prompt_date` 类型 | TEXT ISO 8601 | D1 无原生 DATE；ISO 排序天然按字典序=时间序 |
| `created_at`/`updated_at` | TEXT ISO 8601 + NOT NULL | 同上；NOT NULL 强制写入 |
| 是否上 FTS5 | **不上** | CJK FTS5 分词效果差，全用 LIKE %q% 兜底；老站实测可行 |
| 是否用 KV | **不用** | CF Cache API 替代；KV 增加 binding 复杂度 |
| `is_draft` | INTEGER 0/1 | 不用 BOOLEAN（D1 无原生） |

---

## 6. 关键脚本设计

### 6.1 `scripts/import-md-to-d1.ts`
- 读 `LEGACY_CONTENT_DIR`（默认指向老仓库 `content/`）
- 解析 MD front matter（用 `gray-matter` + `parse-md.ts`）
- 写 D1（**Phase 2 改用 HTTP API**，不用 wrangler 子进程）
- 批量 100 条/批 + 事务
- 幂等：`INSERT OR REPLACE` + `UNIQUE(slug, locale)`

### 6.2 `scripts/seed-from-old.ts`（Phase 3 UAT-1 用）
- 从老站随机抽 30 条种子（覆盖月份+模型+标签多样性）
- 写本地 D1（仅写库，不生成 JSON）

### 6.3 `scripts/migrate-cold-hot.js`（Phase 3 R2 用）
- 把老 R2 上 4479 prompts × 2 媒体文件分类
- hot（封面图）保留自定义域访问
- cold（视频）按需迁移到 R2（已就位则跳过）

---

## 7. 执行阶段（6 个 Phase）

### Phase 0：仓库初始化 + 文档冻结 ← 当前
- ✅ 创建 `awesome-video-prompts-nextjs` 仓库
- ✅ 配置 package.json / wrangler.toml / next.config.ts
- ✅ 复制核心资产（main.css / parse-md.ts / i18n / schema）
- ⏸ **等待本文档用户确认**

### Phase 1：架构骨架（1-2 天）
- 实现 `Header` / `Footer` / `LangSwitcher` / `GridEngine` / `PromptCard` / `MobileFilters` / `TagDisplay` / `CopyButton` 组件
- 实现 `/[locale]` / `/[locale]/prompts/[slug]` / `/[locale]/about` 页面（数据源：直接 D1 查询）
- 占位 `seed-from-old.ts`（返回空）
- **验收**：`npm run dev` 跑起来，访问 `/en` `/zh` `/ja` 看到空壳 UI，组件 CSS 正常

### Phase 2：数据层实装（2-3 天）
- D1 schema 在本地执行（`npm run db:schema:local`）
- 重写 `import-md-to-d1.ts`：用 HTTP API + 事务 + 批量
- 加 `/api/revalidate` 路由（手动失效缓存）
- **验收**：手动 import 10 条 MD 到本地 D1，访问首页能看到 10 条（ISR 缓存生效）

### Phase 3：UAT-1 演示数据（1-2 天）
- 写 `seed-from-old.ts`：从老仓库抽 30 条种子
- 视觉 1:1 还原（CSS 完整复用，组件与 Hugo partials 对齐）
- 移动端筛选抽屉实现
- 三语言 UI 文案完整化
- **验收**：UAT-1 通过
  - 三语言页面可访问，筛选/分页正常
  - 视频 hover 预览与老站一致
  - `/api/prompts` 可消费
  - 文件数 < 80

### Phase 4：UAT-2 全量数据（2-3 天）
- 全量 import 4479 prompts × 3 语言 = 13437 条
- 性能压测（CF Cache 命中率、ISR 命中、D1 查询延迟）
- SEO 对齐（hreflang / sitemap / robots）
- 老 URL 301 规则部署
- **验收**：UAT-2 通过
  - 全量数据对账通过（vs 老 Hugo 静态站）
  - SEO 字段完整（meta / og / hreflang）
  - 性能阈值（首屏 < 1.5s @ P75）
  - 错误率 < 0.1%

### Phase 5：灰度切流（1 周）
- 新站部署到 `v3.awesomevideoprompts.com`（子域名）
- CF Rules 配灰度分流（10% → 30% → 50% → 100%）
- 每档必过项：可用性 / 延迟 / R2 命中率 / D1 查询稳定
- 全量后切主域，老站降级归档
- **验收**：主域 100% 流量到新站，老站保留只读

### Phase 6：后续优化
- 历史数据治理（重复 prompt 去重 / 标签字典规范化）
- MD editor 工具升级（与新站 deploy 流程协同）
- 监控告警（CF Analytics + 自建 health check）

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
| D1 导入失败/数据损坏 | 全站不可用 | `wrangler d1 execute prompts-db --remote --file=drizzle/migrations/0000_init.sql` + 重跑 import | ~30 分钟 |
| R2 媒体 404 | 详情页图片/视频缺失 | 切换 R2 bucket 到 read-only 老 bucket（DNS 不变） | < 1 分钟 |
| Workers 部署失败 | 5xx 全站 | `wrangler rollback` 回上一版本 | < 2 分钟 |
| 灰度异常 | 部分用户受影响 | CF Rules 调分流比例到 0% | < 1 分钟 |
| ISR 缓存不刷新 | 新增 prompt 看不到 | 触发 `/api/revalidate?secret=...` | < 30 秒 |
| 老 URL 301 规则错误 | SEO 流量损失 | 关闭 CF Rules 的 rewrite 规则 | < 5 分钟 |

### 9.1 主域名回滚（最严重场景）
1. CF Rules 关闭新站 rewrite（`/<locale>/...` 不再被接管）→ **5 分钟**
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
| 13 | **去掉** build 时预生成 prompts-index.json | build 时生成静态 JSON | D1 是唯一数据源；ISR 1h 边缘缓存已覆盖性能需求；预生成会增加构建耦合（新增 prompt 必须重 deploy）+ 部署体积（+4.5MB JSON）+ 缓存粒度差 | 2026-06-24 |

---

## 11. 下一阶段（Phase 1）任务清单

执行 Phase 0 文档确认后，Phase 1 开始：

1. ☐ 创建 8 个组件：`Header` / `Footer` / `LangSwitcher` / `GridEngine` / `PromptCard` / `MobileFilters` / `TagDisplay` / `CopyButton`
2. ☐ 实现首页 `/[locale]/page.tsx`：服务端筛选 + 分页（数据源：直接查 D1，ISR 1h 缓存）
3. ☐ 实现详情页 `/[locale]/prompts/[slug]/page.tsx`：generateMetadata + 复制按钮（按 slug 查 D1）
4. ☐ 实现 `/[locale]/about/tags/models/page.tsx` 占位
5. ☐ 占位 `scripts/seed-from-old.ts`
6. ☐ 实现单元测试：`src/lib/parse-md.test.ts` + `src/db/schema.test.ts`
7. ☐ `npm install` 安装依赖
8. ☐ `tsc --noEmit` 验证编译
9. ☐ `npm run dev` 验证三语言空壳 UI

**Phase 1 交付物**：`/en /zh /ja` 三语言页面 + Header/Footer/LangSwitcher + 空网格骨架，文件数 < 50。

---

## 12. 附录：仓库结构

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
│   │       ├── page.tsx
│   │       ├── about/page.tsx
│   │       ├── tags/page.tsx
│   │       ├── models/page.tsx
│   │       └── prompts/
│   │           └── [slug]/page.tsx
│   ├── components/                   ← Phase 1 创建
│   ├── i18n/request.ts
│   ├── lib/
│   │   └── parse-md.ts
│   ├── db/
│   │   ├── schema.ts
│   │   └── index.ts
│   ├── messages/{en,zh,ja}.json
│   └── middleware.ts
├── scripts/                          ← Phase 2/3 创建
├── e2e/
├── assets/css/main.css               ← 老站 1126 行 CSS
├── public/                           ← 媒体走 R2，本目录只放 favicon 等少量静态资源
├── package.json
├── wrangler.toml
├── next.config.ts
├── open-next.config.ts
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
└── .gitignore
```