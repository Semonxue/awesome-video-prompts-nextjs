# md-editor 对比审查与优化计划

> 日期：2026-07-24
> 范围：`awesome-video-prompts-nextjs`（数据库版）vs `awesome-video-prompts`（Hugo 原版），重点对比 md-editor 从"管理 md 文件"到"管理数据（D1/R2）"的功能差异。
> 状态：已与 owner 对齐，含两条决策记录（见 §5）。

---

## 1. 架构变迁总览

**原版（Hugo）**：md 文件是唯一数据源。md-editor 直接操作文件系统——保存时按 `draft: true/false` 在 `content/_drafts/` ↔ `content/prompts/` 之间搬移 md + 素材目录（带事务回滚），用 `git status` 标注文件状态，git 仓库即版本历史，Hugo 构建即发布。

**新版（Next.js + D1 + R2）**：D1 是唯一数据源。md-editor 是"本地草稿暂存 + 发布客户端"——md 永远留在 `content/_drafts/`，front matter 记录发布状态（`published` / `published_at` / `published_slug` / `published_error` / `publish_queued_at`），发布后走内存队列 + 单 worker 线程 multipart POST 到 `/api/admin/publish`（D1 upsert + R2 上传 + revalidate），支持崩溃恢复、load-online（线上拉回草稿）、删除线上、二次校验清理。

**结论**：队列 + front matter 状态记账的方案比原版搬文件更适合 DB 流程，整体改造方向正确、完成度高。剩余差距集中在：R2 媒体 key 耦合、tag 多语言/描述回退、下架能力缺失、数据无备份、taxonomy 无校验，以及一批工程债。

---

## 2. 差异清单（按严重度）

### P0 — 数据正确性

| # | 问题 | 现状 |
|---|------|------|
| 2.1 | **R2 key 与 post_date 强耦合产生孤儿对象** | publish 用 `deriveYearMonth(post_date)` 拼 R2 key（`prompts/<YYYY-MM>/<slug>/`）。编辑 post_date 后重新上传媒体 → 写到新路径，旧 R2 对象孤儿化；`/api/admin/delete` 也按当前 prompt_date 推 key → 删不掉旧对象，永久泄漏。fm 缺 post_date 时 fallback 到当前月，同样踩坑 |
| 2.2 | **load-online 后媒体预览坏** | `handle_load_online` 把 `image/video` 写成 R2 完整 URL（`https://static...`），前端 `updateMedia()` 无脑拼 `/media/` 前缀 → 404；服务端 `handle_media` 只查本地 `static/_drafts/`。server.py 注释声称"媒体代理能直接拉 R2"但代码未实现 |

### P1 — 相比原版的能力回退

| # | 问题 | 现状 |
|---|------|------|
| 2.3 | **tag 多语言名与描述大面积丢失（SEO 回退）** | 原版从 `data/tags.yaml`（227 个 tag，含 en/zh-cn 名 + 描述）渲染 tag 页。新版 `TagDisplay.tsx` 硬编码仅 10 个 tag 翻译，其余 217 个显示原始 slug；tag 详情页无描述文本。D1 `tags` 表只有 `name` 一列。文件头注释承诺"Phase 2 从 D1 加载完整字典"但未实装 |
| 2.4 | **"下架"（unpublish）能力丢失** | 原版 `draft: false→true` 搬回 `_drafts/` 即下架。新版 schema 有 `is_draft` 字段、查询过滤 `is_draft=0`，但 publish 永远写 0，没有任何 API 能置回草稿——想下线只能整条删除（D1+R2） |
| 2.5 | **数据无版本历史/备份** | 原版 git 仓库是真相源，有历史、diff、回滚。新版 `content/_drafts` 在 .gitignore 里，清理后本地 md 删除，D1 成为唯一副本：无快照、无导出、无审计。误删（删除线上支持批量）不可恢复 |
| 2.6 | **tags/models 无 taxonomy 校验** | 原版 yaml 是唯一词表，Hugo 构建即校验。新版 publish 对 tags/models `INSERT OR IGNORE` 无脑入库——编辑器 tag 打错字会永久留在 D1 并出现在网站 tag 索引页；`models.name` 直接等于 slug。`data/tags.yaml` / `models.yaml` 只喂编辑器 UI，与 D1 实际词表会越走越偏 |

### P2 — 工程债与体验

| # | 问题 | 现状 |
|---|------|------|
| 2.7 | **README.md 严重过时** | `tools/md-editor/README.md` 还在描述"draft:false 搬文件 + git commit"的旧流程 |
| 2.8 | **遗留死文件** | `update_features.py / update_list_files.py / update_regex.py / update_server.py / update_templates.py` 5 个一次性迁移脚本、`test_put.json`、空的 `src/app/api/admin/debug-env/` 目录、`server.py` 未使用的 `TEMP_DIR`、`publish/route.ts` 里 `upsertTags` 的占位查询（注释"占位"） |
| 2.9 | **轮询性能** | 前端每 2s 轮询 `/api/queue` + 刷新 `/api/files`，两个 handler 都全量 rglob + 逐个 read_text + YAML parse（179 个文件 × 每 2 秒） |
| 2.10 | **列表无搜索/过滤** | 179+ 草稿只能滚动查找 |
| 2.11 | **发布无自动重试** | 瞬时网络错误直接落 `failed`，需手动重新入队 |

### 已知并接受（不处理）

| # | 事项 | 决策 |
|---|------|------|
| 2.12 | 73/179 草稿 front matter 用单数 `model:`（非 `models:` 数组），publish 只读复数字段 | **历史问题，不处理**——实际取用模型只用 1 个；编辑器保存时会归一化为 `models: [x]`（决策 D1） |
| 2.13 | 草稿生产依赖 dl-x-videos + LLM 流程，编辑器无"新建草稿"入口 | **维持现状**——继续用 dl-x-videos 驱动 LLM 下载草稿，约 20% 人工干预和决策是必要的，不做全自动化（决策 D2） |
| 2.14 | `/api/admin/publish` 的 `resetAssociations` 在只传 tags（不传 models）时会清空 models 关联（PATCH 语义不严格） | 随 D1 决策一并接受现状——md-editor 正常路径下 tags/models 都会提供；如未来开放其他发布客户端再修 |

---

## 3. 优化计划（修订版，按批次）

### 第一批：数据正确性 hotfix（约半天）

- [x] **3.1 修媒体预览（P0-2.2）**：前端 `updateMedia()` 识别 `http(s)://` 绝对 URL 直接渲染（不走 `/media/` 前缀）；同时修正 server.py 里"代理能拉 R2"的误导性注释 ✅ 2026-07-24（另：`saveForm()` 保留 load-online 的 R2 绝对 URL，避免保存后预览回退 404）
- [x] **3.2 R2 key 去耦（P0-2.1）**：publish 时 slug 已存在且未提供新媒体 → 沿用 D1 既有 cover_url/video_url 的路径，不用 post_date 重推；delete 时优先从 D1 的 cover_url/video_url 反解 R2 key ✅ 2026-07-24（共用工具 `src/lib/r2-keys.ts` + 10 条单测；publish 重传媒体也覆盖 URL 反解出的同一路径；delete 额外扫尾 post_date 旧路径清理历史孤儿）

### 第二批：可恢复性与下架能力（约 1 天）

- [x] **3.3 新增 `/api/admin/unpublish`**（`is_draft=1` + revalidate 三语言路径），md-editor 加"下架"按钮（P1-2.4，恢复原版能力） ✅ 2026-07-25（新路由 `src/app/api/admin/unpublish/route.ts`：幂等置 `is_draft=1` + revalidate 详情页三语言/首页/tags/models 索引，响应带 `changed` 区分"已下架/已是草稿"；md-editor server.py 新增 `/api/unpublish-online` 转发，前端加「📥 下架线上」批量模态框——逻辑下架不删 D1/R2，重新发布即恢复上架）
- [x] **3.4 发布前自动备份**（P1-2.5）：`/api/admin/publish` update 前把旧 row dump 到 R2 `backups/<slug>/<timestamp>.json`；文档补 `wrangler d1 export` 定期快照操作步骤（写进 DEPLOY.md） ✅ 2026-07-25（`backupBeforeUpdate()`：update 前 dump 旧 row + tags/models 关联到 R2 `backups/<slug>/<ISO-ts>.json`，best-effort 不阻断发布，响应带 `backup: {ok, key}`；DEPLOY.md 新增 §8「数据备份与恢复」——行级备份查看命令 + 每周 `wrangler d1 export` 全量快照 + 单条/整库恢复流程；⚠️ 备份只含 D1 数据，不含 R2 媒体字节）

### 第三批：taxonomy 与 SEO 补齐（约 1-2 天）

- [ ] **3.5 tags 表扩列**（P1-2.3）：`name_zh / name_ja / description_zh / description_en`，写迁移脚本从 `data/tags.yaml` 灌入 227 条；`TagDisplay` 改查 D1（落地 Phase 2 承诺）；tag 详情页渲染描述段落
- [ ] **3.6 publish 加 taxonomy 校验**（P1-2.6）：tags/models 不在词表时响应里带 warning 列表（不阻断），md-editor 发布结果展示；md-editor tags 输入改带自动补全的 chip 输入

### 第四批：编辑器工程债与体验（约 1 天）

- [ ] **3.7 重写 `tools/md-editor/README.md`** 为新流程；删除 5 个 `update_*.py`、`test_put.json`、空 `debug-env/`、`TEMP_DIR`、`upsertTags` 占位查询（P2-2.7/2.8）
- [ ] **3.8 `/api/files` + `count_fs_queued` 加 mtime 缓存**（P2-2.9）；前端轮询降频或改 SSE
- [ ] **3.9 文件列表加搜索框**（P2-2.10）；failed tab 支持批量重新入队（P2-2.11）

---

## 4. 验证方式

- 3.1/3.2 改完后：本地 `wrangler dev` + 本地 D1，对一个已发布 slug 走 load-online → 预览正常 → 改 post_date 重发 → 确认 R2 无新孤儿 key、delete 能删净
- 3.3：下架后首页/详情页 404（或列表消失），再上架恢复
- 3.5：tag 页三语言名称 + 描述渲染正常，Lighthouse SEO 不回退

---

## 5. 决策记录（2026-07-24 owner 确认）

- **D1：单数 `model:` 不处理。** 属历史问题，实际取用模型只用 1 个；编辑器保存时自动归一化为 `models: [x]` 数组。配套地，`/api/admin/publish` 关联重置的 PATCH 语义不严格问题（2.14）也接受现状。
- **D2：草稿生产不做全自动化。** 沿用 dl-x-videos 驱动 LLM 下载草稿的流程，保留约 20% 人工干预和决策环节；不为编辑器加"新建草稿"入口。
---

## 6. 2026-08-09 体验优化批次（A/B/C/D）

> owner 反馈的 4 项体验问题；前后端都已落地。

### A. 视频自动展示（待编辑即看到素材是否真的存在）

**改动**：`tools/md-editor/templates/index.html` 的 `updateMedia(fm)` 重写为不再用「点击播放」占位符，prompt 加载后立即创建 `<video>` 元素：

- `autoplay + muted + playsInline + loop=true`（静音自动播放，符合 chrome/safari 策略）
- `preload="metadata"`（仅拉 metadata，不下载整段）
- `poster` 用 `fm.image`（封面图先顶位，弱网也能看到缩略图）
- 鼠标 hover 时显示「🔇 静音自动播放中 · 点击开启声音」半透明 overlay
- 点击 `<video>` 切换 `muted`（即「点一下开启声音」）
- 失败回退：素材缺失 / 路径 404 / mp4 编码不被浏览器支持时，显示「⚠️ 视频未设置」/「加载失败」+ 提示路径，**不再有孤零零的「加载失败」**

**收益**：编辑打开 prompt 第一眼就能验证 cover.jpg + video.mp4 真的存在；不需要「点击 → 等待 → 才看到画面」的两段式交互。

### B. 主操作区紧凑化（少滚屏）

**改动**：表单布局由 4 行压成 2 行：

- 第 1 行：模型（原 radio chips → `<select>` 下拉，一行结束）+ 作者 / 来源链接
- 第 2 行：标签（保留逗号分隔）+ 发布日期（同一行）

**实现细节**：

- 模型用 `<select>` + 占位「— 无 —」选项；`selectedModel` 状态保留；`onchange` 直接更新；选择值写入 `fm.models = [selected]` 数组
- 标签 / 日期输入形式不变（按 owner 修正指示）；保留原 input 行为，节省一行高度
- 所有 input 加 `box-sizing: border-box`，与 panel 同步填满
- `tags-col` flex: 1 + `date-col` width: 130px：一长一短，留出合理比例

**收益**：以前必须滚屏才能填完日期；现在 1280×800 默认尺寸下 4 个字段全部在视口顶部，视频预览仍可同时看到。

### C. 发布前先保存

**改动**：`publishCurrent()` 流程改为「**先 doSave → 仅成功才入队**」：

1. `await doSave({ path, data, body })` ← 编辑改动先写盘
2. 看 `saveResult.ok` → false 直接 abort（toast 提示「保存失败，已中止发布」）
3. 通过 → `await fetch(/api/publish)` 入队

**UX 加强**：

- toast 阶段化：「💾 正在保存...」→「✅ "xxx" 已入队（本次批次共 N 个）」
- 失败时不再神秘地"看起来保存了但没发布"
- `doSave()` 返回 `{ ok, status, error }` 让 `publishCurrent()` 能决策；之前成功路径无返回值

**注意**：发布前已经是干净的 front matter，没有歧义（之前旧代码确实已经是「先保存再发布」，但失败时静默继续；本次加强错误反馈）。

### D. 1 分钟延迟发布队列 + 立即发布按钮

**改动**：

**D1 前端 — 队列面板**（`templates/index.html`）：

- 编辑区底部新增 `<div class="queue-panel" id="queuePanel">`：显示「N 个待发布 · 距下次发布 MM:SS」+「🚀 立即发布」按钮
- 倒计时每秒更新（视觉 1s 节流，不调接口）
- 队列里有任务时显示；队列为空时自动隐藏（不占位）
- 「立即发布」点 2 次确认（避免误操作），成功后 toast：「🚀 立即发布：N 个（剩余 M）」
- 调用 `/api/queue` 返回 `delay_seconds` / `earliest_publish_at` / `batch_size` / `fs_queued_count` 等
- 调用 `/api/publish` 返回 `batch_size` 让前端 toast 显示「本次批次共 N 个」
- `repubsubmitAllFailed` 流程文案内也同步说明「会进入 60s 延迟队列；可点编辑器底部立即发布跳过」

**D2 后端 — worker 延迟逻辑**（`tools/md-editor/server.py`）：

- 新增配置 `QUEUE_DELAY_SECONDS`（默认 60；可通过 `.dev.vars` 里 `MD_EDITOR_PUBLISH_DELAY_SECONDS=0` 关闭）
- 新增 `scanned_queued()`：扫 fs 返回 `{count, earliest_publish_at, batch_size}`
- 新增 `flush_queued_to_past()`：把所有 queued_at 改成 1970-01-01，唤醒 worker 立刻处理
- 重写 `worker_loop()`：从「event-driven」改为「1s 扫描 + event 唤醒」。每秒扫 fs：
  - 找 `earliest_publish_queued_at`
  - 把 `publish_queued_at + QUEUE_DELAY <= earliest + DELAY` 的入内存队列（即同批次）
  - 串行 `publish_one()` 调用
- **crash recovery 跳过延迟**：服务重启时凡扫到 `publish_queued_at` 的直接入队（因为重启就是要尽力恢复，不应该再等 60s）
- `/api/queue` 改返回 `delay_seconds` / `earliest_publish_at` / `now` 给前端做倒计时
- `/api/publish` 改返回 `delay_seconds` / `batch_size` / `earliest_publish_at`
- 新增 `/api/flush-queue` 路由（POST）；前端 `flushQueueNow()` 调用

**收益**：频繁发布多个草稿时 1 分钟内能攒成单批次，节省 N 次「单文件 POST」+ R2 上传。同时所有发布结果统一收口到 front matter，故障排查更简单。

---

## 7. 验证方式（2026-08-09 批次）

- A. 打开任意有 `video:` 字段的草稿 → 编辑区视频框立即自动开始播放（静音，但有首帧 + 实时画面）；点击 video 一次 → 出现声音控制；hover 显示提示；失败素材显示「⚠️ 视频未设置」红字
- B. 1280×800 浏览器窗口：标题、模型、标签、日期、作者 5 个字段 + 视频预览全在视口顶部，不再滚屏
- C. 编辑后未点保存直接点发布 → 状态：先「💾 正在保存」→ 然后「✅ 已入队」；故意把 path 改坏再点发布 → 弹 toast「保存失败，已中止发布」
- D. 5 秒内点 3 个草稿的「发布」→ 底部面板出现「3 个待发布 · 距下次发布 01:00 · 倒计时逐秒减少」；点「🚀 立即发布」→ toast 显示「3 个」，3 个草稿几乎同时变 published 状态
- D. `.dev.vars` 加 `MD_EDITOR_PUBLISH_DELAY_SECONDS=5`，重启服务 → 文件列表点发布后右下「下一批 00:05」

