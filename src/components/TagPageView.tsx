import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { GridEngine } from '@/components/GridEngine';
import { Pagination } from '@/components/Pagination';
import { HEADER_TAG_LIMIT } from '@/components/types';
import { listAllTags, listPrompts } from '@/db/queries';
import { AGG_CACHE_KEYS, readAggregateCache, type CountsCache } from '@/db/aggregate-cache';
import { PAGE_SIZE, TAG_PAGE_MAX_DEPTH, lastUsablePage, MIN_PAGE_ITEMS } from '@/lib/pagination';
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
  const [result, allTags, counts] = await Promise.all([
    listPrompts({ tag, limit: PAGE_SIZE, offset }),
    listAllTags(),
    readAggregateCache<CountsCache>(AGG_CACHE_KEYS.counts),
  ]);
  const tagItems = result.items;

  // 该 tag 下的 model 分布
  const modelSet = new Map<string, number>();
  for (const p of tagItems) {
    for (const m of p.models) {
      modelSet.set(m.slug, (modelSet.get(m.slug) ?? 0) + 1);
    }
  }
  const modelOptions = [...modelSet.entries()]
    .map(([slug, count]) => ({ slug, name: slug, count }))
    .sort((a, b) => b.count - a.count);

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
  const relatedTagSet = new Map<string, number>();
  for (const p of tagItems) {
    for (const tt of p.tags) {
      if (tt.slug === tag) continue;
      relatedTagSet.set(tt.slug, (relatedTagSet.get(tt.slug) ?? 0) + 1);
    }
  }
  const relatedTags = [...relatedTagSet.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([slug, coCount]) => ({
      slug,
      count: allTags.find((x) => x.slug === slug)?.count ?? 0,
      coCount,
    }));

  const modelNames = modelOptions.slice(0, 3).map((m) => m.name);
  const shareText = totalCount > 0 ? ((result.total / totalCount) * 100).toFixed(1) : '0';

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
        </section>

        {modelOptions.length > 0 && (
          <div className="content-tag-area model-tag-tabs">
            <div className="content-tags">
              <span className="content-tag content-tag--label">{t('byModel')}</span>
              {modelOptions.slice(0, 12).map((m) => (
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
