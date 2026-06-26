任务：将下载的 X 视频转换为站点草稿（适配 Next.js + D1 + R2 新流程）

### 输入上下文：
- 先使用 x 帖子地址判断是否已经重复存在（一定要全字段匹配）
- 使用 tools/dl-x-videos.py + x 帖子地址 下载视频及元数据，存储在 temp/<TWEET_ID>/ 目录
- temp/<TWEET_ID>/ 目录包含：info.json, video.mp4 (原画), preview_480p.mp4 (预览), video.jpg
- 检查在 D1 的 prompts 表中（按 slug）是否已经存在了 <TWEET_ID> 对应的资源，已经存在的话则提示用户
- 如果下载出错，重试 2 次
- 如果帖子中提到提示词在回复中，则拉取回复内容，提取完整提示词（不要改写、不要提炼，如果是 json 格式则保持），所有收集到的信息存入 full_text 字段

### 新流程关键变化（与老 Hugo 流程不同）

1. **草稿不再 publish-ready 时搬文件夹**——所有草稿 MD 始终在 `_drafts/` 目录，状态用 front matter 区分
2. **没有 `content/prompts/` 目录**——发布后的源真相在 D1，不再写文件系统
3. **媒体不再入 `static/prompts/`**——发布由 md-editor 直接 HTTP 上传到新站 R2 binding
4. **front matter 增加状态字段**：`published`、`published_at`、`published_slug`、`published_error`

### 解析元数据 (Analyze Metadata)

- 读取 info.json
- 提取：post_id, full_text, author_name, url, post_date (格式 YYYYMMDD)

### 规划路径 (Path Strategy)

- 年月目录：解析 post_date 提取 YYYY-MM (例如 2026-02)
- Slug 生成：`<TWEET_ID>-kebab-video-description` (例如：`206987039866945601-crocodile-floodgate`)
- 草稿内容文件：`content/_drafts/prompts/<YYYY-MM>/<Slug>.md`
- 草稿素材目录：`static/_drafts/prompts/<YYYY-MM>/<Slug>/`
- **路径不再变化**——`draft: true/false` 不再触发移动，全部留在 `_drafts/`

### 处理静态资源 (Asset Management)

- 创建草稿目录：`mkdir -p static/_drafts/prompts/<YYYY-MM>/<Slug>`
- 迁移封面图：`cp temp/<TWEET_ID>/video.jpg static/_drafts/prompts/<YYYY-MM>/<Slug>/cover.jpg`
- 迁移视频（仅预览版）：`cp temp/<TWEET_ID>/preview_480p.mp4 static/_drafts/prompts/<YYYY-MM>/<Slug>/video.mp4`
- 把封面图尺寸宽度压缩到长边不大于 600px，保持比例，使用 ImageMagick 把图片压缩到 60% 的 jpg，大小控制在 30k 之内
- 把视频压缩到 480p，体积控制在 1M 之内
- （注：优先使用生成的 480p/preview 版本以节省带宽，若无预览版则使用原版）

### 生成 Markdown 内容 (Content Generation)

- 创建文件：`content/_drafts/prompts/<YYYY-MM>/<Slug>.md`
- 关键 Front Matter 字段（务必不要写错）：

  ```yaml
  ---
  title: <从 full_text 提取的简短标题，3-7 个单词，不含模型名，英文>
  description: |
    <完整提示词，多行必须用 | 块语法，避免转义 \n>
  models:
    - <自动匹配的 1 个视频模型 slug，优先匹配 data/models.yaml>
  tags:
    - <最多 5 个 tag，不含 model 字段，优先 data/tags.yaml 已有标签>
  author: <原始帖子作者名>
  source_url: <原始帖子链接，不要用 url 字段（保留）>
  post_date: <ISO 8601 YYYY-MM-DD>
  image: /prompts/<YYYY-MM>/<Slug>/cover.jpg
  video: /prompts/<YYYY-MM>/<Slug>/video.mp4

  # === 草稿状态字段（新流程）===
  draft: true                        # 始终 true，直到 md-editor 发布后才会改
  published: false                   # 发布成功后 md-editor 改 true
  published_at: null                 # 发布成功后填 ISO 8601 时间戳
  published_slug: null               # 同 front matter 顶层 slug，冗余便于检索
  published_error: null              # 发布失败时填错误信息，可重试
  ---
  ```

- 字段约束：
  - `title` 提取：3-7 个单词，语义完整且吸引人，不含模型名，英文
  - `description`：从 full_text 提取完整提示词；不要有遗漏、截取或提炼；不要翻译；若 full_text 不完整看上下文；多行必须用 YAML 多行语法 `description: |` 后换行缩进；清除内容中所有独立行的 `---`
  - `models`：自动匹配 1 个视频模型，优先 `data/models.yaml` 关键词
  - `tags`：最匹配，不超过 5 个，不包含 model；优先 `data/tags.yaml`；如必要才新增
  - 如果新增标签或模型，更新 `data/models.yaml` 和 `data/tags.yaml`
  - `source_url`：原帖链接（**注意：不要用 url 字段，因为那是 Hugo 保留字段**）
  - `draft: true` 默认

### 清理与验证 (Cleanup)

- 删除临时目录：`rm -rf temp/<TWEET_ID>`
- 验证生成文件的 Front Matter 路径是否正确包含 `<YYYY-MM>`
- 验证草稿 MD 与素材都位于 `_drafts/` 目录中
- **不再**做 `git status` 检查——本流程与 git 解耦
- 运行 `./tools/start-md-editor.sh` 启动编辑器
- 浏览器打开 `http://localhost:3000/`，找到刚生成的草稿，编辑后点 **"📤 发布"**
- 发布成功后 md-editor 会把 front matter 改写：
  ```yaml
  draft: false
  published: true
  published_at: 2026-06-15T03:21:08+08:00
  published_slug: <slug>
  published_error: null
  ```
- 发布失败则保留 `draft: true`，但 `published_error` 填错误信息，可重试

### 发布后的清理（人工触发）

- md-editor 切到 "已发布" tab，会列出所有 `published: true && published_error: null` 的草稿
- 点 "🗑 一键清理已发布草稿"：二次校验 D1 → 删除本地 MD + 素材目录
- 校验失败则保留，本地作为"待人工对账"清单

### 重要：不要再做的事

- ❌ 不要把 `draft: false` 的 MD 移动到 `content/prompts/` 目录（已不存在）
- ❌ 不要把素材移动到 `static/prompts/` 目录（已不存在）
- ❌ 不要 `git push` 触发 Hugo 部署（老仓库已退役）
- ❌ 不要用 url 字段存原帖链接（用 source_url）
- ❌ 不要把 models/tags 写成逗号分隔字符串（必须用 YAML 数组 `- xxx`）
