# SEO 复测 — 2026-10-18（第 4 次复测）

> 复测流程依据 [`SEO-INDEXATION-BASELINE-2026-10-08.md`](./SEO-INDEXATION-BASELINE-2026-10-08.md) §5。
> 计划核对依据 [`SEO-INDEXATION-PLAN.md`](./SEO-INDEXATION-PLAN.md) §0.5 / §3。
>
> - 采集时间：2026-10-18 19:24 – 19:45 CST（UTC 11:24 – 11:45）
> - 采集方式：**只读审计**。未改任何 `src/` 文件，未部署，未跑 `npm run build`，未使用 `opencli browser`。
> - 采集人：`site-audit`（team member）
> - 采集侧：CN 经代理，`cf-ray` 落 **EWR**
> - 本地 HEAD：`89fbee3`（branch `main`）
> - **线上部署 commit：❌ 未取到** —— 站点无 version/commit 端点，响应头只有 `x-opennext: 1` / `x-powered-by: Next.js`，无 commit 标记。仅能从行为反推（见 §9）。

### 与 Lead 实测的分工（2026-10-18）

Lead 已独立实测并确认以下各项，**本文档直接引用**（标为「Lead 实测，2026-10-18」），
本次 `site-audit` 的独立实测结果与之一致（差异仅在采样路径，见备注）：

| 项 | Lead 实测（2026-10-18） | 本文档独立实测 | 是否一致 |
|---|---|---|---|
| legacy `/ja/prompts/2026-02/{slug}/` | 200 / 2 跳 → `/ja/prompts/{slug}` | 首跳 308，终态 200 / 2 跳 → 同 | ✅ |
| legacy `/ja/ja/prompts/...` | 200 / 2 跳（P0 已修） | 首跳 308，终态 200 / 2 跳 | ✅ |
| legacy `/zh-cn/zh-cn/prompts/...` | 200 / 2 跳 → `/zh/prompts/{slug}` | 首跳 308，终态 200 / 2 跳 | ✅ |
| legacy `/zh-cn/tags/group-scene/` | 200 / 2 跳 → `/zh/tags/group-scene` | 首跳 308，终态 200 / 2 跳 | ✅ |
| `/en/tags/cinematic/p/2`、`/p/3` | 200，无 robots meta，self-canonical | 同 | ✅ |
| `/en/tags/cinematic/p/4` | **404**（深度上限 3 生效） | 同 | ✅ |
| `/en/models/seedance2/p/2` | 200，self-canonical | 另测 `/en/models/seedance25/p/2` → 200 self-canonical；`/p/4` → 404 | ✅ |
| `robots.txt` | 仍封 `?page=`/`?tag=`/`?model=`/`?q=`，声明 sitemap | 线上 `robots.txt` 逐行核对一致 | ✅ |
| `/sitemap.xml` | **sitemapindex**，3 子表 `tags 996 + models 75 + static 12 = 1,083` | 同（并列出各子表组成） | ✅ |
| `prompts-en/zh/ja.xml` | 各 7,289 条、200 可访问，**不在 index** —— `sitemap-builders.ts:84` `SUBMIT_PROMPT_DETAIL_PAGES = false`（10-15 有意决策，非 bug） | 同（并给出 `:64` / `:84` / `:91-103` 的推导链） | ✅ |
| **GSC：Discovered** | **1,083**（10-18 重新读取，Sitemaps 报告 Success） | 未采集 GSC（gsc session 归 lead） | 采信 Lead |
| 孤儿 prompt 数 | 未取到（本次唯一缺口） | ✅ **已完成全量实测**（见 §3） | 本文档补上 |

> **备注**：Lead 建议「若全量抓 996 个 tag 页太慢可抽样 80 个 tag」——
> 本次实际在 5 分钟内完成了**全量抓取**（332 个 en tag 第 1 页 + 159 个 `/p/N` 分页页，共 491 请求，0 超时），
> 所以 §3 的孤儿数是**实测全量，不是抽样估算**。（"996" 是 3 个 locale 的 tag 子表条数，
> en 维度只有 332 个 tag。）

---

## 0. 结论摘要（先看这 6 条）

1. **孤儿 prompt 大幅下降**：`4,743 / 6,804 = 69.7%` → **`1,119 / 7,289 = 15.4%`**（跟随 `/p/N` 抓取口径）。**P1 分页死区修复确认生效**，这是本次复测最重要的正向变化。
2. **legacy 双前缀 404 已修复**：4 个 URL **全部终态 200**，基线目标 `200/200/200/200` 达成。
3. **sitemap 提交面比计划声称的更激进**：P2-3 声称「只提交 en 详情页」，**实测一条详情页都没提交**。`SUBMIT_PROMPT_DETAIL_PAGES = false`（`sitemap-builders.ts:84`，2026-10-15 `de9b8e7`）把 prompt 子表整个从 index 里摘掉了 —— 实际提交量 **1,083**，不是计划里的 ~7,900。`prompts-en/zh/ja.xml` 路由仍在线（各 200 / 7,289 条）但**不在 index 里**。
4. **`/p/N` 分页路径线上可用且自指 canonical、无 noindex**；`p/4`（超深度上限）与内容过薄末页一律 404，成本护栏按设计生效。
5. **Workers Cache 确认生效**：抽样 9 条路径，除静态资源外**全部 `cf-cache-status: HIT` 且带 `age`**（10-08 基线时响应头里连 `cf-cache-status` 都没有）。
6. ⚠️ **一个需要 lead 关注的数据异常**：`/en/tags` 的 tag 规模分布整体缩水 —— tag-prompt 关联总数 `109,596 → 29,821`，头部 tag `360` 从 **3,604 → 4**。索引页计数与页面实际渲染条数已逐条交叉验证一致（§6.3），所以**不是抓取错误**，是**数据侧变化**，本任务范围内无法归因。

---

## 1. 抓取口径（重要：不写清就会严重低估可达数）

任务明确提示：P1 已把 `PAGE_SIZE` 24→48 并新增 `/{locale}/tags/{tag}/p/{page}` 真实分页路径，
**只抓 tag 第 1 页会严重低估可达数**。本次采用分层口径，四层分别记录：

| 层 | 范围 | 请求数 | 说明 |
|---|---|---|---|
| **Tier A** | 332 个 `/en/tags/*` 第 1 页 | 332 | 与 10-08 基线口径**完全对齐**（基线只有这一层，PAGE_SIZE 当时是 24） |
| **Tier B** | A + **跟随 `/p/N`** 抓到的 159 个分页页 | 491 | **本次主口径**，P1-1/P1-2 的正确读数 |
| **Tier C** | B + 25 个 `/en/models/*` + 14 个 model `/p/N` + 4 个静态页（`/en`、`/en/tags`、`/en/models`、`/en/about`） | 534 | 站内**类别页**全闭包 |
| **Tier D** | C + 详情页 `related`/上下篇一跳 | 抽样 400 页 | ⚠️ **抽样估算，非全量**（见下方"刻意没做"） |

**`/p/N` 的发现方式**：不是猜的，是**解析第 1 页 HTML 里的真实 `<a href>`**：

```bash
grep -oh 'href="[^"]*/p/[0-9]*"' tags/*.html | sed 's|href="||;s|"$||' | sort -u
```

**深度上限**：`TAG_PAGE_MAX_DEPTH = 3` / `MODEL_PAGE_MAX_DEPTH = 3`（`src/lib/pagination.ts:44,58`），
即每个 tag 最多 `p/2 … p/3`（48 × 3 = 144 条）。第 1 页的 `pageWindow` 会同时渲染 `p/2` 与 `p/3` 链接，
所以从第 1 页出发一跳即可覆盖全部合法分页页 —— **无需递归爬**。

**抓取面自校验（很强的一条证据）**：把索引页计数代入 `src/lib/pagination.ts` 的
`lastUsablePage()` 规则（48 条/页、深度 ≤3、末页 <12 条则不生成）推导"应该存在多少分页链接"，
与实测抓到的链接**完全相等，零差异**：

```
expected tags with pagination: 94   expected links: 159
discovered tags: 94                 discovered links: 159
expected but not discovered: []
discovered but not expected: []
```

说明线上跑的就是当前代码里的分页/深度/薄页规则，抓取口径无遗漏。

**刻意没做的事（成本考虑，非遗漏）**：Tier D 的**全量**一跳闭包需要再抓 6,170 个详情页
（每个 MISS 都是一次完整 SSR）。AGENTS.md 记录本站 CPU 是唯一超预算项、`robots.ts` 里有
Error 1102 事故史，因此只做 **400 页随机抽样**（seed `20261018`）估算，并在表中明确标注为估算。

**所有请求参数**：`curl -sS --max-time 45`，批量用 `xargs -P 8~12`，UA `Mozilla/5.0 (compatible; SEORecheck/1.0)`。
930 次成功请求，0 次超时。

---

## 2. 核心指标表

| 指标 | 10-08 基线 | 10-15 | **10-18 实测** | Δ vs 基线 | 判断 |
|---|---|---|---|---|---|
| **sitemap en prompts（分母）** | 6,804 | — | **7,289** | +485 | 已发布量自然增长 |
| **可达（Tier A，tag p1，口径对齐）** | 2,061 | 未重测 | **4,096** | **+2,035** | ✅ PAGE_SIZE 24→48 生效 |
| **可达（Tier B，含 `/p/N`）** | 未测 | 未重测 | **6,170** | — | ✅ **本次主口径** |
| 可达（Tier C，+ models/static） | 未测 | 未重测 | **6,297** | — | ✅ |
| **孤儿数（Tier A）** | **4,743** | 未重测 | **3,193** | −1,550 | ✅ 改善 |
| **孤儿数（Tier B，主口径）** | — | 未重测 | **1,119** | — | ✅ **改善 76.4%** |
| 孤儿率（Tier A） | 69.7% | — | **43.8%** | −25.9pt | ✅ |
| **孤儿率（Tier B，主口径）** | 69.7% | — | **15.4%** | **−54.3pt** | ✅ **核心成果** |
| 孤儿数（Tier C） | — | — | 992 | — | ✅ 孤儿率 13.6% |
| tag 数 | 313 | — | **332** | +19 | 数据侧 |
| tag 规模 median | 19 | — | **15.5** | −3.5 | ⚠️ 见 §6.3 |
| tag 规模 p75 | 80 | — | **77.25** | −2.75 | ≈ 持平 |
| tag 规模 p90 | 188 | — | **194.8** | +6.8 | ≈ 持平 |
| tag 规模 max | 4,511 | — | **4,909** | +398 | 头部继续增长 |
| tag-prompt 关联总数 | ≈109,596 | — | **29,821** | **−72.8%** | ⚠️ **异常，见 §6.3** |
| sitemap 提交 URL 总数 | 21,429 | 8,019（GSC 侧） | **1,083** | **−94.9%** | ✅ 收敛提交面；GSC 侧确认 Discovered **1,083**（Lead 实测 10-18） |
| sitemap 形态 | urlset（4.5MB 单表） | sitemapindex | **sitemapindex（3 子表）** | — | ✅ |
| legacy 矩阵终态 | 200/404/404/200 | 未重测 | **200/200/200/200** | ✅ **目标达成** | ✅ P0 生效 |
| Indexed（GSC） | 84 | 21 | **❌ 未取到** | — | gsc session 归 lead |
| Not indexed（GSC） | 37,374 | 37.8K | **❌ 未取到** | — | 同上 |
| 404 / noindex / Soft 404（GSC） | 4,265 / 220 / 161 | 3,822 / 202 / 173 | **❌ 未取到** | — | 同上 |
| Crawled-not-indexed（GSC） | 13,053 | 13,046 | **❌ 未取到** | — | 同上 |
| Discovered-not-indexed（GSC） | 19,530 | 20,421 | **❌ 未取到** | — | 同上 |
| D1 rowsRead / 24h | ❌ 未取到 | ❌ 未取到 | **❌ 未取到** | — | wrangler OAuth 过期（见 §10） |
| CDN 缓存状态 | inconclusive（无 `cf-cache-status`） | HIT（`age: 15`） | **HIT（`age` 241–15,382）** | — | ✅ 已可判定 |

> 10-15 列的 GSC 数字**引自基线文档 §6**，不是本次实测，仅作对照；本次未采集 GSC。

---

## 3. §5.2 孤儿 prompt 数

### 3.1 复现命令（本次实际使用的版本）

```bash
mkdir -p /tmp/avp-recheck && cd /tmp/avp-recheck

# 0) 分母：已发布 en prompt 全集
curl -sS --max-time 60 https://awesomevideoprompts.com/sitemap.xml -o sitemap.xml   # index（已不含 prompt 子表）
curl -sS --max-time 60 https://awesomevideoprompts.com/sitemaps/prompts-en.xml -o prompts-en.xml
# ⚠️ 关键：基线 §5.2 的 `grep .../en/prompts/ avp-sitemap.xml` 现在会返回 0 条，
#    因为 2026-10-15 de9b8e7 把 prompt 子表从 sitemapindex 摘掉了（见 §7）。
#    分母改用仍然在线、内容等价的 /sitemaps/prompts-en.xml。

# 1) tag 列表（来自 /sitemaps/tags.xml）
grep -o 'https://awesomevideoprompts.com/en/tags/[^<]*' sitemap.xml >/dev/null   # index 里没有
curl -sS --max-time 60 https://awesomevideoprompts.com/sitemaps/tags.xml -o tags.xml
grep -o 'https://awesomevideoprompts.com/en/tags/[^<]*' tags.xml | sort -u > tags_en.txt   # 332 条

# 2) Tier A：tag 第 1 页
mkdir -p tags
while read -r u; do echo "$u tags/${u##*/}.html"; done < tags_en.txt > job1.txt
cat job1.txt | xargs -n2 -P 10 ./fetch.sh     # fetch.sh: curl -sS --max-time 45 -A '...' "$1" -o "$2"

# 3) Tier B：跟随第 1 页里的 /p/N 链接
grep -oh 'href="[^"]*/p/[0-9]*"' tags/*.html | sed 's|href="||;s|"$||' | sort -u > pagelinks.txt  # 159 条
mkdir -p pages
while read -r u; do echo "https://awesomevideoprompts.com$u pages/$(echo "${u#/en/tags/}" | tr '/' '_').html"; done < pagelinks.txt > job2.txt
cat job2.txt | xargs -n2 -P 10 ./fetch.sh

# 4) 集合比对
python3 - <<'PY'
import re,glob
def slugs(fs):
    s=set()
    for f in fs:
        s|=set(re.findall(r'href="/en/prompts/([^"#?]+)"', open(f,encoding='utf-8',errors='ignore').read()))
    return s
sm=set(re.findall(r'<loc>https://awesomevideoprompts\.com/en/prompts/([^<]+)</loc>', open('prompts-en.xml',encoding='utf-8').read()))
A=slugs(glob.glob('tags/*.html')); B=A|slugs(glob.glob('pages/*.html'))
print('denominator:',len(sm))
print(f'TierA reachable={len(A&sm)} orphan={len(sm-A)}')
print(f'TierB reachable={len(B&sm)} orphan={len(sm-B)}')
PY
```

### 3.2 实测结果（**全量，非抽样**）

> 抓取面：**332 个 en tag 全部**（不是抽样 80 个）+ **159 个 `/p/N` 分页页**，共 491 请求，0 超时。
> 深度上限 3（`p/2`…`p/3`），从第 1 页 HTML 里的真实 `<a href>` 跟随发现，无遗漏（§1 自校验零差异）。

```
denominator (sitemap en prompts)      : 7289
TierA tag p1 only                     : 4096  orphan=3193   (43.8%)
TierB tag p1 + tag /p/N               : 6170  orphan=1119   (15.4%)   ← 主口径
TierC B + models(all) + static        : 6297  orphan=992    (13.6%)

tag1 pages crawled: 332 (330 文件，2 个大小写同名冲突已单独补抓)   tag paged: 159
model p1: 25   model paged: 14
每页 prompt 链接数：tag p1 median=16 / max=48 ；tag p/N median=48 / min=14 / max=48
```

> `min=14` 正好等于 `MIN_PAGE_ITEMS = 12` 之上 —— 薄页剔除规则在生效（`pagination.ts:80,96`）。

### 3.3 Tier D（详情页内链闭包，**抽样估算**）

400 页随机抽样（其中 388 页本身属于 Tier B 可达集）：

```
sample: 400 页  →  抓到 1,430 个 prompt 链接
其中不在 Tier B 集合内的「新」slug：96 个
每个可达详情页的新孤儿产出率：96 / 388 = 0.25
朴素外推到 6,170 个可达详情页：+1,526，但剩余孤儿只有 1,119 → 上限即 1,119
```

**结论（估算，非实测）**：`related` 12 条 + 上下篇的内链，**大概率能把 Tier B 剩下的 1,119 条孤儿再吃掉相当一部分**。
但这只是抽样外推 —— 想拿到精确值需要再抓 6,170 页详情页，本次**为控制 Worker CPU 刻意没做**（理由见 §1）。

---

## 4. §5.3 legacy URL 矩阵

### 4.1 复现命令

```bash
for u in \
"https://awesomevideoprompts.com/ja/prompts/2026-02/2019515197501603840-sanity-soup-factory-interview/" \
"https://awesomevideoprompts.com/ja/ja/prompts/2026-02/2019515197501603840-sanity-soup-factory-interview/" \
"https://awesomevideoprompts.com/zh-cn/zh-cn/prompts/2026-02/2021909649314770944-hyperspeed-fpv-diving-collapsing-coastal-cliff/" \
"https://awesomevideoprompts.com/zh-cn/tags/group-scene/" ; do
  printf "first-hop=%-4s " "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 25 "$u")"
  curl -sS -o /dev/null -L -w "final=%{http_code} hops=%{num_redirects} end=%{url_effective}\n" --max-time 40 "$u"
done
```

### 4.2 实测结果（2026-10-18）

| # | 旧 URL | 首跳 | 终态 | hops | 最终落点 |
|---|---|---|---|---|---|
| 1 | `/ja/prompts/2026-02/{slug}/` | 308 | **200** | 2 | `/ja/prompts/{slug}` |
| 2 | `/ja/ja/prompts/2026-02/{slug}/` | 308 | **200** | 2 | `/ja/prompts/{slug}` |
| 3 | `/zh-cn/zh-cn/prompts/2026-02/{slug}/` | 308 | **200** | 2 | `/zh/prompts/{slug}` |
| 4 | `/zh-cn/tags/group-scene/` | 308 | **200** | 2 | `/zh/tags/group-scene` |

**P0 目标 `200/200/200/200` 达成 ✅。** 基线里 #2、#3 是终态 404 的 BUG，现已分别
308（去尾斜杠，CF 边缘直接返回）→ 301（双前缀折叠 + 旧→新）→ 200。

> ⚠️ **基线矩阵存在口径不一致，值得记一笔**：基线 §5.3 记的是 `200 / 404 / 404 / 200`，
> 但同文档 §3 的表格写的是 `/ja/prompts/2026-02/{slug}/` → **2 hops** → 200。
> 一个 2 跳的链路，首跳不可能是 200（首跳必然是 308 或 301）。也就是说
> **基线 §5.3 的 4 个数字混用了"首跳码"和"终态码"两种口径**。
> 本次两种口径都记了：首跳 `308/308/308/308`，终态 `200/200/200/200`。
> 用终态口径才能与目标值比较。

---

## 5. §5.4 tag 规模分布

### 5.1 复现命令

```bash
curl -sS --max-time 40 "https://awesomevideoprompts.com/en/tags" -o tagidx.html
python3 - <<'PY'
import re,statistics,math
h=open('tagidx.html',encoding='utf-8').read()
pat=re.compile(r'href="/en/tags/([^"/]+)">.{0,200}?tag-count[^>]*>\s*([\d,]+)', re.S)
d={}
for m in pat.finditer(h):
    if m.group(1) not in d: d[m.group(1)]=int(m.group(2).replace(',',''))
v=sorted(d.values()); n=len(v)
def pct(p):
    k=(n-1)*p; f=math.floor(k); c=math.ceil(k)
    return v[f] if f==c else v[f]+(v[c]-v[f])*(k-f)
print(f"tags={n} min={v[0]} median={statistics.median(v):g} p75={pct(.75):g} p90={pct(.90):g} max={v[-1]}")
print({t:d.get(t) for t in ['cinematic','360','action']}, 'sum=',sum(v))
PY
```

### 5.2 实测结果

```
tags = 332
min 1 | median 15.5 | p75 77.25 | p90 194.8 | max 4,909
cinematic 4,909 | 360 4 | action 2,221
tag-prompt 关联总数 = 29,821
tags >48 条 = 105 个（>96 = 69 个，>144 = 53 个）
```

| 指标 | 10-08 基线 | 10-18 实测 | Δ |
|---|---|---|---|
| tag 数 | 313 | **332** | +19 |
| median | 19 | **15.5** | −3.5 |
| p75 | 80 | **77.25** | −2.75 |
| p90 | 188 | **194.8** | +6.8 |
| max | 4,511 | **4,909** | +398 |
| cinematic | 4,511 | **4,909** | +398 |
| 360 | 3,604 | **4** | **−3,600** ⚠️ |
| action | 2,108 | **2,221** | +113 |
| 关联总数 | ≈109,596 | **29,821** | **−72.8%** ⚠️ |

### 5.3 计数可信度交叉验证（三层，全部通过）

因为 §5.2 的分布与基线差异较大，本次对索引页计数做了独立验证：

1. **小 tag 逐条比对**：索引计数 ≤48 的 tag，其第 1 页实际渲染的 `/en/prompts/` 链接数
   → `match=225 / mismatch=4`，4 个 mismatch **全部**是 macOS 大小写不敏感导致的
   `POV`/`pov`、`VFX`/`vfx` 文件覆盖（已单独补抓核对），**无真实不一致**。
2. **中 tag 分页比对**：索引计数 ∈[49,144] 的 tag，其 `/p/N` 页应渲染 `count-(N-1)*48` 条
   → **`match=37 / mismatch=0`**。
3. **分页链接集合比对**：由索引计数 + `lastUsablePage()` 推导的应有分页链接，
   与实测抓到的 159 条**完全相等**（§1）。

**结论**：索引页计数是可信的，`29,821` / `360 → 4` 不是抓取或解析错误。

**归因说明（诚实版）**：`360` 这个 tag 当前页面上确实只有 4 条 prompt，且都是真·360 相关内容
（`...-kling-love-these-videos...`、`...-yellow-sports-car-360-orbit`、`...-bullet-time-nyc-slip`、
`...-360-drone-shot-grok`）。从 3,604 → 4 只可能是**数据侧**的 tag 重新归一/清理
（工作区里有大量未提交的 `scripts/_fix_*.py` 数据修复脚本）。
**本任务只读、且不碰数据库，无法归因到具体哪次数据操作** —— 建议 lead 确认这是否为预期清理。

---

## 6. sitemap 现状（P2-1 / P2-2 / P2-3 核对）

### 6.1 复现命令

```bash
curl -sS --max-time 60 -D - https://awesomevideoprompts.com/sitemap.xml -o sitemap.xml
grep -o '<loc>[^<]*' sitemap.xml                      # index 的子表清单
for s in tags models static prompts-en prompts-zh prompts-ja; do
  curl -sS --max-time 60 -w "$s http=%{http_code} locs=" -o $s.xml https://awesomevideoprompts.com/sitemaps/$s.xml
  grep -c '<loc>' $s.xml
done
```

### 6.2 实测结果

**`/sitemap.xml` 是 `<sitemapindex>`（不是 urlset）**，且**只有 3 个子表**：

| 子表 | URL 条数 | 组成 | 在 index 里？ |
|---|---|---|---|
| `/sitemaps/tags.xml` | **996** | 332 tag × 3 locale | ✅ |
| `/sitemaps/models.xml` | **75** | 25 model × 3 locale | ✅ |
| `/sitemaps/static.xml` | **12** | 3 首页 + 9 about/tags/models 索引页 | ✅ |
| **提交总量** | **1,083** | | |
| `/sitemaps/prompts-en.xml` | 7,289 | 全部 en 详情页 | ❌ **不在 index** |
| `/sitemaps/prompts-zh.xml` | 7,289 | 全部 zh 详情页 | ❌ **不在 index** |
| `/sitemaps/prompts-ja.xml` | 7,289 | 全部 ja 详情页 | ❌ **不在 index** |

**GSC 侧交叉确认（Lead 实测，2026-10-18）**：GSC Sitemaps 报告 10-18 重新读取后
**Discovered = 1,083**，状态 Success —— 与本地解析出的 1,083 **完全一致**，
说明 `de9b8e7` 的「提交面砍到 ~1,050」已在 Google 侧确认生效。

index 响应头：`cf-cache-status: HIT`，`lastmod` 全部 `2026-10-18`。

### 6.3 核对结论

- **P2-1「拆成 sitemapindex + 子表」→ ✅ 生效**（`f8fcafe`）。
- **P2-2「tag/model 省略 lastModified」→ ✅ 生效**：`tags.xml` / `models.xml` / `static.xml`
  里 `lastmod` 出现 **0 次**；`prompts-en.xml` 里 **7,289 次**（详情页保留真实 lastmod）。
  与 `src/lib/sitemap-builders.ts:143-172` 的策略一致。
- **P2-3「只提交 en 详情页」→ ❌ 未生效（已被更激进的后续改动取代）**。
  `SITEMAP_PROMPT_LOCALES = ['en']`（`sitemap-builders.ts:64`）**在代码里确实还在**，
  但它现在**不起作用**，因为 `SUBMIT_PROMPT_DETAIL_PAGES = false`（`:84`，2026-10-15 `de9b8e7`），
  `SITEMAP_CHILDREN`（`:91-103`）因此推导出 **0 个 prompt 子表**。
  → 实际状态是「**提交面只剩类别页，一条 prompt 详情页都不提交**」，提交量 1,083
  （`de9b8e7` 提交说明里的 "~1,050" 与实测 1,083 吻合，差值来自期间新增 tag/model）。

> 这一条对 GSC 侧的影响需要注意：`prompts-*.xml` 路由仍返回 200，
> 如果 GSC 之前已提交过这些子表 URL，Google 可能仍在直接读取它们。
> 本任务只读、未访问 GSC，**无法确认 Google 侧当前实际读取的子表清单**。

---

## 7. 线上分页路径可用性实测

### 7.1 复现命令

```bash
for u in /en/tags/cinematic /en/tags/cinematic/p/2 /en/tags/cinematic/p/3 /en/tags/cinematic/p/4 \
         "/en/tags/cinematic?page=2" /en/models/seedance25/p/2 /en/models/seedance25/p/4 /en/tags/wuxia/p/2; do
  printf "%-38s " "$u"
  curl -sS --max-time 40 -D hdr -o body -w 'http=%{http_code} bytes=%{size_download} cf=%header{cf-cache-status}\n' \
    "https://awesomevideoprompts.com$u"
  grep -o '<link rel="canonical" href="[^"]*"' body | head -1
  grep -o '<meta name="robots" content="[^"]*"' body | head -1
done
```

### 7.2 实测结果

| 路径 | http | canonical | robots meta | cf-cache | 判定 |
|---|---|---|---|---|---|
| `/en/tags/cinematic` | 200 | self（`/en/tags/cinematic`） | 无 | EXPIRED | ✅ |
| `/en/tags/cinematic/p/2` | **200** | **self（`/en/tags/cinematic/p/2`）** | **无 noindex** | MISS | ✅ **独立 canonical，非回指 page 1** |
| `/en/tags/cinematic/p/3` | **200** | self（`.../p/3`） | 无 | MISS | ✅ |
| `/en/tags/cinematic/p/4` | **404** | — | `noindex`（404 页自带） | MISS | ✅ **超深度上限，正确 404** |
| `/en/tags/cinematic?page=2` | **301** | — | — | MISS | ✅ `location: /en/tags/cinematic/p/2` |
| `/en/models/seedance25/p/2` | **200** | self（`.../p/2`） | 无 | EXPIRED | ✅ |
| `/en/models/seedance25/p/4` | **404** | — | `noindex` | MISS | ✅ |
| `/en/tags/wuxia/p/2` | **404** | — | `noindex` | MISS | ✅ `MIN_PAGE_ITEMS` 薄页剔除生效 |
| `/en/models/seedance25?page=2` | **301** | — | — | — | ✅ → `/en/models/seedance25/p/2` |
| `/en/models/seedance25?tag=cinematic` | 200 | — | **`noindex, follow`** | — | ✅ faceted 面按设计继续 noindex |

**可见分页控件已渲染**（`src/components/Pagination.tsx:39` 生成 `${basePath}/p/${p}`）：

```html
<!-- /en/tags/cinematic/p/2 -->
<a class="tag-pagination__step" rel="prev" href="/en/tags/cinematic">
<a class="tag-pagination__step" rel="next" href="/en/tags/cinematic/p/3">
<!-- 第 1 页同时渲染 p/2 与 p/3 -->
href="/en/tags/cinematic/p/2"  href="/en/tags/cinematic/p/3"
```

`PAGE_SIZE = 48` 线上确认：`/en/tags/cinematic/p/1|p/2`、`/en/models/seedance25/p/2`
每页均渲染 **48** 条 `prompt-description-text`。

---

## 8. 代码核实（只读，逐项给出文件:行号）

| 检查项 | 当前值 / 结论 | 证据 |
|---|---|---|
| `SITEMAP_PROMPT_LOCALES` | `['en']` | `src/lib/sitemap-builders.ts:64` |
| **`SUBMIT_PROMPT_DETAIL_PAGES`** | **`false`** ← 使上一行失效 | `src/lib/sitemap-builders.ts:84`（2026-10-15） |
| `SITEMAP_CHILDREN` | 由开关推导；当前 = tags + models + static（3 条） | `src/lib/sitemap-builders.ts:91-103` |
| `PAGE_SIZE` | **48** | `src/lib/pagination.ts:26` |
| `TAG_PAGE_MAX_DEPTH` | **3** | `src/lib/pagination.ts:44` |
| `MODEL_PAGE_MAX_DEPTH` | **3** | `src/lib/pagination.ts:58` |
| `MIN_PAGE_ITEMS` | **12**（2026-10-15 新增，剔薄末页） | `src/lib/pagination.ts:80`，`lastUsablePage()` `:89-100` |
| `robots.ts` 是否仍封锁 `?page=` | **是，仍然封锁**（按计划刻意保留） | `src/app/robots.ts:39,43`（`/*?page=`、`/*&page=`），另封 `/api/`、`?tag=`、`?model=`、`?q=`；线上 `robots.txt` 实测一致 |
| `tags/[tag]/page.tsx` 是否还有 `index:false` | **没有了**。文件已瘦身为 35 行，只做参数校验 + `buildTagMetadata({page:1})` | `src/app/[locale]/tags/[tag]/page.tsx:26-34` |
| 分页页 metadata 是否 noindex | **没有 `robots` 字段**，canonical 带 `/p/N` | `src/lib/tag-page-metadata.ts:35-54`（全文 66 行无 `index:false`） |
| `legacy-url.ts` 双前缀折叠 | **折叠到不动点循环**（`for(;;)` + `continue`），别名 11 条、大小写不敏感 | `src/lib/legacy-url.ts:86-120`，别名表 `:41-53` |
| `?page=N` 收敛到 `/p/N` | tag 与 model 各一条分支，都 `Math.min(n, MAX_DEPTH)` 夹到上限 | `src/lib/legacy-url.ts:172-199` |
| `/[locale]/tags/[tag]/p/[page]` 路由 | **存在** | `src/app/[locale]/tags/[tag]/p/[page]/page.tsx` |
| `/[locale]/models/[model]/p/[page]` 路由 | **存在**（同构，深度同样 3） | `src/app/[locale]/models/[model]/p/[page]/page.tsx` |
| `related` 6 → 12 | **`RELATED_PER_PROMPT = 12`** | `src/db/queries.ts:876`，读侧 `:1047` |
| 列表页 description 摘要 | `LIST_DESCRIPTION_LIMIT = 180`，列表页三处传入（首页/API/tag/model） | `src/components/types.ts:92`，`TagPageView.tsx:42`、`ModelPageView.tsx:51`、`[locale]/page.tsx:94`、`api/prompts/route.ts:51` |
| P3 类别层独特性 | `<section class="tag-overview">` + 相关标签交叉链接**已渲染** | `src/components/TagPageView.tsx:87,142-172` |
| `/p/N` 是否进 sitemap | **不进**（按计划刻意不做） | `sitemap-builders.ts` 的 `SITEMAP_CHILDREN` 无 `/p/` 项；`tags.xml` 实测 996 条 = 332×3，无分页页 |

---

## 9. git 状态与线上部署 commit

```bash
git log --oneline -15
git branch --show-current          # main
for c in 48b9d32 f8fcafe df44318 259c1be de9b8e7; do
  git merge-base --is-ancestor $c HEAD && echo "$c on HEAD" || echo "$c MISSING"
done
```

本地 HEAD = **`89fbee3`**（`docs: 记录 2026-10-15 Workers CPU 优化基线与线上验收数据`），branch `main`。

| commit | 是否在 main | 日期 | 说明 |
|---|---|---|---|
| `48b9d32` | ✅ | 2026-10-06 | P0+P1：屏蔽 /api、尾斜杠 308、OG 尺寸、结构化数据 |
| `f8fcafe` | ✅ | 2026-10-09 | sitemap.xml 改 `<sitemapindex>` |
| `df44318` | ✅ | 2026-10-15 | Workers Cache + 列表页摘要 |
| `259c1be` | ✅ | 2026-10-15 | 剔除内容过薄的末页 |
| `de9b8e7` | ✅ | 2026-10-15 | 提交面砍到 ~1,050 + model/tag 页加深 |

**线上部署 commit：❌ 未取到。** 站点没有 version/commit 端点，
响应头只有 `x-opennext: 1` / `x-powered-by: Next.js` / `server: cloudflare`，无 commit 标记；
HTML 里 `_next/static/chunks/*` 是内容哈希，不能映射回 git commit。

**行为反推（间接证据，非直接读取）**：线上同时表现出
`MIN_PAGE_ITEMS`（`/en/tags/wuxia/p/2` → 404）、`SUBMIT_PROMPT_DETAIL_PAGES=false`（index 无 prompt 子表）、
`Workers Cache`（`cf-cache-status: HIT`）三项行为 —— 这三项分别来自 `259c1be` / `de9b8e7` / `df44318`，
**均在 2026-10-15**。因此线上部署**至少包含 `de9b8e7`**，但**无法确认是否恰好等于某个 commit**。

---

## 10. 成本 / 缓存观察（顺手记录，供成本分析）

### 10.1 缓存状态（10-08 基线时响应头连 `cf-cache-status` 都没有）

| 路径 | code | TTFB | 体积 | `cf-cache-status` | `age` |
|---|---|---|---|---|---|
| `/en` | 200 | 1.16s | 213,700 B | **HIT** | 1,634 |
| `/en/tags/cinematic` | 200 | 2.08s | 223,740 B | **HIT** | 560 |
| `/en/tags/cinematic/p/2` | 200 | 0.98s | 226,906 B | **HIT** | 560 |
| `/en/models/seedance25/p/2` | 200 | 1.02s | 218,763 B | **HIT** | 553 |
| `/en/prompts/{slug}` | 200 | 0.99s | 134,646 B | **HIT** | 241 |
| `/sitemap.xml`（index） | 200 | 3.97s | 497 B | **HIT** | 13,588 |
| `/sitemaps/tags.xml` | 200 | 0.97s | 145,453 B | **HIT** | 15,382 |
| `/robots.txt` | 200 | 1.04s | 239 B | **HIT** | 15,054 |
| `/favicon.svg`（网络地板对照） | 200 | 1.11s | 184 B | REVALIDATED | — |

**结论**：`df44318` 的 `[cache] enabled = true` **确认生效**（HIT + `age` 单调递增）。
所有页面 TTFB 落在 **0.97–2.08s**，与网络地板（`/favicon.svg` 1.11s）同量级
→ **与 10-08 的结论一致：TTFB 在本网络下无法区分缓存命中与否，但这次有 `cf-cache-status` 直接证据。**
`/sitemap.xml` 首测 3.97s（index 本身只有 497 B），是首次构造 + 缓存未热的抖动，第二次 `age` 已 13,588。

### 10.2 列表页摘要（`df44318` 声称项）线上验证

| 页面 | description span 数 | 解码后最大长度 | 以 `…` 结尾 |
|---|---|---|---|
| `/en/tags/cinematic`（p1） | **48** | 181 | 48/48 |
| `/en/tags/cinematic/p/2` | **48** | 181 | 47/48（1 条本身短于 180） |
| `/en/models/seedance25/p/2` | **48** | 181 | 48/48 |

**✅ 生效**：列表页只下发 180 字符摘要 + `…`，与 `LIST_DESCRIPTION_LIMIT = 180` 完全吻合。
详情页 `/en/prompts/{slug}` 仍有 **3 个** `<script type="application/ld+json">`，正文未截断 → ✅ 详情页零影响。

### 10.3 ❌ 未取到

| 项 | 状态 | 原因 |
|---|---|---|
| D1 `rowsRead` / 24h | ❌ 未取到 | `wrangler` OAuth 已过期，非交互 shell 无法刷新（与 10-08 / 10-15 同样受阻） |
| D1 查询次数 / 24h、top3 query | ❌ 未取到 | 同上 |
| Workers 请求数 / 24h、真实 CPU ms | ❌ 未取到 | 同上；CF Dashboard 在本网络下内容区空白 |
| CDN 缓存**命中率**（百分比） | ❌ 未取到 | 只能逐请求看 `cf-cache-status`，拿不到聚合命中率 |
| GSC 全部索引/Performance 指标 | ❌ 未取到 | 任务规定 `opencli browser gsc` session 归 lead，本次**未使用任何 opencli browser** |
| 线上部署 commit | ❌ 未取到 | 无 version 端点 / 响应头无 commit 标记（见 §9） |

---

## 11. 计划声称「已完成」vs 代码 / 线上实测 核对表

| 项 | 计划声称 | 代码证据 | 线上实测证据 | 判定 |
|---|---|---|---|---|
| **P0-1** | locale 折叠改为"到不动点"循环，修掉 `/ja/ja/…`、`/zh-cn/zh-cn/…` 404 | `legacy-url.ts:86-120`（`for(;;)`+`continue`） | `/ja/ja/prompts/…/` → 终态 **200**；`/zh-cn/zh-cn/prompts/…/` → 终态 **200** | ✅ **生效** |
| **P0-2** | locale 别名补齐至 11 个，大小写不敏感 | `legacy-url.ts:41-53` 共 **11** 条键，比较统一 `toLowerCase()` | `/zh-cn/tags/group-scene/` → 终态 200 | ✅ **生效** |
| **P1-3** | `PAGE_SIZE` 24 → **48**，抽到单一来源，替换 5 处硬编码 | `pagination.ts:26`；`queries.ts:207` 的 `limit = 24` 是**另一件事**（见备注） | tag p1 每页 **48** 条；model p2 每页 **48** 条 | ✅ **生效** |
| **P1-4** | related 6 → **12** | `queries.ts:876` `RELATED_PER_PROMPT = 12`，读侧 `:1047` | 抽样 400 详情页平均产出 **1,430** 条链接（≈3.6 条/页为**新** slug，含 related+上下篇） | ✅ **生效** |
| **P1-1** | 新增 `/{locale}/tags/{tag}/p/{page}` 与 models 对应路由 + **可见分页控件** | 两条路由文件均存在；`Pagination.tsx:39` 生成真实 `href` | `/p/2`、`/p/3` 均 **200** 且自指 canonical；第 1 页 HTML 里 **159** 条 `/p/N` 链接；`rel="prev"/"next"` 已渲染 | ✅ **生效** |
| **P1-2** | 深度上限 **5 → 3**（48 × 3 = 144 条/维度） | `pagination.ts:44,58` 均为 **3** | `/en/tags/cinematic/p/4` → **404**；`/en/models/seedance25/p/4` → **404** | ✅ **生效** |
| （P1 配套） | `?page=` 封锁保持不变，老参数 301 收敛到 `/p/N` | `robots.ts:39,43`；`legacy-url.ts:172-199` | `/en/tags/cinematic?page=2` → **301** `/p/N`；线上 `robots.txt` 仍 `Disallow: /*?page=` | ✅ **生效** |
| （P1 配套） | `/p/N` **不进 sitemap** | `sitemap-builders.ts:91-103` 无 `/p/` 项 | `tags.xml` = 996 条 = 332×3，无分页页 | ✅ **生效** |
| **P2-1** | sitemap 拆成 index + 子表，单次只构造 1/3~1/5 | `sitemap-builders.ts` 拆成 4 个 builder | `/sitemap.xml` = `<sitemapindex>`，3 子表；`tags.xml` 145 KB（原单表 4.5 MB） | ✅ **生效** |
| **P2-2** | tag/model **省略 lastModified** | `sitemap-builders.ts:143-172` 的 `toTagSitemapRows`/`toModelSitemapRows` 无 `lastModified` | `tags.xml`/`models.xml`/`static.xml` 中 `lastmod` 出现 **0** 次 | ✅ **生效** |
| **P2-3** | **只提交 en 的 prompt 详情页**（21,468 → ~7,900，−63%） | `SITEMAP_PROMPT_LOCALES = ['en']`（`:64`）**仍在**，但被 `SUBMIT_PROMPT_DETAIL_PAGES = false`（`:84`）**覆盖** | index 里 **0 个** prompt 子表；`prompts-en/zh/ja.xml` 仍 200 但**不在 index**；提交量 **1,083** | ❌ **未生效**（被 2026-10-15 `de9b8e7` 的"零详情页提交"取代，比计划更激进） |
| **P3** | 独特性加在类别层：tag 页加数据派生概览 + 相关标签交叉链接 | `TagPageView.tsx:87,142-172` | tag 页 HTML 含 `tag-overview` 段与相关标签链接 | ✅ **生效** |
| `259c1be` | 剔除内容过薄的分页末页，堵 Soft 404 | `pagination.ts:80,89-100` `MIN_PAGE_ITEMS = 12` | `/en/tags/wuxia/p/2` → **404**（count=49，末页仅 1 条） | ✅ **生效** |
| `df44318` ① | `[cache] enabled = true` | — | 9 条路径抽样**全部 HIT 且带 `age`** | ✅ **生效** |
| `df44318` ② | 列表页只下发 180 字符摘要 | `types.ts:92` + 4 处调用点 | tag/model 列表页 description **解码后 ≤181**（180+`…`），48/48 以 `…` 结尾 | ✅ **生效** |
| `df44318` ③ | 详情页零影响（正文 + JSON-LD 完整） | `queries.ts:171-175`（详情页不传 limit） | 详情页 **3** 个 JSON-LD、正文未截断 | ✅ **生效** |
| `de9b8e7` | 提交面砍到 ~1,050 条 + model/tag 页加深 | `SUBMIT_PROMPT_DETAIL_PAGES = false`；`toModelSitemapRows` priority 1.0 | 实测提交 **1,083** 条 | ✅ **生效** |

**备注（P1-3 的一处口径澄清）**：`src/db/queries.ts:207` 的 `limit = 24` 是
`listPrompts` 的**函数默认值**，不是被漏改的硬编码 —— 首页 / tag 页 / model 页 / `/api/prompts`
四个调用点都显式传 `limit: PAGE_SIZE`（`TagPageView.tsx:42`、`ModelPageView.tsx:51` 等），
线上每页实测 48 条可证。所以 P1-3「5 处硬编码已统一」成立，但**若未来有人直接调 `listPrompts()`
不传 limit，会静默拿到 24 条** —— 建议后续把默认值也改成 `PAGE_SIZE`（本次只读，未改）。

---

## 12. 观察与建议（超出 7 项必做内容，供 lead 决策）

1. ⚠️ **tag 关联总数 −72.8%、`360` 3,604→4**：数据侧变化，非代码侧。已用三层交叉验证排除抓取误差。
   建议确认是否来自 `scripts/_fix_*.py` 的 tag 归一化；若**非预期**，这可能是一次静默的数据损失。
2. ⚠️ **`/en` 首页的 hreflang 用了 `http://`**：响应头
   `link: <http://awesomevideoprompts.com/en>; rel="alternate"; hreflang="en"`。
   而 tag 页 / 详情页的 hreflang 都是 `https://`，canonical 也都是 `https://`。
   只有首页这一个入口是 http。基线 §2 记录 `Duplicate canonical = 0`，所以**不是当前主要矛盾**，
   但属于明显的一致性瑕疵（疑似首页 metadata 的 `metadataBase` 走了兜底）。
3. ℹ️ **`prompts-*.xml` 子表仍在线但不在 index**：如果 GSC 侧此前提交过这些 URL，
   Google 仍可能直接读取。本次未访问 GSC，**无法确认 Google 当前实际读取的子表清单**，
   建议 lead 在 GSC 的 Sitemaps 报告里核对「已提交的子表列表」是否还包含 `prompts-en.xml`。
4. ✅ **成本护栏未破线（就本次可测项）**：`/p/N` 全部 `cf-cache-status: HIT`，
   超深度请求直接 404（不产生额外可抓取面），提交面 1,083 条（G1 护栏 1,500 以内）。
   但 **G2/G3/G4（D1 rowsRead / Workers 请求数 / CPU）仍无数据**，需人工在 CF Dashboard 补测。
5. ℹ️ **Tier B 剩余 1,119 条孤儿的出口**：抽样显示详情页 related 一跳可再覆盖相当一部分（估算上限即 1,119）。
   若想彻底消掉，可考虑在 P3 里给这些孤儿补一条"同 model / 同 tag 邻近"入口，而**不需要**再放宽分页深度。

---

## 13. 交付与可复现性说明

- 本次所有原始产物保存在 `/tmp/avp-recheck/`（sitemap 副本、332 个 tag 页、159 个分页页、
  25 个 model 页、14 个 model 分页页、400 个抽样详情页、`fetch.status`）。
- **本次只写了 `docs/SEO-RECHECK-2026-10-18.md` 一个文件**，未修改任何 `src/` 文件，
  未执行部署，未跑 `npm run build`，未使用 `opencli browser`。
- 所有表格里的 10-18 列数字均为**本次实测**；未取到的项一律写「未取到」并说明原因，
  没有用基线值填充。
- 唯一标注为**估算**的是 §3.3 的 Tier D（抽样 400 页外推），已在该节显式标注。
