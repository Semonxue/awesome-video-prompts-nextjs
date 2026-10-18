/**
 * sitemap 构建器（2026-10-08 P2-1）
 *
 * 背景：原先 src/app/sitemap.ts 一个文件产出全部 21,429 条 URL，
 *   单次 Worker 调用要构造两万多个对象 —— 代码注释里明确记着这是
 *   Error 1102（Worker 资源超限）的复发源之一（2026-08-07 修过一次）。
 *
 * 拆成 sitemapindex + 4 个子表后：
 *   - 每次请求只构造自己那一份（prompt 表按 locale 再拆三份，降到原来的 1/3）
 *   - 可以只重点提交 en，把抓取预算集中给主力语言
 *   - 哪一块质量差一目了然
 *
 * 成本影响：**单次调用的 CPU/内存下降**，CDN 缓存条目 1 → 4（各自独立 8h 边缘缓存）。
 * 净效果是降本，不是增本。
 *
 * lastModified 策略（P2-2，2026-10-08）：
 *   - 详情页：prompt.updatedAt（真实更新时间）
 *   - tag/model/静态页：**省略**。
 *     原因：tag.updatedAt 取的是该分类下 prompts 的 max(updated_at)
 *     （见 queries.ts queryAllTags 的 `max(${prompts.updatedAt})`），
 *     站点每天发新 prompt → 930 个 tag 页的 lastmod 全天在跳。
 *     20,412 条详情页又是 changefreq:monthly 却带真实 updatedAt，两套信号打架，
 *     Google 只能按"高频变动 + 低独特性"处理。
 *     省略 lastmod 与静态页的处理一致（见本文件末尾注释）。
 */
import type { MetadataRoute } from 'next';
import { listAllSlugsForSitemap, listAllTags, listAllModels } from '@/db/queries';
import { getCachedData, CACHE_KEYS } from '@/db/cache';
import { locales } from '@/i18n/request';
import { SEO_INDEXABLE_LOCALES } from '@/lib/seo';
import { SITE_URL } from '@/lib/site';
import { toW3CDate } from '@/lib/date';

export const dynamic = 'force-dynamic';
export const revalidate = 86400;

/**
 * 哪些 locale 的 prompt 详情页进 sitemap（P2-3，2026-10-08）
 *
 * 决定只提交 en，依据是实测数据而不是偏好：
 *
 *   GSC Performance（部署后同日）：
 *     Total impressions 235 / Total clicks 4 / **Average position 6**
 *     有曝光的 query 只有 2 个，其中一个就是 `site:awesomevideoprompts.com`
 *     —— 也就是说站外几乎没有自然曝光，全站 rank 能力其实没问题（position 6），
 *     问题是**被要求收录的 URL 太多、且几乎没有搜索需求**
 *
 *   收录率 84 / 37,458 = 0.22%。让 Google 判定"这个站只值得收录 84 页"的
 *   主要压力来源，就是 20,412 条近零需求的长尾 prompt 页
 *   （slug 形如 `{推特id}-{通用描述}`，例如 temporary-tattoo-test-at-midnight，
 *    没人会拿这种词去搜）。
 *
 *   而 zh / ja 详情页的 **正文与 en 完全一致**（prompt 原文是英文，
 *   只有页面 chrome 被翻译）。同时提交三份等于告诉 Google
 *   "同样的内容给我三份 URL"，独特价值没有增加，请求索引的页面数却 ×3。
 *
 * 成本与收益：
 *   - 提交量 21,468 → ~7,900（**-63%**），Google 侧的抓取/评估压力同比下降
 *   - zh / ja 页面**不会被移除或 noindex**，它们仍通过两条路径被 Google 发现：
 *       ① 详情页的 hreflang en/zh/ja/x-default 互指（见 tag-page-metadata 等）
 *       ② 全站内链（Header / 分页 / related / 上下篇）都带 locale 前缀
 *     GSC 规范也明确：hreflang 组内不必每个 URL 都出现在 sitemap 里
 *   - 想改回全语言提交：把这里改成 `locales`（下面有注释说明）即可，一行
 *
 * ⚠️ 2026-10-18 更新（决策变更，上面两条已过时）：
 *   zh / ja **现在已 noindex**，也不再出现在任何 hreflang 组里。
 *   见 src/lib/seo.ts 的 SEO_INDEXABLE_LOCALES —— sitemap / hreflang / robots
 *   三处现在都由那一个常量推导，不再各自维护。
 *   本常量保留只为「哪天恢复详情页提交时，先只提交哪些语言」这一层含义。
 */
export const SITEMAP_PROMPT_LOCALES: ReadonlyArray<(typeof locales)[number]> = ['en'];

/**
 * 是否提交 prompt 详情页（2026-10-15）
 *
 * **默认关掉。** 依据是 GSC 实测，不是偏好：
 *
 *   - 30 天总曝光 204 / 点击 6，且 72% 集中在首页（`/en` 79 + `/` 68）
 *   - 详情页的平均排名是 **1.0–3.7** —— 它们在赢，只是赢的那些词
 *     30 天总搜索量只有 3~7 次
 *   - 也就是说：6,954 条详情页每条分到的曝光约 0.005 次/天
 *   - 而 Google 已经爬过 13,046 条详情页并**全部拒绝收录**
 *
 * 提交 87% 都是零需求长尾的 URL，等于持续给 Google 一个"这批不值得抓"的信号，
 * 还会稀释真正想被收录的 ~1,050 个页面的抓取优先级。
 *
 * **关掉不等于封死**：详情页仍可被爬（Header / 分页 / related / 上下篇内链都在），
 * 也没有加 noindex。哪天拿到外链、它们开始有曝光，改回 true 即可，
 * 子表路由仍然在线（见下方 SITEMAP_CHILDREN 的推导）。
 */
export const SUBMIT_PROMPT_DETAIL_PAGES = false;

/**
 * 子表清单：由开关推导，不是手写数组。
 * 把 SUBMIT_PROMPT_DETAIL_PAGES 改回 true 就能一键恢复详情页提交，
 * 不会出现"index 里少了子表但 route 还在"这种半吊子状态。
 */
export const SITEMAP_CHILDREN = [
  ...(SUBMIT_PROMPT_DETAIL_PAGES
    ? SITEMAP_PROMPT_LOCALES.map((loc) => ({
        path: `/sitemaps/prompts-${loc}.xml`,
        locale: loc,
      }))
    : []),
  { path: '/sitemaps/tags.xml', locale: null },
  { path: '/sitemaps/models.xml', locale: null },
  // <sitemapindex> 里只能放 <sitemap>，不能放页面 URL，
  // 所以首页 / about / tags·models 索引这 12 个静态页必须单独成一个子表。
  { path: '/sitemaps/static.xml', locale: null },
];

/**
 * 纯映射函数（不碰 D1/R2，可单测）
 *
 * 拆出来是为了让 lastModified 策略这类不变量能在 vitest 里直接断言 ——
 * 否则一调 buildTagsSitemap() 就会去打 D1，测试环境没有 CF context 直接炸。
 * 这几条策略一旦破掉，线上要好几天才能从 GSC 看出来，必须锁住。
 */
interface SlugRow {
  slug: string;
  updatedAt: string;
}
interface TagRow {
  slug: string;
}
interface ModelRow {
  slug: string;
}

/** 详情页：保留 lastModified（prompt 真实更新时间） */
export function toPromptSitemapRows(
  rows: SlugRow[],
  locale: (typeof locales)[number],
): MetadataRoute.Sitemap {
  return rows.map((row) => ({
    url: `${SITE_URL}/${locale}/prompts/${row.slug}`,
    lastModified: toW3CDate(row.updatedAt),
    changeFrequency: 'monthly' as const,
    priority: locale === 'en' ? 0.9 : 0.7,
  }));
}

/**
 * tag 页：**省略 lastModified**（P2-2，理由见文件头）
 *
 * priority 2026-10-15 上调（原 0.7 / 0.6）：
 *   详情页退出提交面后，tag 页与 model 页成为 sitemap 的主体，
 *   不再需要给详情页让位。
 */
export function toTagSitemapRows(tags: TagRow[]): MetadataRoute.Sitemap {
  return tags.flatMap((tag) =>
    SEO_INDEXABLE_LOCALES.map((locale) => ({
      url: `${SITE_URL}/${locale}/tags/${tag.slug}`,
      changeFrequency: 'weekly' as const,
      priority: locale === 'en' ? 0.9 : 0.7,
    })),
  );
}

/**
 * model 页：省略 lastModified（P2-2），**priority 提到最高**（2026-10-15）
 *
 * 为什么 model 页排第一：
 *   全站唯一一类"用户确实在搜"的查询就落在 model 维度 ——
 *   "seedance 2.0 video prompt"、"kling 3 video prompt" 这类词有真实搜索量，
 *   而 6,954 条详情页的 slug 形如 `temporary-tattoo-test-at-midnight`，
 *   没人会拿它去搜。实测 `/ja/models/seedance/` 已经在拿曝光。
 *
 *   只有 25 个 model（×1 locale = 25 条，2026-10-18 起只提交 en），
 *   是 sitemap 里最该被优先抓的部分。
 */
export function toModelSitemapRows(models: ModelRow[]): MetadataRoute.Sitemap {
  return models.flatMap((model) =>
    SEO_INDEXABLE_LOCALES.map((locale) => ({
      url: `${SITE_URL}/${locale}/models/${model.slug}`,
      changeFrequency: 'weekly' as const,
      priority: locale === 'en' ? 1.0 : 0.8,
    })),
  );
}

/** 详情页：某 locale 的全部 prompt */
export async function buildPromptsSitemap(locale: (typeof locales)[number]): Promise<MetadataRoute.Sitemap> {
  return getCachedData(`${CACHE_KEYS.sitemapOutput}-prompts-${locale}`, async () =>
    toPromptSitemapRows(await listAllSlugsForSitemap(), locale),
  );
}

/** tag 页：3 locale */
export async function buildTagsSitemap(): Promise<MetadataRoute.Sitemap> {
  return getCachedData(`${CACHE_KEYS.sitemapOutput}-tags`, async () =>
    toTagSitemapRows(await listAllTags()),
  );
}

/** model 页：3 locale */
export async function buildModelsSitemap(): Promise<MetadataRoute.Sitemap> {
  return getCachedData(`${CACHE_KEYS.sitemapOutput}-models`, async () =>
    toModelSitemapRows(await listAllModels()),
  );
}

/**
 * 静态页：SEO locale 的首页 + about + tags/models 索引（en 单语言 = 4 条）。
 * 省略 lastModified —— 静态页每次生成都变会误导 Google。
 *
 * 2026-10-18：只提交 SEO_INDEXABLE_LOCALES（当前仅 en），原来 12 条 → 4 条。
 *
 * 注意：这些是**页面 URL**，不能直接放进 <sitemapindex>（那里面只允许
 * 放 <sitemap>），所以走 /sitemaps/static.xml 子表提交。
 */
export async function buildStaticSitemap(): Promise<MetadataRoute.Sitemap> {
  return getCachedData(`${CACHE_KEYS.sitemapOutput}-index`, async () => {
    const homeRoutes: MetadataRoute.Sitemap = SEO_INDEXABLE_LOCALES.map((locale) => ({
      url: `${SITE_URL}/${locale}`,
      changeFrequency: 'daily' as const,
      priority: locale === 'en' ? 1.0 : 0.9,
    }));

    const staticRoutes: MetadataRoute.Sitemap = SEO_INDEXABLE_LOCALES.flatMap((locale) => [
      { url: `${SITE_URL}/${locale}/about`, changeFrequency: 'monthly' as const, priority: 0.6 },
      { url: `${SITE_URL}/${locale}/tags`, changeFrequency: 'weekly' as const, priority: 0.8 },
      { url: `${SITE_URL}/${locale}/models`, changeFrequency: 'weekly' as const, priority: 0.8 },
    ]);

    return [...homeRoutes, ...staticRoutes];
  });
}
