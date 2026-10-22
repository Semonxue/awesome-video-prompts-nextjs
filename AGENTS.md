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

## 类别页内容化的数据口径铁律（2026-10-22）

model 页 / tag 页已经做成「内容页」（导语 + FAQ + CollectionPage/ItemList + FAQPage）。
实现见 `src/lib/content-pages.ts`（纯函数）+ `src/db/queries.ts` 的统计聚合。

**铁律：正文里的每个数字必须是「全量真值」，不能是「当前页现算」。**

2026-10-22 上线当天就踩了这个坑：tag 页的 model 分布是从**当前页 48 条**现算的，
却拿去和 tag 总数比较，线上渲染成：

    "seedance25 covering 41 of the 5,018 cinematic prompts (1%)"

41 是本页计数，5,018 是 tag 总数 —— 两个口径混用。更糟的是**排名也错了**：
D1 实测该 tag 真值是 seedance2 2854 / seedance25 1074 / kling3 326，
即 top model 是 seedance2(57%)，不是 seedance25(1%)。

**现成的全量数据源（都已存在，零新增 D1）**：

| 维度 | 数据源 | 状态 |
|---|---|---|
| model → tag 分布 | `_cache/model-tags.json`（`listModelTagDistribution`） | ✅ 早已存在，全量 |
| tag → model 分布 | `_cache/tag-stats/{slug}.json` | ✅ 2026-10-22 新增 |
| tag → 共现 tag | 同上 | ✅ 同上 |
| tag → 标题词频 | 同上 | ✅ 同上 |
| model → 共现 model | `_cache/model-comodels.json` | ✅ 新增（实测全站只有 1 条多模型 prompt，基本为空） |
| 全站 model 计数/排名 | `_cache/counts.json` | ✅ 早已存在 |

**新增聚合的生成时机**：`rebuildAllAggregateCaches()`（publish/unpublish/delete 都会调）
→ 数据自动保持新鲜，不需要额外的手工步骤。
重建时 +3 次全表聚合查询（一次性），运行时只读 R2 → **运行时 D1 查询数不增加**。

**兜底行为**（关键）：聚合文件缺失时（还没跑过 rebuild），
`listTagStats` 退化为「只算当前 tag」的实时查询 —— 仍是真值，只是慢一点，
并顺手写回 R2，下次就是纯缓存读。实时查询也失败 → 返回 null，
内容生成函数据此**整段省略**对应句子/问答，**绝不编数字**。

⚠️ 写文案前先核实事实。已修掉的失真表述：
- "including the negative prompt and the generation settings" ——
  站内**没有 negative_prompt 字段**（`grep -rn "negative" src/db/ data/` 无命中）
- "so what you paste is always the full version" ——
  `/api/prompt/[slug]` 网络失败会降级成摘要，不是"总是全文"

## Next.js 版本支持窗口（2026-10-22 踩坑，时间炸弹）

OpenNext 在 `build:cf` 时会检查 Next.js major 是否还在官方支持窗口内，**不在就直接 `exit(1)`**，
pipeline 整个失败，**线上继续跑上一次部署的旧 worker**（看起来像"改了没生效"）。

窗口规则 = **major 首次发布起 2 年**（源码：`@opennextjs/aws/dist/build/helper.js` 的 `NEXT_RELEASE_DATES`）：

| Next major | 首发 | 支持到期 | 状态 |
|---|---|---|---|
| 15 | 2024-10-21 | **2026-10-21** | ⚠️ **已过期**（本站当前 15.5.19） |
| 16 | 2025-10-21 | 2027-10-21 | ✅ 支持中 |

**致命细节：判定只看 major 的首次发布日期，不看 patch 版本** → 换任何一个 15.x patch 都救不了。

2026-10-22 的实际故障（`2e340c6` 与 `9ea5a8f` 两个 push 的 pipeline 全挂）：

```
ERROR Next.js version 15.5.19 is not supported by the Next.js team.
If you want to proceed anyway, use the --dangerouslyUseUnsupportedNextVersion flag.
```

**已采用方案**：`package.json` 的 `build:cf` 加 `--dangerouslyUseUnsupportedNextVersion`
（commit `a8dabf1`）。⚠️ 代价：**Next 15 从 2026-10-21 起不再有官方安全补丁**，
升级 Next 16 应进 backlog（独立大工程）。

**下次 pipeline 挂了先查这个**：如果失败在 `build:cf` 步骤且日志出现
`is not supported by the Next.js team` → 是版本窗口问题，**不是代码问题**。


## Cache-Control Wrapper（必须装）

`open-next.config.ts` 注释明说：Next.js 15 page handler 在 `sendRenderResult` 阶段会**重置** `Cache-Control` 到 `no-store`，**覆盖 middleware 的 `s-maxage=3600`**。修法是自定义 OpenNext wrapper：

- 源文件：`wrappers/cache-control-cloudflare-node.js`
- 装到：`node_modules/@opennextjs/aws/dist/overrides/wrappers/cloudflare-node.js`
- 装脚本：`scripts/copy-wrapper.mjs`（由 `prebuild:cf` 触发）

**检查命令**：
```bash
grep "cloudflare-cdn-cache-control" node_modules/@opennextjs/aws/dist/overrides/wrappers/cloudflare-node.js
# 没结果 = wrapper 没装，CDN 边缘缓存不会生效，每次请求都打 worker
```

⚠️ **不要 grep `s-maxage=3600`**（2026-10-06 更正）：2026-09-08 C1 重写后边缘 TTL 已改用
`cloudflare-cdn-cache-control` + `max-age`（CF 文档明确 `s-maxage` 会禁用
stale-while-revalidate），wrapper 里不再有 `s-maxage` 字样。沿用旧 grep 会永远返回空，
导致误判"wrapper 没装"并重复排查。

## Namespace Version Cache TTL（必读 + 关键坑）

`src/db/cache.ts` 的 `getNamespacedCachedData` / `bumpNamespaceVersion` 用 namespace version stamp 做"全表数据变化时整批失效"。

**核心铁律**：

- **namespace version 自身 TTL 必须 24h+**（不是默认 5min）
- **namespaced entry TTL 也必须 24h+**（不是默认 5min）
- 失效**完全靠 publish/unpublish/delete 调 `bumpNamespaceVersion`** 让 version+1 → 旧 key 不可达

**为什么不能用 5min 默认 TTL**：

1. **namespace version 5min 过期 → fetcher 返回 1 → 旧 v=1 entry 又"复活"读到 publish 前的旧数据**
   - bump 时 version=2 写入，5min 后过期被 fetcher 写回 v=1
   - v=1 旧 entry（publish 之前的 stale 数据）仍然在 cache 中（24h 还在）
   - 后续读拿到 v=1 → 命中 stale entry → 数据不一致

2. **entry 5min TTL < ISR 1h 周期 → 每次 refresh 都 miss**
   - middleware s-maxage=3600 → ISR refresh 1h 一次
   - 5min TTL 远短于 1h → 每次 refresh 都要重新调 D1 → cache 形同虚设

**正确配置**（在 `src/db/cache.ts`）：

```ts
const NAMESPACE_L1_TTL_MS = 24 * 60 * 60 * 1000;  // 24h
const NAMESPACE_L2_TTL_S  = 24 * 60 * 60;          // 24h
// 写入时显式传这两个 TTL，不要用默认
```

**添加新 namespace 缓存类型时的检查清单**：
1. ✅ 写 entry 时显式传 `l2TtlS = 24*60*60` + `l1TtlMs = 24*60*60*1000`
2. ✅ publish/unpublish/delete 路由都调 `bumpNamespaceVersion('yourNs')`
3. ✅ 写完跑 `wrangler d1 insights` 看对应 query 的 `numberOfTimesRun` 是否停止增长

**踩坑实录（2026-08-17）**：fix 用 5min 默认 TTL 部署后，Q1 rate 仍 71K/小时（fix 无效），改为 24h 后降到 432/小时（164x 改善）。累计数字看起来"还在涨"是误导，要看「单位时间增量」。

## 关键架构备忘

- **D1 + R2 + Cloudflare Workers**（via OpenNext）
- **缓存层**（已有）：L1 内存 + L2 Cache API + R2 聚合缓存（tags.json / models.json / counts.json 等）
- **D1 cost 控制**（2026-10-22 实测更正）：~~详情页相关/上下篇查询是 99% D1 rows read 来源~~ —— **不成立**。
  实测（`wrangler d1 insights`，Oct 8–17，10 天窗口）top-20 查询里：
  - **68.2%** 来自**列表页 tag 过滤查询**（`prompts ⋈ prompt_tags ⋈ tags WHERE tags.name=? ORDER BY prompt_date DESC LIMIT ?`）
  - 11.1% 来自 model 过滤列表页，9.8% 来自两个 hydration 查询 → **列表页合计约 89%**
  - 详情页 slug 查询 avgRows = **0**，合计仅占总量 **0.085%**；相关/上下篇查询在 top-20 中**完全没出现**
  → **下次做 D1 优化要先打列表页的 tag/model 过滤查询，不是详情页相关/上下篇**
  （背景：related/adjacent 已改走 publish 时预计算的 R2 map，见 `getRelatedPromptsFromMap`）
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
（需要 `CLOUDFLARE_API_TOKEN`，用 `set -a && . ./.dev.vars && set +a` 加载）

## Workers Cache 与 CPU 成本（2026-10-15/22 两次实测）

**Workers Paid 计划**：$5/月 + CPU 超额 $0.02/M ms。**CPU 是唯一计费项**
（请求 10M/月、D1 rows read 25B/月、R2、Logs 全部 $0）。

| 指标 | 2026-09-08 旧结论 | 2026-10-18 实测 | 2026-10-22 实测 |
|---|---|---|---|
| CPU | 181M ms/月（**低估约 24%**） | 上周期 **224.56M ms**；本周期前 10 天 137.27M | 日均 12–16M ms，单请求 72 → **~93 ms** |
| D1 rows read | 1.03B/月 | 1.77B（10 天） | — |
| 请求数 | 2.76M/月 | 1.83M（10 天） | 137,656/天（10-21） |

**计费口径要点**（官方）：
- **缓存命中（HIT）→ Worker 完全不执行，CPU 计费为零**（只算标准请求费）
- MISS / BYPASS → 正常计 request + CPU
- **静态资源请求免费且无限**（"Requests to static assets are free and unlimited."）
  → 旧注释担心的"开缓存会让静态资源变计费"**不成立**

**开缓存后实测效果**（`cf-cache-status` 验证）：

| 请求类型 | `cf-cache-status` | 效果 |
|---|---|---|
| HTML 文档请求 | **HIT** | ✅ Worker 不执行 |
| **RSC 请求**（`RSC: 1`） | **BYPASS** | ❌ **每次都回源执行** |

**⚠️ 铁律：RSC 请求永远不会被缓存**。原因：Next.js 发的
`Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch`
里 `next-router-state-tree` 是整个路由状态树 JSON，每次导航都不同 → CF 保守策略直接 BYPASS。
实测三种 RSC 请求头组合（仅 RSC / +state-tree / +prefetch）**全部 BYPASS**。

**因此：`cf-cache-status: HIT` ≠ 这个页面不打 D1**。2026-10-15 优化后：
- TAG 列表页过滤查询：200,886 次/10天 → **7,217 次/2天（−82%）** ✅
- 详情页 slug 查询：1,499,985 次/10天 → **284,024 次/2天（−5%）** ❌
  → 详情页占全部 Worker 请求的 **77% 数量级**，是 CPU 主体

**次要根因**：`getPromptBySlugCached` 用 `getCachedData` 默认 **5 分钟** TTL
（`src/db/cache.ts` 的 `L1_TTL_MS`/`L2_TTL_S`）。站点 6,804 个 slug 是长尾流量，
每个 slug 访问一次 → 5 分钟 TTL 内不会再访问 → 缓存条目写进去就等过期，**命中率趋近 0**。
⚠️ 提 TTL 到 24h **必须同时**在 publish/unpublish/delete 调
`invalidateCache('prompt-by-slug-' + slug)`，否则已删 prompt 24h 内仍可访问（SEO 负面）。

**⚠️ 已知风险（开 Workers Cache 后必须监控）**：社区实测报道 RSC 载荷可能被存到
页面 URL 的缓存条目下 → 普通 HTML 请求取到 RSC 格式响应体 → 白屏。
本项目 2026-10-22 实测未观察到症状（HTML HIT 且内容正确），但需持续观察。

详细诊断见 `docs/CPU-DIAGNOSIS-2026-10-22.md`，成本基线见 `docs/CF-COST-BASELINE-2026-10-18.md`。

## models 字段铁律（2026-10-22 第九轮定规则）

`models` 是站点筛选维度，**猜错比不填更有害**。

- **正文明确写出模型名才登记**；正文没点名 → `[]`（留空）
- 正文只提**库外第三方平台**（Pollo / Flova / Dreamina / MVLAND / Wizstar / Tesseract / CLO / Frameo / Picsart / ImagineArt / Lovart / @fal）且无法证伪 → `[]`
- 纯代码 / 工具 / 行业新闻 → `[]`
- **平台 ≠ 模型**：`Made with MiniMax H3 on @Hailuo_AI` → `minimaxh3`（Hailuo 是承载平台）
- **对比帖取产出侧**：`FLUX 3 Max is 22x faster than Seedance 2.5` → `["flux3"]`，不登记被对比的一方
- 标题里**不能出现模型名**（含 `Kling 4.0` / `Seedance 2.5` / `Veo 3` 等）

**采集器根因（已修）**：`tools/x_timeline_collect.py` 的 `detect_model()` 旧版兜底 `return "seedance2"`，
导致**每一条没点名模型的稿子都被打上 Seedance 2.0**（第九轮实测 200 条里 62 条错标）。
现已改为：正文没点名 → 返回 `None` → 写入 `models: []`；并补齐 Kling 4.0 / PixVerse / FLUX 3 /
MiniMax H3 / Gemini Omni / Veo 3 等关键词 + 作者错拼（`Seadance` / `Seednace` / `seedenc`）。

## 收录内容定性闸门（2026-10-22 用户定规则）

站点是「AI 视频提示词」库。**主体不是「AI 生成的视频/图像作品或提示词」的推文一律不收录。**

**绝对不收**（五类）：
1. **编程 / 游戏开发过程** — Claude Code / Cursor / OpenCode 写代码、Three.js / Unity / Unreal / Blender / Godot 做 3D 或游戏、shader / voxel / webgl、MCP server、game dev、开源项目发布
2. **纯代码渲染 benchmark** — LLM 写代码渲染 3D 场景比跑分（"MiniMax vs DeepSeek 造火山"、"xx k tokens"、"$0.xx"）
   - 区分点：**产出是 AI 视频/图像** → 留；**产出是代码渲染的 3D** → 删
3. **行业新闻 / 八卦 / 公告** — 融资、发布会、大会、主题演讲、CEO 言论、榜单排名
4. **工具 / 软件 / 素材促销** — 订阅折扣、coupon、sign up 送 credits、素材包、插件
5. **真人内容 / 纯日常动态** — 真人拍摄（未过 AI 视频模型）、真人八卦、GM everyone 类寒暄

**要留**：产出是 AI 视频/AI 图像的作品（含模型对比、官方发布稿、镜头拆解）；图生视频/视频编辑工具的实拍演示；正文含完整提示词的帖子。

### 两层闸门
| 层 | 位置 | 作用 |
|---|---|---|
| 代码粗筛 | `tools/x_timeline_collect.py` → `looks_like_non_ai_content()` | 命中就**根本不下载**。12 类规则，命中会在 cron.log 打 `skip 非AI视频内容 [规则] <id>` |
| 人工判断 | cron `x-timeline-collect-2h` 的 prompt | **主闸门**。每轮新收录的草稿都要逐条读正文判断去留 |

**代码层必须保守**：拦掉的条目没人能补救（用户看不到、没法申诉），所以宁可漏过交给人工，也不可误杀。
实测（99 条历史垃圾 vs 896 条现有草稿）：拦截 35%，真误伤 1 条。
调规则时用「正样本=已判定垃圾的推文，负样本=库里现有草稿」回测，别凭感觉加词——
踩过的坑：`blender` 会撞厨房搅拌机、`Unreal Engine` 是提示词里的**风格引用**、`godot` 是 `#godot` 话题标签、
`gameplay`/`game engine` 会误伤「GTA 风格」「open-world game sequence」这类**合法** AI 视频提示词。

### 删除不持久 → 永久跳过名单（重要）
采集器只按**线上 D1** 去重，不知道你本地删过草稿 → 删掉的条目会被重新下载、连 title/tags 都被重置
（踩坑：删掉的 Claude Code 螃蟹游戏第二天又回来了，标题被打回 `Video Prompt Snapshot`）。

**所以删草稿时必须**：
1. `mavis-trash` 删草稿 + 素材（**不要** `rm`）
2. 素材目录用草稿的 `image` 字段推导：`static/_drafts` + `os.path.dirname(image)`
   ——**不要**对草稿路径做 `dirname().replace()`（会得到月份目录，曾把整个月素材删光）
3. tweet id 追加进 `tools/x_timeline_collect.skip.json` 的 `ids`（永久、永不过期）

跳过名单由 `tools/x_timeline_collect.py` 的 `load_skip_ids()` 读取，`pick_candidates` 里过滤。
验证：`python3 tools/x_timeline_collect.py dryrun` 看 `skip_list_size` 和候选里有没有命中名单的。
