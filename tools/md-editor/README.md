# Markdown 可视化编辑器

一个轻量的本地工具，用于可视化编辑视频提示词的 Markdown 文件，并预览关联的素材。

对接新流程（Next.js + D1 + R2）：草稿 MD 永远留在 `content/_drafts/prompts/`，
发布只更新 D1 + R2，不搬文件、不依赖 git。本地是「草稿 + 发布客户端」双重角色。

## 功能特点

- 📋 **三栏布局**：左侧文件列表 / 中间编辑区 / 右侧来源预览
- ✏️ **可视化编辑**：编辑 Front Matter 字段（紧凑布局：模型下拉 + 标签 + 日期 一行搞定）
- 👁 **实时预览**：Markdown 内容预览
- 🎬 **素材自动预览**：封面图 + **视频自动 embed**（autoplay+muted，自动开始播放；点击 video 切换声音）
- 🔗 **来源查看**：点击按钮在右侧 iframe 打开原链接
- 💾 **一键保存**：修改后保存到文件系统
- 🗂 **批量发布**：点多个草稿的「发布」后自动攒成同一批次，1 分钟延迟后由后台 worker 串行发布
  - 倒计时面板实时显示距离下次发布的剩余时间
  - 「🚀 立即发布」按钮可跳过延迟，立刻发当前批次

## 界面布局

```
┌──────────────┬──────────────────────────────┬──────────────┐
│  📁 待编辑   │  标题 / 模型(下拉) 标签 日期  │   来源页面   │
│   文件列表    │                              │   (iframe)   │
│              │  作者 / 来源链接              │              │
│              │  封面图 │ 自动视频            │              │
│              │  描述内容                     │              │
│              │  ─ 📋 队列: 3 个待发布, 00:45 ─│              │
│              │       [🚀 立即发布]            │              │
└──────────────┴──────────────────────────────┴──────────────┘
```

## 使用方法

### 1. 启动服务器

```bash
cd tools/md-editor
python server.py
```

默认端口 3000，如需更换端口：

```bash
python server.py 8080
```

### 2. 访问编辑器

打开浏览器访问：`http://localhost:3000`

### 3. 编辑流程

1. **点击左侧文件**：加载文件内容；视频会自动在编辑区嵌入（无需额外点击播放）
2. **编辑标题/模型/标签/日期/作者/来源**：紧凑布局，全部可见无须滚屏
3. **查看素材**：封面图 + 自动播放的视频（点击视频可开启声音）
4. **编辑描述**：输入完整提示词内容
5. **点击发布**：先保存当前编辑状态 → 进入延迟队列（默认 60 秒）
   - 这 60 秒内连续点击其他草稿的「发布」，会一起并入同一批次
   - 倒计时归零后，worker 自动开始串行发布，结果写到 front matter
   - 想立刻发？点底部「🚀 立即发布」跳过延迟
6. **失败保护**：如果保存过程失败，发布会中止并提示；publish error 写回 front matter

### 4. 队列机制详解

- **入库**：点「发布」 → `publish_queued_at` 写当前时间 + 文件入内存队列（前端立刻看到 ⏳ 角标）
- **批次**：同一时间窗口内（最近 60 秒）多次入队的视为同一批次
- **消费**：worker 每秒扫一次 fs，发现 `publish_queued_at + 60s` 已到期的就依次调用新站 `/api/admin/publish`
- **立即发布**：`/api/flush-queue` 把所有 queued_at 改成过去 → 唤醒 worker 立刻处理
- **崩溃恢复**：服务重启时扫 fs，凡带 `publish_queued_at` 的直接入队（直接处理，不再等 60 秒）

延迟可通过 `.dev.vars` 调整：
```
MD_EDITOR_PUBLISH_DELAY_SECONDS=10    # 默认 60；改 0 等于关闭批处理
```

### 5. 辅助操作

- **⬇️ 加载线上**：按 slug 把线上 D1 已有 prompt 拉回本地草稿（方便编辑已发布内容）
- **🧹 清理**：删除已发布的本地草稿（先校验 D1 是否真有）
- **❌ 删除线上**：批量删除线上的 prompt（D1 + R2 物理删除，不可恢复）
- **📥 下架线上**：批量逻辑下架（is_draft=1，可从草稿重新发布恢复）
- **🔁 批量重试**：一键把「失败」tab 里所有草稿重新入队

### 6. 提交到仓库

md-editor 不再与 git 自动交互。发布后的草稿可选择：

```bash
git add content/_drafts/prompts/2026-08/xxx.md
git commit -m "feat: 添加 xxx 提示词 (草稿快照)"
```

`content/_drafts/` 默认在 `.gitignore` 里（本地草稿不提交）；如要保留草稿历史可调整。

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/files` | 获取草稿列表（按待编辑/已发布/失败 分类） |
| GET | `/api/file?path=xxx` | 读取草稿内容 |
| PUT | `/api/file` | 保存草稿 |
| POST | `/api/publish` | 入队发布（返回 delay_seconds + batch_size + earliest_publish_at） |
| POST | `/api/flush-queue` | 跳过延迟立刻发布当前批次 |
| GET | `/api/queue` | 队列状态（fs_queued_count、earliest_publish_at、delay_seconds） |
| POST | `/api/cleanup` | 清理已发布草稿（二次校验 D1） |
| POST | `/api/load-online` | 从 D1 加载 prompt 到草稿 |
| POST | `/api/delete-online` | 批量删除线上 prompt |
| POST | `/api/unpublish-online` | 批量下架线上 prompt |
| GET | `/api/metadata?type=models` | 模型列表 |
| GET | `/api/metadata?type=tags` | 标签列表 |
| GET | `/api/health` | 健康检查 |

## 技术栈

- **后端**：Python 标准库 + `pyyaml`（零运行时依赖）
- **前端**：原生 HTML/CSS/JavaScript
- **媒体**：浏览器原生 `<video>` + autoplay+muted（无需引入第三方播放器）
- **布局**：flex 一行紧凑布局

## 故障排查

| 现象 | 可能原因 | 解决方案 |
|------|---------|---------|
| 视频只显示「点击播放」 | 旧版本 md-editor | 升级后视频自动展示（autoplay muted） |
| 倒计时不归零 | `MD_EDITOR_PUBLISH_DELAY_SECONDS` 设过大 | 改回 60（默认）或点「🚀 立即发布」 |
| 入队后一直不发布 | worker 异常 | 看终端日志；重启服务会自动 crash recovery |
| 发布后状态没刷新 | 浏览器缓存 / 轮询卡住 | 手动刷一下文件列表（🔄 按钮） |
