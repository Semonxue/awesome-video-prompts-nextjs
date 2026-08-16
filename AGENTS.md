# AGENTS.md — Awesome Video Prompts Next.js

> 必读：未来 session 在这个项目工作时，第一件事先读这份文档。

## 部署铁律（用户明确要求）

**所有最终修改必须落到代码层面，通过 git 部署。不要手动上传 build 产物。**

- 改 `src/...`、commit、push → 由 build pipeline 生成 `.open-next/worker.js` → CF 部署
- 永远不要手动 `wrangler deploy` 一个手工拷贝的 `.open-next/` 目录
- AGENTS.md / 任何新文档的改动，也走 git 流程

## Build 流水线（关键踩坑点）

这个项目有**两个** build step，缺一不可：

| 命令 | 作用 |
|---|---|
| `npm run build` | 只跑 `next build`，生成 `.next/`（不够！） |
| `npm run build:cf` | 跑 `opennextjs/cloudflare build`，生成 `.open-next/worker.js` ← **CF 真正部署的文件** |
| `prebuild:cf` | `build:cf` 前自动跑：装自定义 OpenNext wrapper（见下） |

**正确流程**：`npm run deploy`（封装了 type-check + test + build + build:cf + deploy + 冒烟 + 字典校准）

**踩坑实录（2026-08-15）**：只跑 `npm run build` 不跑 `build:cf` → `.open-next/` 不更新 → 部署的是旧 worker → 改了等于没改、D1 cost 反而涨。

## Cache-Control Wrapper（必须装）

`open-next.config.ts` 注释明说：Next.js 15 page handler 在 `sendRenderResult` 阶段会**重置** `Cache-Control` 到 `no-store`，**覆盖 middleware 的 `s-maxage=3600`**。修法是自定义 OpenNext wrapper：

- 源文件：`wrappers/cache-control-cloudflare-node.js`
- 装到：`node_modules/@opennextjs/aws/dist/overrides/wrappers/cloudflare-node.js`
- 装脚本：`scripts/copy-wrapper.mjs`（由 `prebuild:cf` 触发）

**检查命令**：
```bash
grep "s-maxage=3600" node_modules/@opennextjs/aws/dist/overrides/wrappers/cloudflare-node.js
# 没结果 = wrapper 没装，CDN 边缘缓存不会生效，每次请求都打 worker
```

## 关键架构备忘

- **D1 + R2 + Cloudflare Workers**（via OpenNext）
- **缓存层**（已有）：L1 内存 + L2 Cache API + R2 聚合缓存（tags.json / models.json / counts.json 等）
- **D1 cost 控制**：详情页相关/上下篇查询是 99% D1 rows read 来源，**namespace version stamp** 模式（见 `src/db/cache.ts` 的 `getNamespacedCachedData` / `bumpNamespaceVersion`）
- **published prompt count**：约 5,055（截至 2026-08-15）
- **API secret**：`ADMIN_SECRET` / `REVALIDATE_SECRET` 通过 `wrangler secret put` 设置，不在 wrangler.toml

## 详情页查询预算

| 查询 | 缓存状态 | 备注 |
|---|---|---|
| `getPromptBySlugCached` | ✅ L1+L2 | slug-keyed |
| `getRelatedPromptsCached` | ✅ namespace version | 改 prompt 时全清 |
| `getAdjacentPromptsCached` | ✅ namespace version | 改 prompt 时全清 |
| `listAllTags/Models` | ✅ R2 聚合 | 读 `_cache/*.json` |
| `listPrompts` | count 走 R2，rows 直查 | 主要成本走 idx_prompts_draft_date |

D1 query 监控命令：
```bash
npx wrangler d1 insights awesomevideoprompts-db
```
