# AI 模型页 / 标签页「当内容页做」的业界调研

> 调研时间：2026-10-18 · 方法：curl / web_fetch 直接抓取 + web_search
> 证据分级贯穿全文：**【实测】**= 我实际抓到 HTML/JSON/MD 并读到原文；**【搜索摘要】**= 只看到搜索结果的标题/片段；**【未获取】**= 站点被 Cloudflare 拦截，无法直接验证。

---

## 0. 结论先行（TL;DR）

1. **头部玩家已经不把模型页当列表页了。** OpenArt 的 `/ai-model/seedance-2-5/` 是本次调研里最完整的"模型内容页"：导语 + 规格断言 → Key Features（5 段带小标题的长文）→ How to Use（3 步）→ 用例（4 段）→ Tips for Best Results（5 条）→ 相关博客（含"Prompt Guide: Syntax, Tips, and 30 Sample Prompts"）→ Trustpilot 证言 → FAQ（9 问）。**【实测】**
2. **"模型页 = 官方 prompt guide 的下游搬运 + 二次加工"是主流做法。** Replicate 的 Veo 3 README 里直接有一节 `✨ Prompting Tips (from Google's Guide)`，把 Google 官方的 shot composition / lens / genre / camera motion 四类词表和一条示例 prompt 抄进模型页。**【实测】**
3. **官方 prompt guide 本身的结构极其标准化**：Google Veo 的 `Anatomy of a prompt` 拆成 Subject / Action / Scene or context / Camera angles / Camera movements / Lens & optical effects / Visual style / Lighting / Tone or mood / Artistic style / Ambiance / Temporal elements / Audio / Cinematic terms / Negative prompts —— 这是一份现成的"模型页骨架"。**【实测】**
4. **tag 页的形态分化非常明显**：Replicate Collections、HuggingFace `/tasks/*`、Futurepedia 分类页、OpenArt `/generator/*` 是**真 hub**（有导语、推荐理由、跨模型对比、FAQ）；而 HF `/models?pipeline_tag=…`、PromptHero `/ai-models/search/tags/*` 只是**筛选列表**。**【实测】**
5. **hub 型 tag 页的通用配方**（四家独立出现）：① 导语/推荐语 ②「我们推荐哪些模型 + 按什么场景分」的散文式推荐 ③ 跨模型对比/排名引用 ④ FAQ ⑤ Tips 清单 ⑥ 兄弟标签导航。**【实测】**
6. **没有任何 Google 官方文件说"类别页比详情页更容易获得流量"。** 官方只说明系统按**查询意图**选择最合适的落地页（Mueller 2019 谈类别页 vs 产品页，SEJ 记录）。**「未找到公开证据」**支持"tag 页天然比详情页流量高"这种强断言。**【实测】**
7. **programmatic SEO 的官方态度是"看内容质量，不看生产方式"，但对规模化的门径极窄**：Mueller 原话 `programmatic SEO is often a fancy banner for spam`（2023-07）。**【实测】**
8. **Google 的两条硬红线原文**：`Doorway abuse`（"Creating substantially similar pages that are closer to search results than a clearly defined, browseable hierarchy"）与 `Scaled content abuse`（"Using generative AI tools or other similar tools to generate many pages without adding value for users"）。2026 年的 AI 优化指南进一步点名"为 query fan-out 的每个变体造页面"违反 scaled content abuse。**【实测】**
9. **业界质量校验环节最硬的证据来自 Civitai**：它在官方仓库里公开了一个 agent skill `write-model-description`，把模型页文案写成**可执行的模板 + 可勾选的验收清单**（字符数下限、"每个 upstream 贡献者都要出现在 Built by 里"、"版本列表必须与页面实际一致"）。**【实测】**
10. **成本最低的"列表页 → 内容页"升级路径**：Civitai 的 skill 显示，用 LLM 起草 + 人工按清单核验（来源链接、版本一致性、贡献者署名）已经是**公开可复制的成熟流程**，且与 Google "人工 factcheck 后再发布"的要求方向一致。**【实测】**

---

## 1. 模型页上真实的「非列表」内容模块

### 1.1 逐站实测记录

| 站点 / 页面 | URL | 我实际看到的非列表模块 |
|---|---|---|
| **OpenArt** 模型页（最完整） | [openart.ai/ai-model/seedance-2-5](https://openart.ai/ai-model/seedance-2-5/) | 导语（含 30s / 全高清 / 50 参考输入 / prompt 准确率 +20% 的断言）· 内嵌生成器（Add image reference / Generate）· **Community Creations**（UGC 画廊）· **Key Features**（5 段：更长生成 / 50 路多模态参考 / 区域级编辑 / 实时速度与更高准确率 / 原生音频同步）· **How to Use**（Step 01–03）· **Built for the Full Scene**（4 个生产用例）· **Tips for Best Results**（5 条带 emoji 的实践建议）· 相关博客（含该模型的 Prompt Guide、版本对比文）· Trustpilot 证言 · **FAQ（9 问）** · 页脚模型导航 |
| **Replicate** 模型页 | [replicate.com/google/veo-3](https://replicate.com/google/veo-3) | Tab 结构 Playground / API / Examples / README · **Examples 画廊** · README：模型简介 · **🔥 Key Features**（6 条）· Built by（团队署名）· **✨ Prompting Tips (from Google's Guide)**（4 类词表 + 示例 prompt 拆解）· Model created / Model updated 时间戳 · runs 计数 |
| **fal.ai** 模型页 | [fal.ai/models/fal-ai/veo3](https://fal.ai/models/fal-ai/veo3) | 弃用横幅（"This endpoint is deprecated"）· 标签（Text to Video / Inference / Commercial use / Partner）· Schema / **LLMs** / Playground / API / Examples 分页 · **Readme**（Overview · Key Capabilities · Flexible Processing Options · Simple Integration · Implementation Guide 带 JS/Python 代码）· **定价说明**（$0.20/s 无音频、$0.40/s 有音频，并给 5s 例子）· 页脚按 Lab / 品类 / 场景的策展导航 |
| **fal.ai** 模型页的 LLM 版 | [fal.ai/models/fal-ai/veo3/llms.txt](https://fal.ai/models/fal-ai/veo3/llms.txt) | 同一模型的纯文本版：Endpoint / Model ID / Category / **Pricing** / Input Schema（逐参数说明 + 默认值 + 枚举 + 示例 prompt）/ Output Schema / 用法示例。**"模型页同时产出 .md/llms.txt 版本"是 2026 年的新标准动作** |
| **HuggingFace** 模型页 | [huggingface.co/black-forest-labs/FLUX.1-dev](https://huggingface.co/black-forest-labs/FLUX.1-dev) | Model card / Files / **Community(616)** 三 Tab · 自动生成的 "Instructions to use … with libraries, inference providers, notebooks, and local apps" · 门控协议（需同意许可）· **Model card 目录**：Key Features / Usage / API Endpoints / ComfyUI / Diffusers / **Limitations** / **Out-of-Scope Use** / License · 标签组（Text-to-Image、Diffusers、Safetensors、English、FluxPipeline、image-generation、flux、License）· 点赞/关注数 |
| **AIMLAPI** 模型页 | [aimlapi.com/models/veo-3](https://aimlapi.com/models/veo-3) | 营销式 H1 + 副标题 · 导语（规格断言：30fps、10 分钟、128K context、95% prompt adherence）· 能力三卡（原生音频 / 真实物理 / 精确 prompt 遵循）· **分节长文**（Match Your Creative Style / Keep Scenes Consistent / Intuitive Camera Controls）· 可运行代码块（含一条超长示例 prompt）· "refer to the Veo 3 model card" 外链 · 转化 CTA |
| **AIMLAPI** 模型索引 | [aimlapi.com/models](https://aimlapi.com/models) | 混合型：1000+ 模型的可筛选列表，但每条**带一句编辑描述 + 价格**（"Seedance 2.5 API is available through a video generation endpoint, priced per token based on resolution, frame rate, and duration."）→ Learn More 进模型页 |
| **Google 官方** Veo prompt guide | [cloud.google.com/…/video-gen-prompt-guide](https://cloud.google.com/vertex-ai/generative-ai/docs/video/video-gen-prompt-guide) | **Anatomy of a prompt** 15 节：Subject / Action / Scene or context / Camera angles / Camera movements / Lens and optical effects / Visual style & aesthetics / Lighting / Tone or mood / Artistic style / Ambiance / Temporal elements / Audio / **Cinematic terms** / **Negative prompts** · 每节 = 分类词表 + 示例 prompt + 示例视频 · 有 "Safety filters" 前置说明 · 有 "Some advanced camera angles are not officially supported" 的**能力边界声明** |
| **OpenAI 官方** Sora 2 Prompting Guide | [developers.openai.com/…/sora2_prompting_guide.md](https://developers.openai.com/cookbook/examples/sora/sora2_prompting_guide.md) | **Updated – March 2026** 更新日志（新能力 5 条）· Before you prompt（方法论）· **API Parameters**（model/size/seconds/characters，含分辨率与时长枚举）· Video Resolution / Video Length 分节 · **Endpoints** · **Prompt anatomy that works** · Going Ultra-Detailed（含完整示例）· **Visual cues that steer the look** · Control motion and timing · Lighting and color consistency · Use image input for more control · Dialogue and Audio · Iterate with video edits · Characters / Extend a video · **Prompt Templates and Examples**（Prompt Structure + 2 个完整示例）· 页面自带 `.md` 版本与 `llms.txt` 索引 |
| **Kling 官方** API 文档（模型页形态） | [kling.ai/…/3-0-omni/text-to-video.md](https://kling.ai/document-api/api/video/3-0-omni/text-to-video.md) | 文档索引 `llms.txt` 前置 · **Sibling Tabs** 声明 · **完整参数表**（resolution 720p/1080p/4k、aspect_ratio、duration 3–15s 逐值枚举、audio、multi_shot）· **prompt 规则**（最大 3072 字符、建议 ≤2500）· **多镜头 prompt 语法**：`shot n, m, words;` 且"每段 ≥1s、时长之和必须等于总时长、单段 ≤512 字符"· 外链官方 Model User Guide · 完整 request/response 示例 · 任务查询 API |
| **Kling** 文档索引 | [kling.ai/document-api/llms.txt](https://kling.ai/document-api/llms.txt) | 全站文档的 LLM 可读索引；每个模型/版本（3.0 Turbo、3.0 Omni、O1、2.6、2.5 Turbo…）都有独立 `.md` 模型页 |
| **PromptHero** 模型页（弱） | [prompthero.com/ai-models/glowing-tattoo-anime-sdxl-download](https://prompthero.com/ai-models/glowing-tattoo-anime-sdxl-download) | **Model Information**（图集）· Description（一行，UGC）· 下载按钮 · **Model Details 规格表**（Type / Subtype / Created / Updated）· Available Files · **Tags**（内链到 tag 页）· **Versions（15 个）** · Related Models（空壳）。**基本没有编辑内容，是典型"未升级"的模型页** |
| **Futurepedia** 工具页 | 我尝试的 `/tool/runway-ml`、`/tool/sora`、`/tool/veo-3` 全部 404；**未找到有效工具页 URL** | — |
| **Civitai** 模型页 | [civitai.com](https://civitai.com/) **403 Cloudflare，未获取** | 只能从**官方 API 文档**反推字段：[developer.civitai.com/site/reference/models.md](https://developer.civitai.com/site/reference/models.md) 显示模型具备 `tag`、`types`、`baseModels`、`sort`（Highest Rated / Most Downloaded / Most Liked / **Most Discussed** / Most Collected / Most Images）、`period`、版本（model-versions）、评论/评分等字段；[articles 文档](https://developer.civitai.com/site/reference/articles.md) 显示站内有**长文 Article**（guide / workflow write-up / changelog），可按 tag 过滤 —— 即"模型页挂长文 + 按 tag 组织" |
| **PromptBase** | [promptbase.com](https://promptbase.com/) **403 Cloudflare，未获取** | 仅搜索摘要可见其为 prompt 交易市场，**未找到可验证的模型页/标签页模块证据** |
| **There's An AI For That** | [theresanaiforthat.com](https://theresanaiforthat.com/) **403 Cloudflare，未获取** | 搜索摘要显示其 URL 形如 `/s/text+to+video/`、`/s/video+qu/latest/`、`/s/text+to+videos/price/`，**带排序/价格后缀** → 更像"搜索结果页"而非 hub。**未能验证** |

### 1.2 模块清单（出现频次）

| 模块形态 | 实测出现的站点 |
|---|---|
| 模型简介 + 版本差异说明 | OpenArt、Replicate、fal、HF、Sora guide、Civitai(API/skill) |
| 参数 / 时长 / 分辨率 / 宽高比规格表 | Kling（最完整）、Sora guide、fal（Input Schema）、HF、PromptHero（弱版）、OpenArt FAQ |
| prompt 写法教程（"anatomy of a prompt"） | Google Veo、Sora guide、Replicate（转引）、OpenArt（独立博客 + Tips） |
| 正反例 / 示例 prompt 拆解 | Google Veo（每节一例）、Sora guide（2 个完整示例）、Replicate、fal（schema 里带 example prompt）、AIMLAPI |
| 最佳实践清单（Tips） | OpenArt（5 条）、Replicate（Prompting Tips）、Sora guide、Replicate Collection（4 条） |
| FAQ | OpenArt（模型页 9 问 / tag 页 6 问）、Replicate Collection（9 问）、theStacc 建议项 |
| 更新时间线 / Updated 日期 | Sora guide（"Updated – March 2026" + 变更列表）、Replicate（created/updated）、HF、OpenArt（博客日期） |
| 对比其他模型的表格 / 散文 | Replicate Collection（按场景推荐 + 引用 Artificial Analysis 排名）、OpenArt（"How is X different from Y" FAQ）、OpenArt tag 页（Top AI Models 列表带描述） |
| 作者 / 社区 UGC | OpenArt（Community Creations + Trustpilot）、HF（Community 616）、Civitai（articles/discussions）、PromptHero（用户上传） |
| **能力边界 / 局限说明** | HF（Limitations + Out-of-Scope Use）、Google Veo（"Some advanced camera angles are not officially supported"）、fal（deprecated 横幅）、OpenArt（"DISCONTINUED MODEL – Sora 2 is no longer available"）、Kling（枚举值即边界） |
| 可运行代码 / API 接入 | fal（JS/Python）、AIMLAPI、HF（Diffusers）、Kling（curl） |
| 定价 | fal、AIMLAPI（列表页 + 详情页）、Futurepedia（列表卡片） |
| 内嵌交互式生成器 | OpenArt、fal、Replicate |
| **面向 LLM 的 .md / llms.txt 版本** | fal（模型级 llms.txt）、Kling（全站 llms.txt + 每页 .md）、OpenAI（每页 .md + llms.txt）、Civitai 开发者文档（每页 .md） |

---

## 2. tag 页：真 hub vs 筛选列表

### 2.1 判定结果（全部实测）

| tag 页 | URL | 判定 | 依据 |
|---|---|---|---|
| Replicate Collections | [replicate.com/collections/text-to-video](https://replicate.com/collections/text-to-video) | **真 hub** | 导语（"These models generate videos from text prompts… most models now generate native audio"）· **Models we recommend** 按 8 个使用场景分组的散文推荐（cinematic realism / multi-shot storytelling / multimodal reference / fast social / start-end frame / cost-quality / draft mode / open source）· Other rankings（外链 Artificial Analysis）· Featured models · **FAQ（9 问）** · **Tips for better results（4 条）** |
| HuggingFace Tasks | [huggingface.co/tasks/text-to-video](https://huggingface.co/tasks/text-to-video) | **真 hub** | About · **Use Cases（3 节）** · **Task Variants（4 节）** · Inference · Useful Resources · Compatible libraries · **策展模型列表（每条带编辑 Note）** · Datasets |
| Futurepedia 分类页 | [futurepedia.io/ai-tools/text-to-video](https://www.futurepedia.io/ai-tools/text-to-video) | **真 hub** | H1 + 导语 · **On this page 跳转目录** · **Why you can trust us**（E-E-A-T 模块）· 列表 · 列表之后还有 3 大节长文（Where AI Text-to-Video Shines / AI-Powered Video Editing / AI: Your Catalyst…）· 内链交叉（"» Learn About: The Best AI Text Generators"）· 示例视频 |
| Futurepedia 分类索引 | [futurepedia.io/ai-tools](https://www.futurepedia.io/ai-tools) | 半 hub | 仅"分类 → 子分类 + 计数"的导航目录，无正文 |
| OpenArt `/generator/*` | [openart.ai/generator/anime](https://openart.ai/generator/anime) | **真 hub** | H1 + 导语 · **Why Creators Are Using…**（4 段理由）· **How to Use**（Step 01–03）· **What Anime Images Can You Create**（4 个用例）· **Discover More AI Features**（兄弟标签导航）· **Top AI Models**（跨模型列表，每条带描述）· **FAQ（6 问）** |
| OpenArt `/models` | [openart.ai/models](https://openart.ai/models) | 筛选列表（App 内） | 只有 My models / OpenArt selections / Community models + Filter + Trending/Latest 排序，无正文 |
| HF 模型筛选页 | [huggingface.co/models?pipeline_tag=text-to-video](https://huggingface.co/models?pipeline_tag=text-to-video) | 纯筛选列表 | 巨大筛选侧栏（Tasks/Parameters/Libraries/Apps/Inference Providers/Hardware）+ 2,889 条结果 + 分页；**无正文** |
| PromptHero tag 页 | [prompthero.com/ai-models/search/tags/cecilia](https://prompthero.com/ai-models/search/tags/cecilia) | 纯筛选列表 | H1 固定为 "Search AI Models & Addons"、"very few results"、2 张卡片，**无导语** |
| PromptHero 模型主题页 | [prompthero.com/veo-prompts](https://prompthero.com/veo-prompts) | 半 hub | H1 + **1 句导语**（"Browse the best veo prompts… curated high-quality AI-generated examples with ready-to-use prompts and settings."）+ **Related Topics 内链模块**（AiVeo Portraits / Sora / Seedance / Luna…）+ 长列表。**有"主题中心"的雏形，但没有 FAQ/对比/教程** |
| PromptHero 品类页 | [prompthero.com/ai-models/text-to-video](https://prompthero.com/ai-models/text-to-video) | 纯筛选列表 | "very few results" + 10 个模型卡片，无导语 |
| TAAFT tag 页 | theresanaiforthat.com | **未获取** | 403；URL 形态 `/s/…/latest/`、`/s/…/price/` 暗示排序筛选页 |

### 2.2 hub 型 tag 页的组成要素（跨站归纳）

1. **关键词化 H1**（"AI Anime Generator"，不是 "Anime"）。
2. **导语 / 推荐语**：100–200 词，说明这个主题覆盖什么、为什么值得看。（Replicate、HF、Futurepedia、OpenArt、theStacc 建议）
3. **散文式策展推荐**，而非排序列表：Replicate 按 8 个使用场景给"该选谁 + 为什么"；HF 给每条模型一句编辑 Note。
4. **跨模型对比 / 排名引用**：Replicate 引 Artificial Analysis 榜单；OpenArt 在 FAQ 里做 "X 与 Y 有何不同"。
5. **教程 / How-to**：OpenArt 的 Step 01–03；Futurepedia 的 3 节长文。
6. **FAQ**：Replicate 9 问、OpenArt 6 问。
7. **兄弟标签导航**：OpenArt "Discover More AI Features"；PromptHero "Related Topics"；dev.to 提到的 "sibling tags bar"。
8. **子主题 / 用例导航**：HF 的 Use Cases + Task Variants；OpenArt 的 What You Can Create。
9. **结构化数据**：dev.to 案例用 `CollectionPage` + breadcrumb + itemList。**【实测，单一站点经验】**

---

## 3. 「模型页 / tag 页 vs 单条详情页」的流量与 SEO 证据

### 3.1 有证据的部分

| 证据 | 来源 | 内容 |
|---|---|---|
| **Google 按查询意图选页，不"偏好类别页"** | [SEJ：Google on How to Rank Category Pages](https://www.searchenginejournal.com/how-to-rank-category-pages/328281/)（2019-09，引 John Mueller 原话）**【实测】** | Mueller：类别页要在站内被良好链接（"make sure that the category page is well-linked within your website"）；**类别页最怕关键词堆砌**（"we see these keywords repeated so often on that page that we think well, something is kind of fishy with this page"）；SEJ 作者补充：Google 倾向用**具体详情页**承接具体查询（颜色/尺寸/型号），用**类别页或信息页**承接**模糊查询** |
| **programmatic hub 页的真实流量量级** | [Ahrefs：Programmatic SEO, Explained for Beginners](https://ahrefs.com/blog/programmatic-seo/)（更新 2026-09-02）**【实测】** | Notion 模板**类别页** `/templates/category`：约 600 个排名页面、**约 204K 月自然流量**；Canva **feature 页** `/features/`：约 310 个排名页、**约 13M 月自然流量**；QuillBot 工具库约 130 页、**约 464K 月流量**。⚠️ 这些是 **Ahrefs 自家估算**，非站点公开数据，也不是"类别页 vs 详情页"的对照实验 |
| **规模化内容的官方风险信号** | [Search Engine Roundtable：Mueller says programmatic SEO often a fancy banner for spam](https://www.seroundtable.com/programmatic-seo-banner-for-spam-google-35766.html)（2023-07-26）**【实测】** | Mueller 原话：`programmatic SEO is often a fancy banner for spam.` 上下文是 Lily Ray 指出"数十个站点抓取并改造其他站数据，生成海量超细分落地页" |
| **规模化内容的实测数据（目前最硬的量化研究）** | [Ahrefs：Google Doesn't Punish AI Content; It Punishes Bad Content (331k Pages Studied)](https://ahrefs.com/blog/google-doesnt-punish-ai-content/)（2026-07-27）**【实测】** | 100,000 个 SERP × top10 = 1,000,000 页，其中约 300k 在爬虫库、150k 可检测。要点：top1–3 中 **5.3% 是 100% AI 生成**、9% 是 ≥80% AI；但 **<50% AI 的页面占 top3 的 82.2%**；**索引率从低 AI 内容的 49.28% 降到极高 AI 内容的 40.35%**；**低/中 AI 内容页获得的自然展现量是高/极高 AI 内容页的 2–3 倍**（"the starkest performance gap found in the study"）；高 AI 内容页的展现量随时间**没有**断崖式下跌 |
| **tag 页的密度门槛（实操经验）** | [dev.to：Programmatic SEO Tag Density and Entity Hubs](https://dev.to/raylabs/programmatic-seo-tag-density-and-entity-hubs-dh8)（2026-10）**【实测】** | 单一站点（RayLabs）审计：195 篇文章产生 291 个 tag，其中 **201 个（69%）是只挂 1 篇文章的 singleton**；结论：singleton tag 页 = 低价值 doorway page，会被判 soft 404 / thin content。做法：**只有 ≥3 篇的 tag 才生成静态 hub 页**，否则动态跳转到筛选搜索；tag 与 pillar 主题冲突时统一 canonical 到 pillar |
| **taxonomy / tag 页的通用建议** | [theStacc：Taxonomy SEO](https://thestacc.com/glossary/taxonomy-seo/)（2026）**【实测】** | "Taxonomy pages are among the highest-traffic pages on any content-heavy site"（**无数据支撑，属经验断言**）；"A well-optimised category page can outrank individual posts for head terms"；tag 页默认 noindex、只选择性 index；分类页正文 100–200 词导语 + 编辑精选 3–5 篇；"category page with zero impressions after 6 months → 考虑取消 index" |
| **Notion 的 use-case 页策略** | [Lil Big Things：Notion teardown](https://www.lilbigthings.com/post/notion-use-case-content-teardown) **【实测】** | 三层结构（用户模板页 / use-case 落地页 / 集成页）；"公开分析估计内容 SEO 贡献了 Notion 约 1/3 的新增用户"。⚠️ **该文自述基于公开报道与推测，非一手数据**，我不采信其数字 |

### 3.2 明确「未找到公开证据」的部分

- **未找到**任何 Google 官方文件、Search Console 文档或大规模对照研究，说明"模型页 / tag 页比单条 prompt 详情页更容易获得搜索流量"。
- **未找到** prompt 站点（PromptHero / PromptBase / Civitai / OpenArt）公开的"模型页 vs 详情页"流量或排名对比数据。
- **未找到** Google 关于"AI 生成批量内容"的独立质量指南 —— 相关规则全部落在 **spam policies** 与 **Search Quality Rater Guidelines** 两处（见第 4 节），加上 gen-AI 使用指南与 AI 优化指南。
- **未找到** Seedance / Runway / Pika 官方 prompt guide 的可直接抓取内容（BytePlus 文档为 JS 渲染，Runway help center 403），**仅有 URL 与搜索摘要**。

---

## 4. Google 官方对「模板化批量生成页面」的界定与红线

### 4.1 Doorway abuse（门径页）

来源：[Spam Policies for Google Web Search → Doorway abuse](https://developers.google.com/search/docs/essentials/spam-policies#doorway-abuse) **【实测，curl 抓原文】**

> "Doorway abuse is when sites or pages are created to rank for specific, similar search queries. They lead users to intermediate pages that aren't as useful as the final destination."

官方列举的 doorway 形态（原文）：

- "Having multiple websites with slight variations to the URL and home page to maximize their reach for any specific query"
- "Having multiple domain names or pages targeted at specific regions or cities that funnel users to one page"
- "Generating pages to funnel visitors into the actual usable or relevant portion of a site"
- **"Creating substantially similar pages that are closer to search results than a clearly defined, browseable hierarchy"** ← 对 tag 页/模型页最直接的一条

### 4.2 Scaled content abuse（规模化内容滥用）

来源：[Spam Policies → Scaled content abuse](https://developers.google.com/search/docs/essentials/spam-policies#scaled-content-abuse) **【实测】**

> "Scaled content abuse is when many pages are generated for the primary purpose of manipulating search rankings and not helping users. This abusive practice is typically focused on creating large amounts of unoriginal content that provides little to no value to users, **no matter how it's created**."

官方示例（原文）：

- "Using generative AI tools or other similar tools to generate many pages without adding value for users"
- "Scraping feeds, search results, or other content to generate many pages (including through automated transformations like synonymizing, translating, or other obfuscation techniques), where little value is provided to users"
- "Stitching or combining content from different web pages without adding value"
- "Creating multiple sites with the intent of hiding the scaled nature of the content"
- "Creating many pages where the content makes little or no sense to a reader but contains search keywords"

并附一句操作指令：**"If you're hosting such content on your site, exclude it from Search."**

### 4.3 官方公告与指南（时间线）

| 文档 | URL | 关键原文 |
|---|---|---|
| 2023-02-08 博客 | [Google Search's guidance about AI-generated content](https://developers.google.com/search/blog/2023/02/google-search-and-ai-content) **【实测】** | "Using automation—including AI—to generate content with the primary purpose of manipulating ranking in search results is a violation of our spam policies." / "it's important to recognize that **not all use of automation, including AI generation, is spam**."（举例：体育比分、天气预报、转录稿） |
| 2024-03-05 博客 | [What web creators should know about our March 2024 core update and new spam policies](https://developers.google.com/search/blog/2024/03/core-update-spam-policies) **【实测】** | 新政策三项：expired domain abuse、scaled content abuse、site reputation abuse。scaled content abuse "builds on our previous spam policy about automatically-generated content, ensuring that we can take action … **no matter whether content is produced** …" |
| gen-AI 使用指南 | [Google Search's guidance on using generative AI content on your website](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content) **【实测】** | "It is critical to **manually factcheck and review all AI-generated content** for accuracy and trustworthiness before publishing. This review also applies to metadata like `<title>` elements, meta description elements, structured data, and alternate texts for images." / "Sharing information about how a piece of content was created can help give your readers more context." |
| 2026 AI 优化指南 | [Optimizing your website for generative AI features on Google Search](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) **【实测】** | "While it might be tempting to **create separate content for every possible variation of how people might search** (for example, by focusing on other queries that people have asked, or **fan-out queries**), doing so primarily to manipulate rankings or generative AI responses in Google Search **violates Google's scaled content abuse spam policy**." / "a high quantity of pages doesn't make a website higher quality or more relevant to users" / 强调 **non-commodity content**（"Don't just recycle what others on the internet have already said, or could easily be produced by a generative AI model."） |
| Helpful content | [Creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) **【实测】** | 自检问题含："Is the content mass-produced by or outsourced to a large number of creators…?" / "Are you producing lots of content on many different topics in hopes that some of it might perform well in search results?" / "Are you using extensive automation to produce content on many topics?" / "Does the content provide substantial value when compared to other pages in search results?" |
| 质量评估员指南 | [Search Quality Rater Guidelines (PDF)](https://static.googleusercontent.com/media/guidelines.raterhub.com/en//searchqualityevaluatorguidelines.pdf) §4.6.5 / §4.6.6 **【实测，pdftotext 提取】** | §4.6.5："Creating an abundance of content with little effort or originality **with no editing or manual curation** is often the defining attribute of spammy websites." / "Pages and websites made up of content created at scale with no original content or added value for users, should be rated **Lowest**, no matter how they are created." / §4.6.6：Lowest 适用于"all or almost all of the MC on the page … is copied, paraphrased, embedded, **auto or AI generated**, or reposted from other sources with little to no effort, little to no originality, and little to no added value" |

### 4.4 红线归纳（我的提炼）

1. **判定的不是"是否用 AI"，而是"是否主要为操纵排名而生成、对用户无增量价值"。**
2. **规模本身不是问题，"规模 + 无编辑/无人工策展"才是问题**（QRG §4.6.5 明确把 "no editing or manual curation" 写进定义）。
3. **为 query fan-out 的每个变体造页 = 明确点名违规**（2026 AI 优化指南）。
4. **"substantially similar pages / 比可浏览层级更接近搜索结果页"= doorway**（spam policies）—— 这直接指向"把 tag 页做成同质化的搜索结果页"。
5. **元数据（title / meta description / 结构化数据 / alt）同样受"人工复核"约束。**
6. **官方给出的安全区**：非商品化内容、第一手经验、清晰的站点层级、以及"公开说明内容如何被生产"。

---

## 5. 「列表页 → 内容页」的业界内容生产流程与质检

### 5.1 最硬的一手证据：Civitai 官方公开的模型页写作 skill

来源：**Civitai 官方仓库** [github.com/civitai/civitai → .claude/skills/write-model-description/SKILL.md](https://github.com/civitai/civitai/blob/main/.claude/skills/write-model-description/SKILL.md)（我已验证该 raw 路径返回 200）**【实测】**
（同一内容的可读渲染版：[tessl.io registry 镜像](https://tessl.io/registry/skills/github/civitai/civitai/write-model-description)）

这是**唯一一份我找到的、由平台方自己公开的"模型页内容生产 SOP"**，包含三层：

**A. 结构模板（Required structure）**

1. Lede paragraph（2–3 句：是什么模型 / base 与血缘 / 差异化能力）
2. Source attribution（紧随导语，显式把功劳给上游）
3. "Built by" 小节（H3 列表，列出上游 README 里的**每一个**贡献者及其链接）
4. Feature sections（**3–5 个 H3**，每节一个能力/工作流/版本说明/坑）
5. Links（源码仓库 / Discord / 资助渠道）

**B. 质量门槛（数量与文风硬指标）**

- **篇幅：目标 2,000–4,000 字符 HTML；"Anything under 1,000 chars is too thin."**
- 禁用营销词：cut "revolutionary"、"groundbreaking"、"next-generation"；**"No hedging, no adjectives like 'cutting-edge' / 'state-of-the-art' unless there's a benchmark to back it."**
- 平实表达：`"Sulphur 2 inherits the LTX 2.3 pipeline end to end" beats "leverages the LTX 2.3 architecture for unparalleled fidelity."`
- 有据可依地承认局限："Hedge only when honest. If a build isn't on Civitai, say so."

**C. 生产流程与验收清单（Process + verify before returning）**

- 流程：读上游 README（`huggingface.co/<org>/<model>/raw/main/README.md`）→ **打开 2–3 个同站同类模型页作为文风基准并对齐结构** → 核对 Civitai 上实际镜像了哪些版本 → 先写 markdown 再转 HTML。
- 验收：① 来源链接必须是**上游 canonical 仓库**而非转载；② 上游 README credits 里的每个贡献者都要进 "Built by"；③ **版本列表必须与页面实际一致**（"if upstream ships fp8/bf16/fp16 and we only mirror fp8, say that"）。
- 并且 skill 里内置了一个**可直接复用的 LLM 起草 prompt**（把模型名、页面 URL、上游 URL 填入模板）。

### 5.2 其他可复制的流程证据

| 来源 | 流程要点 |
|---|---|
| [Ahrefs programmatic SEO 六步法](https://ahrefs.com/blog/programmatic-seo/) **【实测】** | ① 找可规模化的关键词模式（要求"≥50 个变体"再考虑）② 定页面模板（**先让 AI 抓取目标关键词 top10 页面，统计哪些模块反复出现、哪些是空缺**）③ 找数据（专有数据 > 公开授权数据 > 抓取）④ 生成页面 ⑤ 发布与自动化 ⑥ 追踪表现。其模板必备项：**跳转式目录、明示方法论、显式"最后更新"日期并按月刷新、每个条目固定 6 个数据点、趋势图** |
| [Google gen-AI 使用指南](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content) **【实测】** | 发布前**人工 factcheck 并复核所有 AI 生成内容**（含 title/meta/结构化数据/alt）；**向用户说明内容是如何生成的** |
| [Futurepedia Editorial Guidelines](https://www.futurepedia.io/editorial-guidelines) **【实测】** | "Built by Humans, Powered by AI"；"**AI assists our process, but people make the decisions. Every article and review is created or reviewed by someone** who understands how these tools are used in real work."；工具监控维度：新模型发布 / 价格变化 / 服务中断 / 隐私政策变动；有 Corrections and Updates Policy、Advertiser Disclosure（不卖排名） |
| [OpenArt sitemap.xml 源码注释](https://openart.ai/sitemap.xml) **【实测】** | 站点自己把"内容页"和"薄页"分开管理，注释原文：`<!-- /suite — unique-content pages only (model variants excluded until SSR metadata is fixed) -->` —— **即"模型变体页在 SSR metadata 修好之前不进 sitemap"**，这是一条极其实用的"内容页准入门槛"实践 |
| [OpenArt robots.txt](https://openart.ai/robots.txt) **【实测】** | `Content-Signal: search=yes, ai-input=yes, ai-train=no` —— AI 搜索时代的分层内容授权信号（Cloudflare Content Signals 规范） |
| [dev.to tag density gate](https://dev.to/raylabs/programmatic-seo-tag-density-and-entity-hubs-dh8) **【实测】** | tag 页准入规则：**≥3 篇才生成静态 hub**；singleton 动态降级到筛选搜索、不进 sitemap；与 pillar 冲突的 tag canonical 到 pillar；hub 配人工撰写的主题描述 + `CollectionPage` 结构化数据 + 兄弟标签栏 |
| [theStacc taxonomy SEO](https://thestacc.com/glossary/taxonomy-seo/) **【实测】** | 建议每类目 ≥10–15 篇再开新类目；类目页要有 100–200 词导语 + 编辑精选 3–5 篇 + 唯一 meta description；6 个月零展现的类目页考虑取消 index |
| [fal.ai 模型页的 LLMs Tab](https://fal.ai/models/fal-ai/veo3/llms.txt) **【实测】** | 同一份模型页内容**同时产出给人和给 LLM 的两种格式**（HTML + llms.txt），无需二次维护正文结构 |
| [Kling llms.txt](https://kling.ai/document-api/llms.txt) / [OpenAI 文档 .md](https://developers.openai.com/cookbook/examples/sora/sora2_prompting_guide.md) / [Civitai 开发者文档 .md](https://developer.civitai.com/site/reference/models.md) **【实测】** | 均为"每个页面自动提供 .md 版本 + 全站 llms.txt 索引"，Civitai 与 Kling 页面上直接写着 "Are you an LLM? You can read better optimized documentation at …" |

### 5.3 生产模式归纳（人工 / LLM 辅助 / 数据派生 / 混合）

- **纯人工**：OpenArt 的模型页 Key Features / Tips / FAQ 明显是编辑撰写（有具体规格断言与主观取舍）；Futurepedia 声明的也是"人写人审"。
- **数据派生**：Kling / Sora / fal 的规格表与参数枚举直接来自模型 API 的 schema 与枚举值（`duration` 3–15s 逐值、`resolution` 720p/1080p/4k），属于**零虚构风险的数据派生**。
- **LLM 辅助 + 人审（混合）**：Civitai 的官方 skill 是这条路线最完整的公开样本 —— LLM 起草、模板约束、**清单式验收**。
- **UGC 派生**：OpenArt "Community Creations"、HF "Community"、Civitai 的 images/articles/discussions —— 用社区产物做页面的"非模板化"部分。
- **质检的三道闸门（跨站共同点）**：① **事实核验**（规格/版本/贡献者与上游一致）② **内容密度门槛**（Civitai 的 1,000 字符下限；dev.to 的 ≥3 篇；OpenArt 的 SSR metadata 门槛）③ **人工署名与更新机制**（Futurepedia 的 editorial team + corrections policy；Google 要求的"说明内容如何生成"）。

---

## 6. 对「prompt 站模型页 / tag 页升级」的可操作清单（我的综合建议）

> 以下是基于上述实测证据的推论，不是某个站点的原话。

**模型页升级（优先级从高到低）**

1. 导语写"可验证的规格断言"（时长 / 分辨率 / 参考输入数 / 音频 / 版本差异），不要写形容词。
2. **参数规格表**：从模型官方 API schema 派生（时长枚举、宽高比、分辨率、音频开关、prompt 字符上限）—— 零虚构、零维护成本。
3. **Prompt 写法教程**：借用 Google Veo 的 15 段 anatomy 作为字段清单，为本模型裁剪（哪些字段本模型支持/不支持 —— 这就是"能力边界说明"）。
4. **3–5 条最佳实践** + 正例 prompt（附实际生成结果图/视频）。
5. **版本差异表**（vs 上一个版本、vs 同厂兄弟模型）。
6. **FAQ 6–10 问**，用真实搜索问题（"X 和 Y 有什么区别""支持哪些宽高比""能商用吗"）。
7. **局限性 / 已弃用声明**（HF 的 Limitations、fal 的 deprecated 横幅、OpenArt 的 DISCONTINUED 标注）。
8. 同步产出 `.md` / `llms.txt` 版本。

**tag 页升级**

1. **准入门槛**：少于 N 条内容的 tag 不生成静态页（dev.to 用 3），动态降级到筛选/搜索。
2. 100–200 词导语 + 关键词化 H1。
3. **散文式策展**："这个主题下该选哪个模型、为什么"，而不是排序列表。
4. FAQ + Tips + 兄弟标签导航（内链网）。
5. 跨模型对比/引用第三方榜单（并标注来源与日期）。
6. `CollectionPage` + breadcrumb + itemList 结构化数据。

**质检**

- 事实核验（规格/版本与官方文档一致）→ 密度门槛（字符数/条目数）→ 人工署名与更新日期 → 在 sitemap 层面显式区分"内容页"与"变体/筛选页"（照抄 OpenArt 的注释做法）。

---

## 附录：本次未能验证的站点

| 站点 | 状态 |
|---|---|
| civitai.com（模型页 / tag 页 / 文章页） | HTTP 403 Cloudflare（curl 与 web_fetch 均被拦）。结论仅来自其**官方 API 文档**与**官方 agent skill** |
| promptbase.com | HTTP 403 Cloudflare |
| theresanaiforthat.com | HTTP 403 Cloudflare |
| help.runwayml.com（Gen-4 / Image-to-Video Prompting Guide） | HTTP 403；仅从搜索摘要得知存在这两个官方 guide |
| docs.byteplus.com（Seedance 2.0 / 2.5 prompt guide） | HTTP 200 但正文为 JS 渲染，只取到导航（确认页面存在：`/en/docs/modelark/seedance-2-0-prompt-guide`） |
| futurepedia.io 工具详情页 | 我尝试的三个 URL 均 404，**未能定位到有效工具页 URL** |
