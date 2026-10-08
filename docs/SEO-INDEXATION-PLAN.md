# SEO 收录优化实施计划 — 基于 2026-10-08 基线

> 基线数据见 [`SEO-INDEXATION-BASELINE-2026-10-08.md`](./SEO-INDEXATION-BASELINE-2026-10-08.md)。
> 本计划所有"预期收益"都锚定在基线表的数字上，所有"成本"都必须先过 §4 的护栏才能动手。
>
> 最高约束：Cloudflare 用量不暴增。**本计划中会显著增加抓取面的改动（解除分页死区）
> 全部排在成本护栏之后，且默认**有界**，不做无界扩张。**

---

## 0.5 实施状态（2026-10-08 已完成 P0 + P1）

| 项 | 状态 | 落地内容 |
|---|---|---|
| P0-1 | ✅ | `legacy-url.ts` locale 折叠改为"到不动点"循环，修掉 `/ja/ja/…`、`/zh-cn/zh-cn/…` 404 |
| P0-2 | ✅ | locale 别名补齐至 11 个（`zh-tw/zh-hant/zh-sg/zh-hk/en-us/en-gb/ja-jp/jp` 等），大小写不敏感 |
| P1-3 | ✅ | `PAGE_SIZE` 24 → **48**，抽到 `src/lib/pagination.ts` 单一来源，替换原先散落在 **5 个文件**的硬编码 |
| P1-4 | ✅ | related 6 → **12**（预计算上限与读侧 limit 同步），零新增 D1 查询 |
| P1-1 | ✅ | 新增 `/[locale]/tags/[tag]/p/[page]` 与 `/[locale]/models/[model]/p/[page]` 真实分页路径 + 可见分页控件 |
| P1-2 | ✅ | 深度上限 **5 → 3**（成本基线未测到，按成本优先下调），48 × 3 = 每维度 144 条 |
| P2 / P3 | ⬜ | 未开始，需先补测成本基线（§5.0） |

**验证结果**：`tsc` 0 错 · `vitest` 113/113 通过（新增 33 条：legacy-url 25、pagination 11 中含新增断言）· `npm run build` 成功，两条 `/p/[page]` 路由均已注册。

**新增可抓取 URL 估算**：tag 约 582 个（97 个 >48 条的 tag × 2 页 × 3 语言）+ model 少量（25 个 model，深度同样 3），合计远低于护栏 G1 的 1,500 上限。

**实施中发现并修掉的两个既有问题**（不在原计划内，但影响正确性/成本）：

1. `PAGE_SIZE` 原本硬编码在 5 个文件，含 `/api/prompts/route.ts:29`。SSR 页与 API 各算各的 offset，**只改一处会让 GridEngine 无限滚动跳页/重复条目**。现统一为单一来源。
2. models 页 tag 筛选链接原本写成 `/${locale}/models/${model}/?tag=${tt.slug}`，结尾多一个斜杠 → middleware 每次都要先 308 去斜杠再 301 补 query，**用户点一次筛选吃 2 次 Worker 调用**。已去掉多余斜杠。

**刻意没做的事**（与成本护栏一致，不是遗漏）：

- `/p/N` **不进 sitemap**，靠分页控件内链发现即可（与 P2-3「收敛提交面」取向相反）
- robots.txt 对 `?page=` 的封锁**保持不变**；老参数由 `legacy-url.ts` 301 收敛到 `/p/N`，不产生第二套可抓取面
- model × tag 的分面分页**不并入** `/p/N`（内容与 `/[locale]/tags/[tag]` 重复，继续 robots 封 + noindex，避免提交量按乘法膨胀）

---

## 0. 计划的出发点：先纠正一个错误结论

初版分析曾建议"解除 robots.txt 的 `?page=` 封锁"。**该建议是错的，已作废。**

读代码后发现 `?page=` 封锁是 **2026-08-07 的有意决策**（`src/app/robots.ts:4-15` 注释）：

> 1486 个 tag × 3 语言 = 4458 个零 SEO 价值的 URL，每次抓取都是一次完整 SSR
> —— 这是 Worker CPU 超限（Error 1102）的主要来源。

更关键的是 `src/app/[locale]/tags/[tag]/page.tsx:46,61`：

```ts
const isLowValue = sp.page && parseInt(sp.page, 10) > 1;
...
robots: isLowValue ? { index: false, follow: true } : undefined,
```

**分页页自带 `noindex`。** 所以解除 robots 封锁后，Google 能抓到它们，但**依然不会收录**
（`noindex` 是页面自己声明的），只会白白增加 SSR 次数 → 精确复现 Error 1102。

结论：**不能靠"解封 robots"解决收录问题。** 必须同时把 deep 页从"死区"变成
"有独立 canonical 的真实路径"，并且**先把它们变便宜**。

---

## 1. 问题规模（决定策略的三个数字）

| 数字 | 值 | 含义 |
|---|---|---|
| 收录率 | 84 / 37,458 = **0.22%** | Google 拒绝收录全站 99.8% |
| 孤儿 prompt | **4,743 / 6,804 = 70%** | 无任何入口链接 |
| tag 规模中位数 | **19**（max 4,511） | 24 条/页 对绝大多数 tag 够用，只对少数头部 tag 不够 |

**这三个数字指向同一个判断：这不是内链问题，是"站点被提交了远超其质量承受力的 URL 量"的问题。**

Google 的爬取预算按站点质量分配。当前 21,429 个 URL 对应 84 个收录的站点，
质量分会持续走低，此时**继续增加 sitemap URL 或可抓取页面只会加速恶化**。

所以本计划的取向是：**先降噪、再修死区、后提价值**，
而不是"把 4,743 条孤儿全部暴露出去"—— 那会新增 3,000+ 可抓取 URL，
在当前质量分下大概率换来的是 3,000 条新的 "Discovered - not indexed"。

---

## 2. 分阶段实施

### P0 — 纯降本 + 修确定的 bug（零新增抓取面）

#### P0-1 修 `legacy-url.ts` 双 locale 前缀 404

**问题**（基线 §3 根因 C）：`/ja/ja/prompts/...`、`/zh-cn/zh-cn/prompts/...` 落到 404。

**成本影响：负（省成本）**。当前这类 URL 走 2 次 Worker 调用 + 一次完整
Next.js 404 页 SSR（要渲染 layout/Header，而 `HEADER_TAG_LIMIT` 注释实测
tag 序列化曾占首页 HTML 77%）。修好后直接 410/301，**不再进入 SSR**。

改动点 `src/lib/legacy-url.ts:46-51`，把单次 `break` 改为循环折叠 + 折叠重复 locale 段；
同时放宽 `LEGACY_PROMPT_RE`(:31) 允许中间夹段。

配套：`src/lib/legacy-url.test.ts` 补 case（该文件已存在，直接扩）。

**预期收益**：4,265 404 桶中的双前缀部分直接消失；每次抓取省一次 SSR。

#### P0-2 补 `zh-cn` 大小写与 `en-US` 等变体

`LEGACY_LOCALE_MAP` 只有 3 条。GSC example 里出现过 `zh-cn`，
需确认索引中是否还有 `zh-CN` / `zh_CN` / `en-us` 变体。低风险，可与 P0-1 合并做。

---

### P1 — 修死区（**必须先通过 §4 成本护栏**）

#### P1-1 分页页从 `?page=N` 升级为真实路径

`/{locale}/tags/{tag}` → `/{locale}/tags/{tag]/p/2`、`/p/3`…

- 独立 self-canonical（**不是** canonical 回 page 1）
- 去掉 `index:false`，改为可索引
- 补 `<link rel="prev">` / `<link rel="next">` 与页面内可见分页控件
  （当前全站 0 个 `?page=` 链接，这是 70% 孤儿的直接成因）
- **保留 robots 对 `?page=` 的封锁**（老参数继续封，避免双份 URL）

#### P1-2 分页深度硬上限（有界，这是成本护栏的核心）

**不做全量展开。** 全量 = 109,596 条 tag-prompt 关联 / 48 条每页 ≈ 2,283 页/语言
≈ **6,850 个新 URL**。这在当前 0.22% 收录率下是自杀。

建议上限：`p/2 … p/5`（即每个 tag 最多暴露 240 条）。

| tag 规模 | 覆盖效果 |
|---|---|
| median 19 | 1 页装完，无分页 |
| p75 80 | 2 页装完 |
| p90 188 | 4 页装完 |
| >240（头部 ~40 个 tag） | 截断，靠 `/models/[model]` 与详情页 related 承接 |

新增可抓取 URL 估算：约 97 个 tag 有 >48 条 → 每人最多 4 个分页
≈ 388 页/语言 ≈ **1,164 URL（3 语言）**。

#### P1-3 提升 tag 页 PAGE_SIZE 24 → 48

- 直接消灭绝大多数 tag 的分页需求（median 19、p75 80）
- 需重算 canonical/`lastmod` 与 sitemap 覆盖
- 成本：每 tag 页 D1 rows read 翻倍，但**URL 数减少**（无分页的 tag 不再产生 deep 页）

#### P1-4 详情页输出更多内链

当前每个详情页只输出 **9 条** prompt 链接（6 related + 2 上下篇 + 1）。
建议 related 从 6 提到 12–16，并补"同 tag 同 model"交叉链接段。
这直接攻击 4,743 孤儿，且**不新增任何 URL** —— 是本计划里性价比最高的一项。

---

### P2 — 收敛提交面（降噪，不是加量）

#### P2-1 sitemap 拆分

单文件 4.5MB / 21,429 条 → `sitemapindex` + 5 个子表：

```
/sitemap.xml              (index)
/sitemap-prompts-en.xml   /sitemap-prompts-zh.xml  /sitemap-prompts-ja.xml
/sitemap-tags.xml         /sitemap-models.xml
```

收益：① 可只重点提交 `en`，把抓取预算给主力语言；
② 哪块质量差一目了然；③ 避免单表异常拖垮全部。

#### P2-2 稳定 `lastmod`，消除"全站每天在变"信号

`src/app/sitemap.ts:86,96` 的 tag/model `lastmod` 取的是该分类下 prompts 的
`max(updatedAt)`。站点每天发新 prompt → **930 个 tag 页的 lastmod 全天跳动**。
同时 prompt 页是 `changefreq: monthly` 却带真实 `updatedAt`（:106-108）。两套信号打架。

改法：tag/model 的 `lastmod` 改用该 tag/model **自身**的变更时间，
不跟随子 prompt 每日刷新；`changefreq` 统一并保持稳定。

#### P2-3 从 sitemap 中剔除低价值 URL

对照 §1 的判断，**主动减量**：无 tag 的孤儿 prompt、只有 1 条内容的尾部 tag
（313 个 tag 里 median 才 19，尾部大量 1–3 条）、以及 P1-2 截断掉的 deep 页，
不应继续留在 sitemap 里。少提交 = 抓取预算集中 = 单页收录概率提升。

---

### P3 — 唯一能撬动 "Crawled - not indexed" 的动作

13,053 条是 **Google 已爬过并主动拒绝**的。P0/P1/P2 全做完，这桶也不会自动变。
必须提高单页独特性。

当前每页可见文本仅 ~3.2K 字符，且 **3 个 locale 的 body 内容完全一致**
（只有 chrome 翻译，prompt 正文都是英文原文）。这会强化"同质工厂页"判断。

建议：详情页补充 Google 视角下不可替代的结构化信息 ——
参数速查表（时长/画幅/运镜）、适用场景说明、模型适配建议、
按语义分组的相关提示词段落（把 related 从 6 条堆卡片改成有文字的小节）。

目标：让每页有"为什么要存在这个页面"的答案。

---

## 3. P3 方向修正（2026-10-08，实施期基于实测证据推翻原方案）

原 P3 写的是「给详情页补独特内容，撬动 13,053 条 Crawled - not indexed」。
**动手前查了数据，这个前提不成立**，实施时改成了减量 + 类别层。

### 查到的证据

| 测量 | 结果 | 推论 |
|---|---|---|
| 描述长度（全量 6,886 条） | median **1,383** 字，p25=694 | 内容不薄 |
| 疑似截断标题 | **0.7%** | 标题质量没问题 |
| X 作者数 | **1,015** 个，最大单一作者仅占 5.8% | 不是单账号刷量 |
| 描述前 400 字重复 | 286 条（4.2%） | 有少量重复，非系统性 |
| **GSC 平均排名** | **position 6** | **站是有排名能力的** |
| **GSC 有曝光的 query** | **只有 2 个**，其中一个是 `site:awesomevideoprompts.com` | **站外自然曝光≈0** |
| 总曝光 / 点击 | 235 / 4 | 需求量级 |

### 修正后的判断

position 6 说明 Google **愿意给排名**。0.22% 收录率不是因为被惩罚，
而是**被要求收录的 20,412 条长尾详情页几乎没有搜索需求**
（slug 形如 `{推特id}-{通用描述}`，例如 `temporary-tattoo-test-at-midnight`，
没人拿这种词去搜）。请求收录 2 万条近零需求的页面，
结果就是 Google 只给 84 条 —— 这个 0.22% 本身又成了站点的质量信号，
反过来压制了真正有价值的类别页。

**给 2 万条零需求页面加内容，只会增加 HTML 体积和 D1 成本，换不来收录。**

### 因此 P2/P3 实际落地为「减量」而非「加量」

| 项 | 内容 | 提交量影响 |
|---|---|---|
| P2-1 | sitemap 拆成 index + 子表，**每次调用只构造 1/3~1/5 的对象** | 单次 CPU/内存下降（Error 1102 复发源之一） |
| P2-2 | tag/model **省略 lastModified** | 消除"930 个 tag 页 lastmod 全天跳动"的信号 |
| P2-3 | **只提交 en 的 prompt 详情页** | **21,468 → ~7,900（-63%）** |
| P3 | 独特性加在**类别层**：tag 页加数据派生概览 + 16 个相关标签交叉链接 | +1~2KB HTML/tag 页，**零新增 D1 查询** |

P2-3 的依据是 zh/ja 详情页**正文与 en 完全一致**（prompt 原文是英文，
只有 chrome 被翻译）。同时提交三份 = 告诉 Google「同样的内容给我三份 URL」。
zh/ja 页面**不会被移除或 noindex**，仍通过 hreflang 互指与全站内链被发现。
改回全语言提交只需改 `src/lib/sitemap-builders.ts` 的
`SITEMAP_PROMPT_LOCALES` 一个常量（子表清单由它推导，改完自动恢复）。

### 剩下的 286 条重复描述 / 23 组重复标题

属于**数据问题不是代码问题**，且看起来与你另一个 session 在跑的
`scripts/_fix_*.py` 是同一批，本次不动。

---

## 4. 执行顺序

```
P0-1 / P0-2   legacy-url.ts 修 bug + 补测      ← 纯降本，先做
   ↓（观察 24h 成本，确认无异常）
补测 §5.0 成本基线（D1 rowsRead / Workers 请求 / CDN 命中率）  ← 缺这一步不许进 P1
   ↓
P1-3  PAGE_SIZE 24 → 48
P1-4  详情页 related 6 → 12–16              ← 不新增 URL，先做这个
   ↓
P1-1 + P1-2  真实分页路径 + 深度上限 5       ← 有界，依赖上面两项已降本
   ↓
P2-1/2/3  sitemap 拆分 + lastmod 稳定 + 减量
   ↓
P3     单页独特性内容（长周期）
   ↓
GSC 对 4 个 Website 类 issue 点 Validate（404 / noindex / redirect / 5xx）
   ↓
4 周后复测：回填基线文档 §6 表，对比 84 → ? 的斜率
```

**部署纪律**：所有改动走 `src/...` → commit → push → build pipeline
生成 `.open-next/worker.js`。**禁止手动 `wrangler deploy` 手工拷贝的目录。**

---

## 5. 成本护栏（硬约束，先看这节再动代码）

### 4.1 已知的成本风险点

| 风险 | 说明 | 依据 |
|---|---|---|
| **R1 分页展开** | 解除 deep 页死区 → 可抓取 URL 激增 → 完整 SSR → Error 1102 | `robots.ts:4-15` 历史事故 |
| **R2 尾部 slash 308** | 每个旧 URL 都吃一次 Worker 调用 | `48b9d32` 提交说明 |
| **R3 legacy-prompt 查库** | 4,265 个 404 每个一次 D1 存在性查询 | `middleware.ts:62-68` |
| **R4 sitemap 体积** | 4.5MB 单表，每次拉取都要 Worker 构造 21,429 个对象 | `sitemap.ts:29-30` 记录过 Error 1102 |
| **R5 PAGE_SIZE 提升** | 每页 D1 rows read 翻倍 | `queries.ts` rows 直查 D1 |

### 4.2 硬上限（超过就必须停）

| 护栏 | 阈值 | 动作 |
|---|---|---|
| G1 可抓取 URL 净增 | **≤ 1,500** | 超过就下调 P1-2 深度上限 |
| G2 D1 `rowsRead` / 24h | **≤ 基线 × 2** | 超过就回退 P1-3 |
| G3 Workers 请求数 / 24h | **≤ 基线 × 1.5** | 超过就回退 P1-1 |
| G4 Worker CPU / Error 1102 | **0 次** | 出现即刻回滚当批 |
| G5 单页 TTFB | **≤ 基线 2s** | 超过就检查 SSR 体积 |

### 4.3 分页的成本设计要求（**P1-1 实现时必须满足**）

新增的 `/p/N` 分页页**不得**走完整 SSR：

1. 复用同一份 `listPrompts` 结果，**不要**再额外调 `listAllTags()`（当前 `page.tsx:39` + `:104` 已重复调了两次）
2. 分页页 `Header` 的 `tagOptions` 必须走 `HEADER_TAG_LIMIT` 截断
   （`page.tsx:99-100` 注释已记录全量 tag 曾占 HTML 77%）
3. 分页页的 D1 查询必须是**可缓存**的（namespace version 24h TTL，遵循 `AGENTS.md` 的 24h 铁律，
   **不要用 5min 默认 TTL**）
4. 中间页可考虑"轻量 Header"变体，砍掉不必要的客户端组件序列化

### 4.4 灰度与回滚

- P1 全部改动**一次只上 1 项**，间隔 ≥24h 并对比 §4.2 护栏
- `src/lib/legacy-url.ts` 有单测 → P0 必须测试通过再合
- P1-1/P1-2 上线后在 GSC 观察 `Server error (5xx)` 与 `Blocked by robots.txt` 两桶
- 任一护栏破线 → 单项 revert（这些改动互相独立，可单独回退）

### 4.5 明确不做的事

| 不做 | 原因 |
|---|---|
| 重新开启 Workers Cache(L2) | `43948b8` 已因成本关闭，变量过多无法归因，需独立实验 |
| 一次性把 4,743 孤儿全部暴露 | 当前 0.22% 收录率下会换来等量的 "Discovered - not indexed" |
| 继续往 sitemap 加 URL | 逆势而行，会进一步稀释抓取预算 |
| 给 GSC 两个 Google systems 桶点 Validate | 那是结果不是可修 issue，点了没有意义 |

---

## 6. 预期（诚实版）

**不做 P3，索引量不会有质变。** 理由：13,053 条 "Crawled - not indexed"
是 Google 爬完后的质量判决，P0/P1/P2 修的是"可发现性"和"提交面整洁度"，
只能改善 19,530 "Discovered" 那一桶和 4,265 404 桶。

现实预期区间（4 周后）：

| 场景 | Indexed 预期 |
|---|---|
| 只做 P0 | 84 → ~90（修 bug 本身不直接带来收录） |
| P0 + P1 + P2 | 84 → 300 ~ 800（把 4,743 孤儿里的一部分变成可发现且值得收录） |
| + P3 持续 1–2 个季度 | 才有可能上千 |

**判断依据**：一个 0.22% 收录率的站点，Google 给的爬取预算极少；
先把质量分和内链结构修对，比急着铺 URL 重要一个数量级。

---

## 7. 待确认

1. ~~§5.0 成本基线必须先人工补测~~ → **仍未补测**（`wrangler` OAuth 过期 + CF Dashboard 在本网络卡加载）。
   P1 是在**用户明确指示下带着这个缺口开工**的，风险改用"设计内建护栏"兜底
   （深度上限 3、SSR 复用、零新增 D1 查询）。**P2 开始前必须补上。**
2. ~~P1-2 的分页深度上限 5~~ → 用户已确认按成本优先取 **3**。
3. ~~models 分页要不要一起改~~ → 用户已确认**一起改，深度同样 3**，已实施。
4. **上线后 24h 内必看**：Worker CPU（tag 页 HTML 变大是 Error 1102 的同类风险）、
   D1 `rowsRead/24h`、GSC `Server error (5xx)` 与 `Blocked by robots.txt` 两桶。
