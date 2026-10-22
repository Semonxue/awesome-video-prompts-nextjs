import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { GridEngine } from '@/components/GridEngine';
import { Pagination } from '@/components/Pagination';
import { HEADER_TAG_LIMIT, LIST_DESCRIPTION_LIMIT } from '@/components/types';
import { listAllTags, listPrompts, listTagStats } from '@/db/queries';
import { AGG_CACHE_KEYS, readAggregateCache, type CountsCache } from '@/db/aggregate-cache';
import { PAGE_SIZE, TAG_PAGE_MAX_DEPTH, lastUsablePage, MIN_PAGE_ITEMS } from '@/lib/pagination';
import {
  buildTagCollectionSchema,
  buildTagFaq,
  buildTagIntro,
  buildFaqSchema,
} from '@/lib/content-pages';
import { SITE_URL } from '@/lib/site';

/**
 * tag 页共享渲染（2026-10-08 P1-1）
 *
 * 原来这套 JSX 只存在于 /[locale]/tags/[tag]/page.tsx 里。P1-1 要新增
 * /[locale]/tags/[tag]/p/[page] 作为可抓取的真实分页路径，如果复制一份会有
 * 两处各自漂移的风险（这类代码本项目已经吃过亏：PAGE_SIZE 曾经散落在 5 个文件里）。
 * 所以抽成共享组件，两条路由只负责 metadata + 参数校验。
 *
 * 成本护栏（对应 docs/SEO-INDEXATION-PLAN.md §4.3）：
 *   1. listAllTags() 在 metadata 与视图里都要用 —— 用 React cache() 去重，
 *      避免同一请求读两次 R2 aggregate cache
 *   2. Header 的 tagOptions 走 HEADER_TAG_LIMIT 截断（全量序列化会撑爆 HTML）
 *   3. 列表查询沿用既有 listPrompts（走 idx_prompts_draft_date），不做额外查询
 */
interface Props {
  locale: string;
  tag: string;
  page: number;
}

export async function TagPageView({ locale, tag, page }: Props) {
  const t = await getTranslations('tag');

  const offset = (page - 1) * PAGE_SIZE;

  // 该 tag 下的 prompts（不分 locale）
  // descriptionLimit：只下发摘要（卡片 UI 只显示 180 字符），复制全文时懒加载。
  const [result, allTags, counts, tagStats] = await Promise.all([
    listPrompts({ tag, limit: PAGE_SIZE, offset, descriptionLimit: LIST_DESCRIPTION_LIMIT }),
    listAllTags(),
    readAggregateCache<CountsCache>(AGG_CACHE_KEYS.counts),
    // 全量统计（model 分布 / 共现 tag / 标题词频）—— 发布时预计算落 R2，运行时零 D1。
    // ⚠️ 2026-10-22 修正：原来这些是从**当前页 48 条**现算的，
    //    拿去和 tag 总数比较就是错的（"covering 41 of the 5,018"）。
    listTagStats(tag),
  ]);
  const tagItems = result.items;

  // 该 tag 下的 model 分布 —— **全量真值**（不是当前页的 48 条）
  // 拿不到时留空数组：对应的导语/FAQ 整段省略，绝不拿本页计数冒充全量。
  const modelOptions = tagStats?.models ?? [];

  // 全集 tagOptions（顶部 tag tabs，不分 locale）—— 必须截断，见文件头注释 2
  const allTagsSliced = allTags.slice(0, HEADER_TAG_LIMIT);
  const totalCount = counts?.total ?? 0;
  const displayName = allTags.find((x) => x.slug === tag)?.name ?? tag;

  // 分页上限（成本护栏 G1）+ 剔除内容过薄的末页（2026-10-15）
  const last = lastUsablePage(result.total, TAG_PAGE_MAX_DEPTH);

  // 直接访问 /p/N 时同样要拦住薄页，否则薄页会被收录成 Soft 404
  if (page > last || (page > 1 && tagItems.length < MIN_PAGE_ITEMS)) notFound();

  // ---- P3 真实内容（2026-10-08）----
  // 动机不是"内容太薄"，而是"能匹配搜索需求的只有类别层"。
  // 实测（GSC Performance 部署当日）：全站 235 曝光 / 4 点击 / 平均排名 position 6，
  // 但有曝光的 query 只有 2 个，其中一个是 site:awesomevideoprompts.com。
  // 而 GSC 已收录的 84 条里绝大多数是 /tags/* 与 /models/* —— Google 自己
  // 挑中的是类别页。所以独特性应该加在类别层，而不是 2 万条零需求的长尾详情页。
  //
  // 关键成本约束：下面两块内容**全部复用已经加载进内存的数据**，
  // 不新增任何 D1 查询 —— related tags 来自本页已 hydrate 的 tagItems，
  // model 分布同理。HTML 增量约 1~2KB / 页。
  // 相关 tag —— 按**全量共现次数**排序（不是当前页 48 条的共现）
  // count 用全站该 tag 的 prompt 总数（UI 上显示的那个数），coCount 是共现次数
  const relatedTags = (tagStats?.related ?? []).slice(0, 24).map((rt) => ({
    slug: rt.slug,
    count: allTags.find((x) => x.slug === rt.slug)?.count ?? 0,
    coCount: rt.count,
  }));

  const modelNames = modelOptions.slice(0, 3).map((m) => m.name);
  // 2026-10-15：主力 model 交叉链（tag → model 是 sitemap 里两类主体之间的唯一连接，
  // 之前只有 model 图标形式的 tab，没有文字锚点，权重传递弱）
  const topModels = modelOptions.slice(0, 8);
  const shareText = totalCount > 0 ? ((result.total / totalCount) * 100).toFixed(1) : '0';

  // ---- 2026-10-22：内容页化 ----
  // 把 tag 页从「筛选列表」升级成「内容页」：导语 + FAQ + 结构化数据。
  // 数据全部来自本页已加载的 tagStats（全量统计，发布时预计算）+ allTags + counts，
  // **零新增 D1 查询**（新增查询 = 新增 rows read = 关联成本）。
  // 详见 src/lib/content-pages.ts 的设计铁律。
  const introParagraphs = buildTagIntro({
    tagName: displayName,
    count: result.total,
    total: totalCount,
    stats: tagStats,
  });
  const faqItems = buildTagFaq({
    tagName: displayName,
    count: result.total,
    total: totalCount,
    stats: tagStats,
  });

  // 结构化数据只在第 1 页输出：
  //   - 分页页 /p/2 的 ItemList 会与第 1 页内容重叠 → 制造重复内容
  //   - Google 的 doorway abuse 红线：substantially similar pages
  const isFirstPage = page === 1;
  const collectionSchema = isFirstPage
    ? buildTagCollectionSchema({
        tagName: displayName,
        url: `${SITE_URL}/${locale}/tags/${tag}`,
        items: tagItems.map((p) => ({
          name: p.title,
          url: `${SITE_URL}/${locale}/prompts/${p.slug}`,
        })),
      })
    : null;
  const faqSchema = isFirstPage ? buildFaqSchema(faqItems) : null;

  return (
    <>
      {/* BreadcrumbList：页面上有可见的 <nav class="breadcrumb">，之前只有视觉没有结构化数据，
          白白浪费了搜索结果的面包屑富媒体位（2026-10-06 补，抽到共享视图时一并保留） */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/${locale}` },
              { '@type': 'ListItem', position: 2, name: t('breadcrumbTags'), item: `${SITE_URL}/${locale}/tags` },
              { '@type': 'ListItem', position: 3, name: displayName, item: `${SITE_URL}/${locale}/tags/${tag}` },
            ],
          }),
        }}
      />
      {/* CollectionPage / ItemList + FAQPage 结构化数据（2026-10-22）
          ItemList 语义 = "这个页面上有一组同类条目"，与 tag 页完全吻合。
          只在第 1 页输出（分页页输出会造成实质重复 → doorway abuse）。 */}
      {collectionSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionSchema) }}
        />
      )}
      {faqSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        />
      )}

      <Header locale={locale} activeTag={tag} tagOptions={allTagsSliced} totalCount={totalCount} />
      <main className="main-content model-tag-page">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link href={`/${locale}`}>Home</Link>
          <span className="breadcrumb-sep">›</span>
          <Link href={`/${locale}/tags`}>{t('breadcrumbTags')}</Link>
          <span className="breadcrumb-sep">›</span>
          <span>{displayName}</span>
        </nav>

        <section className="model-hero">
          <h1 className="model-hero__title">{displayName}</h1>
          <div className="model-hero__stats">
            <span className="model-hero__count">{t('promptsFound', { count: result.total.toLocaleString() })}</span>
            <Link href={`/${locale}/tags`} className="model-hero__back">{t('backToTags')}</Link>
          </div>
        </section>

        {/* P3（2026-10-08）：数据派生的真实描述 + 相关标签
            全部来自本页已加载的数据，零新增 D1 查询。
            动机见上方注释：搜索需求只存在于类别层，独特性就该加在这里。 */}
        <section className="tag-overview">
          <p className="tag-overview__text">
            {t('overviewText', {
              tag: displayName,
              count: result.total.toLocaleString(),
              share: shareText,
              total: totalCount.toLocaleString(),
              models: modelNames.length > 0 ? modelNames.join(', ') : t('overviewNoModel'),
            })}
          </p>

          {relatedTags.length > 0 && (
            <div className="tag-overview__related">
              <span className="content-tag content-tag--label">{t('relatedTags')}</span>
              {relatedTags.map((rt) => (
                <Link
                  key={rt.slug}
                  href={`/${locale}/tags/${rt.slug}`}
                  className="content-tag"
                  title={t('relatedTagTitle', { count: rt.count })}
                >
                  {allTags.find((x) => x.slug === rt.slug)?.name ?? rt.slug}{' '}
                  <span className="tag-count">{rt.count}</span>
                </Link>
              ))}
            </div>
          )}

          {/* tag → model 文字交叉链：sitemap 的两类主体（tag/model）之间唯一权重通道 */}
          {topModels.length > 0 && (
            <div className="tag-overview__related">
              <span className="content-tag content-tag--label">{t('topModels')}</span>
              {topModels.map((m) => (
                <Link
                  key={m.slug}
                  href={`/${locale}/models/${m.slug}`}
                  className="content-tag"
                  title={t('modelTitleCount', { count: m.count })}
                >
                  {m.name} <span className="tag-count">{m.count}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* 2026-10-22：内容页化 —— 导语 + FAQ
            依据 docs/research-model-tag-pages-as-content-pages.md（业界调研）
            与 docs/SEO-STATUS-AND-COST-NEUTRAL-PLAN-2026-10-18.md §6.4。
            内容全部由本页数据派生（零虚构、零新增 D1 查询）；
            分页页不重复输出（避免 doorway / scaled content abuse）。 */}
        {isFirstPage && (
          <section className="content-page-body" aria-label={t('aboutThisTag', { tag: displayName })}>
            <h2 className="content-page-body__title">{t('aboutThisTag', { tag: displayName })}</h2>
            {introParagraphs.map((para, i) => (
              <p key={i} className="content-page-body__para">
                {para}
              </p>
            ))}

            {faqItems.length > 0 && (
              <div className="content-page-faq">
                <h3 className="content-page-faq__title">{t('faqTitle')}</h3>
                {faqItems.map((item, i) => (
                  <div key={i} className="content-page-faq__item">
                    <h4 className="content-page-faq__q">{item.question}</h4>
                    <p className="content-page-faq__a">{item.answer}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {modelOptions.length > 0 && (
          <div className="content-tag-area model-tag-tabs">
            <div className="content-tags">
              <span className="content-tag content-tag--label">{t('byModel')}</span>
              {modelOptions.slice(0, 16).map((m) => (
                <Link
                  key={m.slug}
                  href={`/${locale}/models/${m.slug}`}
                  className="content-tag"
                >
                  {m.name} <span className="tag-count">{m.count}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="grid-header">
          <h2 className="grid-title">{t('popularPrompts')}</h2>
          <span className="result-count">{t('promptsFound', { count: result.total.toLocaleString() })}</span>
        </div>

        {tagItems.length > 0 ? (
          <>
            <GridEngine
              initialItems={tagItems}
              total={result.total}
              filters={{ tag }}
              initialPage={page}
              pageSize={PAGE_SIZE}
              locale={locale}
            />
            {last > 1 && (
              <Pagination
                basePath={`/${locale}/tags/${tag}`}
                current={page}
                last={last}
                label={t('paginationLabel', { tag: displayName })}
              />
            )}
          </>
        ) : (
          <div className="empty-state">
            <p>{t('noPrompts')}</p>
          </div>
        )}
      </main>

      <Footer locale={locale} />
    </>
  );
}
