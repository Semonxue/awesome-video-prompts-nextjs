# md-editor 发布慢：定位与优化（2026-11-17）

> 现象：在 md-editor 点「📤 发布」，一条要等 1 分钟以上；批量发 30 条要等半小时。
> 结论：**不是网络、不是上传，是每发布一条都在 Worker 里把全站聚合缓存从零重算一遍**。
> 其中 `related-map` 的候选池算法是 O(n²)，单条发布吃掉 16 秒 CPU（实测线上 19–30s CPU / 47–61s 墙钟）。

---

## 1. 现场测量（wrangler tail 抓的线上真实请求）

```
[admin/publish] create slug=...-vintage-train-carriage-night  elapsed=47962ms   (cpuTime 19400ms)
[admin/publish] create slug=...-old-camera-found-memory       elapsed=57856ms   (cpuTime 26788ms)
[admin/publish] create slug=...-humanity-evolution-spear      elapsed=57394ms   (cpuTime 28405ms)
[admin/publish] create slug=...-kitten-vlog-chooses-violence  elapsed=58400ms   (cpuTime 28764ms)
[admin/publish] create slug=...-tiktok-beat-dance-locked      elapsed=60106ms   (cpuTime 29741ms)
[admin/publish] create slug=...-flower-fairy-garden-race      elapsed=46593ms   (cpuTime 19529ms)
[admin/publish] create slug=...-couple-flirty-reversal-comedy elapsed=60998ms   (cpuTime 29812ms)
[admin/publish] create slug=...-magical-forest-fantasy-short  elapsed=58563ms   (cpuTime 27967ms)
[admin/publish] create slug=...-apocalypse-express-train      elapsed=58650ms   (cpuTime 29784ms)
[admin/publish] create slug=...-hollywood-bts-megalodon       elapsed=46562ms   (cpuTime 19586ms)
```

- 单条 **47–61 秒**，其中 **CPU 19–30 秒**（Workers 上限 30s，已经贴着墙）。
- md-editor 本地 `published_at` 间隔实测 53–109 秒/条 —— 和上面完全对得上，**本地不是瓶颈**。
- 本地文件系统扫描实测：690 个草稿全量 rglob + JSON 解析 = **26ms**，`/api/files` 轮询每 2 秒一次，可忽略。
- 上传占多少？用 1.2MB 打 publish 端点（401/400 提前返回、不落库）实测：**3.6–6.5 秒**（家用宽带经代理 184–331 KB/s）。
  → 47s 里有约 5s 是上传，**约 40s 是 Worker 里的计算 + 全站聚合重建**。

### 每次 publish 的固定成本链

| 顺序 | 动作 | 代价 |
|---|---|---|
| 1 | 解析 multipart（1MB 视频）| ~5s（网络） |
| 2 | R2 put + head 二次校验 × 2 | ~0.2s |
| 3 | D1 upsert + 关联（旧实现 2×N 次往返）| ~0.3–0.6s |
| 4 | `syncAllDicts`（models.yaml + tags.yaml 校准）| ~0.1s |
| 5 | **`rebuildAllAggregateCaches()`** | **≈35–50s ← 问题在这** |
| 6 | revalidate 12 条路径 | ~0.2s |

---

## 2. 根因分解（第 5 步里到底在算什么）

### 2.1 ★ `related-map` 是 O(n²)，单次 15.9s CPU

`src/db/queries.ts` 旧实现：每个 prompt 先把「共享任一 tag/model 的全部 prompt」塞进 Set，再 `Array.from(set).sort(by rank)` 取前 100 打分。

线上真实数据（本次实测）：

```
prompts 8,091   prompt_tags 33,290   prompt_models 7,959   tags 376   models 32
cinematic 一个 tag 就覆盖 5,512 / 8,091 条 prompt（68%）
→ 平均每个 prompt 的候选集 5,783 个
```

复现（把线上 8,092 条数据导出，原算法逐字重跑）：

```
OLD: 15897 ms, slugs=8092, 候选累计=46,795,568 (5783/prompt)
NEW:   438 ms, slugs=8092      ← 改完后
```

**8,092 次「对 5,000+ 元素排序」+ 4,679 万次 Set 插入**，就是那 16 秒 CPU。
而且它每次发布都从零重算 —— 明明一条发布只影响这一个 prompt。

### 2.2 `model-tags.json` 按 model 逐条查（32 次串行全表聚合）

```ts
for (const m of models) modelTags[m.slug] = await queryModelTagDistribution(m.slug);
```

32 个 model × 每次 4 表 JOIN + GROUP BY（扫 8k prompts / 33k prompt_tags）≈ **10–15s 墙钟**（估算，未单独计时；改后合并成 1 次查询），
而这些数据一条 `GROUP BY tag, model` 就能一次拿全（而且下面 `assembleTagStats` 还要用同一份）。

### 2.3 `tag-stats` 每次无条件重写 376 个 R2 对象

`_cache/tag-stats/<slug>.json` 共 376 个文件，旧实现每次发布全量 PUT（分 20 批）。
实测一次发布通常只影响 1–4 个 tag，其余 372 个文件内容完全没变，白写。

### 2.4 批量发布把固定成本乘了 N 倍

md-editor 的 worker 是**串行**消费，且**每条** publish 都触发一次全站重建：

```
30 条 × 60s = 30 分钟
```

`QUEUE_DELAY_SECONDS=60` 只是"攒批"的延迟，不是主因；主因是"每批里每一条都重建全站"。

### 2.5 顺手发现的两个 bug

1. **`/api/admin/rebuild-agregates` 在生产一直 401**
   `getSecret('ADMIN_SECRET', 'ADMIN_SCRET')` —— 名字写错（还打错字），线上 secret 是 kebab-case 的
   `admin-secret`。也就是说「手动重建聚合缓存」这条后路是断的，出问题时没法自救。
2. **重新发布时每次都重传 cover+video**，哪怕媒体根本没变（1MB ≈ 4–6s 纯浪费）。

---

## 3. 已实施改动

| # | 文件 | 改动 | 收益 |
|---|---|---|---|
| 1 | `src/db/queries.ts` | `computeRelatedMap` 的候选池改为 **k 路有序归并**（`buildRelatedMap` 纯函数）。allPrompts 本身是 rank 序，所以每个 tag 的成员列表天然有序，只需归并取最新 100 个 | **15.9s → 0.44s CPU（−97%）**，输出与旧实现**逐字一致**（8,092 个 slug 全对比，0 差异） |
| 2 | `src/db/queries.ts` | `model-tags.json` 改由**一次** `GROUP BY tag, model` 生成；同一份行数据复用给 tag-stats | 去掉 32 次串行全表聚合 ≈ **−10~15s 墙钟** |
| 3 | `src/db/queries.ts` + `aggregate-cache.ts` | tag-stats 用**内容指纹 manifest** 判断，只重写变化的 tag 文件 | 376 次 R2 PUT → 个位数 |
| 4 | `src/app/api/admin/publish/route.ts` | 新增 `rebuild=0` 参数：批量发布时**只写 D1 + R2 媒体**，聚合缓存留给批次结束后统一重建；同时写 `_cache/rebuild-dirty.json` 脏标记（批次客户端挂了也能发现） | 批量 N 条只做 **1 次**重建 |
| 5 | 同上 | `revalidate` 分批：`rebuild=0` 时只刷本详情页三语言，索引页交给批次结束后的重建 | 每条少 9 次 revalidate |
| 6 | 同上 | 关联写入改 **D1 batch**（2 条 DELETE + N 条 INSERT 一次往返）；tag/model upsert 改 `INSERT OR IGNORE ... VALUES (...),(...)` + 一次 `IN` 查询；删掉占位查询 | 每条 15+ 次串行 D1 → 4 次 |
| 7 | 同上 | 响应/日志带 `timings`（auth/parse/upload/d1/assoc/dict/rebuild/revalidate/cache/total），日志加 `rebuildDeferred` | 下次慢了一眼定位到阶段 |
| 8 | `src/app/api/admin/rebuild-aggregates/route.ts` | 修 secret 名（`admin-secret` / `ADMIN_SECRET` / `ADMIN_SECRET_DEV`）；重建后清脏标记；返回 `hadDirtyMarker`、`durationMs` | 手动重建后路恢复可用 |
| 9 | `tools/md-editor/server.py` | 批次内 `publish_one(..., rebuild=False)`；**整批消费完统一调一次** `/api/admin/rebuild-aggregates`，结果写日志 + `/api/queue` 的 `last_rebuild` | 30 条：30 分钟 → 约 1.5 分钟 |
| 10 | 同上 | 媒体「自上次成功发布后未改动（mtime ≤ `media_published_at`）」就跳过重传；新增 `media_published_at` 字段（入队不会清它） | 重新发布省 0.9–5s/条（实测 upload 970ms → 24ms） |
| 11 | 同上 | 每条打印 `OK <path> (Nms)`；`start-md-editor.sh` 加 `PYTHONUNBUFFERED=1` | 重定向到日志文件时也能实时看到进度（之前 print 被块缓冲，看不到） |

新增环境变量（都可选，有默认值）：

```bash
# .dev.vars
NEW_SITE_REBUILD_URL=https://<site>/api/admin/rebuild-aggregates   # 默认由 PUBLISH_URL 推导
MD_EDITOR_DEFER_REBUILD=1    # 0 = 退回"每条发布都重建"的旧行为
```

---

## 4. 效果（改后**线上实测**，2026-11-17 14:33）

上线后实测（`wrangler tail` 抓的 `wallTime` / `cpuTime`）：

| 请求 | 改前 | 改后（实测） |
|---|---|---|
| `POST /api/admin/publish`（批量模式 `rebuild=0`，含重传媒体） | 47–61s / **CPU 19–30s** | **2.0s / CPU 61ms** |
| 同上，媒体未变（跳过重传） | — | **1.09s / CPU 35ms** |
| `POST /api/admin/rebuild-aggregates`（稳态） | 不存在（旧路径内联） | **4.5–5.0s / CPU 0.9–1.1s** |
| 同上，manifest **首跑**（要写 343 个 tag 文件） | — | 25.4s |
| 单条发布（`rebuild=1` 强一致） | 47–61s | **约 6s** |
| 批量 30 条 | 25–30 分钟 | **约 1 分钟**（30×~1.5s + 一次 ~5s 重建） |

分阶段 `timings`（媒体未变那次，单位 ms）：

```json
{"auth":0,"parse":0,"upload":24,"d1":460,"assoc":232,"rebuild":333,"revalidate":0,"cache":16,"total":1065}
```

- `upload=24ms`：媒体没变，没有再传 1MB —— 对比重传那次 `upload=970ms`
- `rebuild=333ms`：这是写"待重建"脏标记 + 不重建的耗时；真正的重建在批次结束后一次
- 剩下的大头是 `d1=460ms`（行 upsert + 关联 batch）和 `assoc=232ms`

> ⚠️ 首版 commit 信息里写的「50s→10s」当时只测了 related-map 一段，属于**乐观误标**；
> 真实口径以上表为准（最终确实到了 1–2s/条 + 每批一次 5s 重建）。

### 4.1 期间又抓到一个 bug：媒体"跳过重传"一度完全失效

第一版实现靠 `published_at` 判断媒体有没有变，结果实测每条都在重传。原因：

```python
# set_publish_queued_in_fm（入队时调用）
out["published"] = False
out["published_at"] = None      # ← 把"上次发布时刻"擦了
```

也就是说 **worker 读到的草稿永远是"从没发布过"**，判断必然为 False。
修法：成功发布时另存一份 `media_published_at`，队列化**不清**这个字段，
媒体判断只看它（回退 `published_at`）。

## 5. 验证

已跑：

```bash
npx tsc --noEmit                 # 通过
npm test                         # 191 tests / 14 files 全绿（新增 src/db/related-map.test.ts 5 条）
```

**输出一致性**（关键，不能改变站内链接）：把线上 8,092 条真实数据（prompts / prompt_tags / prompt_models / tags / models）
导出后，旧算法输出与新 `buildRelatedMap()` 输出**逐条对比 → 0 处差异**。
临时对比用例只用于本次验证，跑完已删除（仓库不留一次性脚本）。

md-editor 侧：用 `/tmp` 里的临时草稿树 + 打桩的 `http_multipart_post` 验证了三件事
（媒体未变 → 不发文件；视频被改动 → 重传；`rebuild` 参数按预期 0/1）。

上线后又用一条**已发布**的草稿做了 3 次端到端复跑（幂等，只改 `updated_at`）：

```
第 1 次：媒体重传   wall=2008ms cpu=61ms  uploaded={"cover":true,"video":true}
第 2 次：媒体未变   wall=1088ms cpu=35ms  uploaded={"cover":false,"video":false}
随后批次重建        wall=5019ms cpu≈1.1s
```

上线后怎么复核：

```bash
# 1) 单条发布后的分阶段耗时（应该看到 rebuild 从 ~40s 降到个位数）
npx wrangler tail awesome-video-prompts-nextjs --format json | grep admin/publish
# 2) 手动重建（现在能过鉴权了）
curl -X POST https://<site>/api/admin/rebuild-aggregates -H "Authorization: Bearer $ADMIN_SECRET"
```

---

## 6. 上线步骤

**走 GitHub Actions，不要在本地 `wrangler deploy`：**

```bash
git commit ... && git push origin main   # push 即触发 .github/workflows/deploy-cloudflare.yml
gh run watch                             # 约 2 分钟；completed success 即部署完成
```

（`npm run deploy` 只是应急后路，正常不用。）

本地 md-editor 需要**重启**才生效（新代码才会传 `rebuild=0`）：

```bash
./tools/start-md-editor.sh
```

⚠️ 重启 md-editor 会中断当前批次的队列消费（重启后 worker 会做 crash recovery 并把队列里
还带 `publish_queued_at` 的草稿继续发完，不再等 60s 延迟）。

---

## 7. 还没做（下一步可选）

1. **把重建彻底移出请求路径**（下一步最该做的）：publish 立即返回 + `waitUntil` 自触发
   （或 Cloudflare Queues）去重后重建。现在单条仍有 25s 花在重建的 D1 聚合 + R2 写上，
   搬出去之后单条可以到 3–5s。
2. **related-map 增量更新**：现在 0.44s 已够快，暂不需要；等 prompt 数翻倍再考虑
   （O(n) 归并是线性的，届时约 1s）。
3. **CPU 上限监控**：旧实现已经出现单请求 29.8s CPU（上限 30s），说明"发布即全站重算"
   这条路本来就快撞墙了。建议在 CF 上给 `admin/publish` 的 `exceededCpu` 加个告警。
4. `tools/md-editor/README.md` 仍然是旧流程文档（P2-2.7，一直没重写）。
