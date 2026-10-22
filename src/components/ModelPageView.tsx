import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { GridEngine } from '@/components/GridEngine';
import { Pagination } from '@/components/Pagination';
import {
  listAllModels,
  listPrompts,
  listModelTagDistribution,
  getModelName,
} from '@/db/queries';
import { AGG_CACHE_KEYS, readAggregateCache, type CountsCache } from '@/db/aggregate-cache';
import { LIST_DESCRIPTION_LIMIT } from '@/components/types';
import { PAGE_SIZE, MODEL_PAGE_MAX_DEPTH, lastUsablePage, MIN_PAGE_ITEMS } from '@/lib/pagination';
import {
  buildModelCollectionSchema,
  buildModelFaq,
  buildModelIntro,
  buildFaqSchema,
} from '@/lib/content-pages';
import { SITE_URL } from '@/lib/site';

/**
 * model 页共享渲染（2026-10-08 P1-1）
 *
 * 与 components/TagPageView.tsx 同构：page 1 与 /p/[page] 共用这一份实现，
 * 避免两条路由的 JSX 各自漂移。
 *
 * tag 筛选维度（?tag=X）刻意不进入 /p/N 体系：
 *   model × tag 是交叉面，内容与 /[locale]/tags/[tag] 重复，
 *   继续 robots 封锁 + noindex，避免提交量按乘法膨胀。
 *   所以分页控件只在**无 tag 筛选**时渲染。
 *
 * 顺带修掉的成本问题：
 *   原第 154 行 tag 筛选链接写成 `/${locale}/models/${model}/?tag=${tt.slug}`，
 *   结尾多一个斜杠 → middleware 每次都先 308 去斜杠、再 301 补 query，
 *   用户点一次 tag 筛选要吃 **2 次 Worker 调用**。去掉多余斜杠即可。
 */
interface Props {
  locale: string;
  model: string;
  page: number;
  /** tag 筛选（facet，保持 noindex，不参与分页） */
  tag?: string;
}

export async function ModelPageView({ locale, model, page, tag }: Props) {
  const t = await getTranslations('model');

  const offset = (page - 1) * PAGE_SIZE;

  // 该 model 下的 prompts（不分 locale）
  // descriptionLimit：只下发摘要（卡片 UI 只显示 180 字符），复制全文时懒加载。
  const [result, tagOptions, modelOptions, counts, modelName] = await Promise.all([
    listPrompts({ model, tag, limit: PAGE_SIZE, offset, descriptionLimit: LIST_DESCRIPTION_LIMIT }),
    listModelTagDistribution(model),
    listAllModels(),
    readAggregateCache<CountsCache>(AGG_CACHE_KEYS.counts),
    getModelName(model),
  ]);
  const modelItems = result.items;
  const totalCount = counts?.total ?? 0;

  // 分页只在无 tag 筛选时生成；上限 + 剔除薄末页（2026-10-15）
  const last = tag ? 1 : lastUsablePage(result.total, MODEL_PAGE_MAX_DEPTH);

  // 直接访问 /p/N 时拦住薄页 / 越界页，避免 Soft 404
  if (!tag && (page > last || (page > 1 && modelItems.length < MIN_PAGE_ITEMS))) notFound();

  // ---- 2026-10-15：model 页内容加深 ----
  // 动机：GSC 实测显示 model 维度是全站唯一有真实搜索量的查询
  //（"seedance 2.0 video prompt" 这类词有人搜），而 6,954 条详情页的
  // slug 形如 temporary-tattoo-test-at-midnight，没人会拿它去搜。
  // 所以把 model 页做成 sitemap 主体，并给它真正配得上优先级的正文。
  //
  // **所有数字都来自已有数据，零新增 D1 查询，不编造任何模型能力描述**：
  //   - tagOptions 来自 listModelTagDistribution，是该 model **全量** prompt 的 tag 分布
  //     （不是当前页），比 tag 页那套从当前页现算的更准
  //   - relatedModels 从本页已 hydrate 的 modelItems 共现关系现算
  const topTags = tagOptions.slice(0, 8);
  const shareText = totalCount > 0 ? ((result.total / totalCount) * 100).toFixed(1) : '0';

  const relatedModelSet = new Map<string, number>();
  for (const p of modelItems) {
    for (const m of p.models) {
      if (m.slug === model) continue;
      relatedModelSet.set(m.slug, (relatedModelSet.get(m.slug) ?? 0) + 1);
    }
  }
  const relatedModels = [...relatedModelSet.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  // ---- 2026-10-22：内容页化 ----
  // 导语 + FAQ + CollectionPage/ItemList + FAQPage 结构化数据。
  // 依据 docs/research-model-tag-pages-as-content-pages.md 与
  // docs/SEO-STATUS-AND-COST-NEUTRAL-PLAN-2026-10-18.md §6.4。
  //
  // ⚠️ 不写"参数规格表"（时长/分辨率/参考输入数）：
  //    调研文档建议从官方 API schema 派生，但本站 data/models.yaml 只有 name 字段，
  //    **没有规格数据源** —— 写出来就是编造，会踩 scaled content abuse 红线。
  //    只写能从 D1 实际数据算出来的事实。
  //
  // ⚠️ 带 ?tag= 筛选的变体页不输出完整内容：
  //    筛选变体与主页面内容高度重叠 → 触发 doorway abuse
  //    ("substantially similar pages")。
  const isMainVariant = !tag;
  const modelIntro = isMainVariant
    ? buildModelIntro({
        modelName,
        count: result.total,
        total: totalCount,
        topTags: topTags.map((x) => ({ slug: x.slug, name: x.name, count: x.count })),
        topModels: [
          { slug: model, name: modelName, count: result.total },
          ...relatedModels.map(([slug, coCount]) => ({
            slug,
            name: modelOptions.find((m) => m.slug === slug)?.name ?? slug,
            count: coCount,
          })),
        ],
      })
    : [];
  const modelFaq = isMainVariant
    ? buildModelFaq({
        modelName,
        count: result.total,
        total: totalCount,
        topTags: topTags.map((x) => ({ slug: x.slug, name: x.name, count: x.count })),
        topModels: [
          { slug: model, name: modelName, count: result.total },
          ...relatedModels.map(([slug, coCount]) => ({
            slug,
            name: modelOptions.find((m) => m.slug === slug)?.name ?? slug,
            count: coCount,
          })),
        ],
      })
    : [];

  // 结构化数据只在「主变体 + 第 1 页」输出
  const showSchema = isMainVariant && page === 1;
  const modelCollectionSchema = showSchema
    ? buildModelCollectionSchema({
        modelName,
        url: `${SITE_URL}/${locale}/models/${model}`,
        items: modelItems.map((p) => ({
          name: p.title,
          url: `${SITE_URL}/${locale}/prompts/${p.slug}`,
        })),
      })
    : null;
  const modelFaqSchema = showSchema ? buildFaqSchema(modelFaq) : null;

  return (
    <>
      {/* BreadcrumbList：页面上有可见的 <nav class="breadcrumb">，之前只有视觉没有结构化数据，
          白白浪费了搜索结果的面包屑富媒体位（2026-10-06 补） */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/${locale}` },
              { '@type': 'ListItem', position: 2, name: t('breadcrumbModels'), item: `${SITE_URL}/${locale}/models` },
              { '@type': 'ListItem', position: 3, name: modelName, item: `${SITE_URL}/${locale}/models/${model}` },
            ],
          }),
        }}
      />
      {/* CollectionPage / ItemList + FAQPage 结构化数据（2026-10-22）
          只在「主变体 + 第 1 页」输出。 */}
      {modelCollectionSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(modelCollectionSchema) }}
        />
      )}
      {modelFaqSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(modelFaqSchema) }}
        />
      )}

      <Header
        locale={locale}
        activeModel={model}
        activeTag={tag}
        modelOptions={modelOptions}
        tagOptions={tagOptions.slice(0, 12)}
        totalCount={totalCount}
      />

      <main className="main-content model-tag-page">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link href={`/${locale}`}>Home</Link>
          <span className="breadcrumb-sep">›</span>
          <span>models: {modelName}</span>
        </nav>

        <section className="model-hero">
          <div className="model-hero__header">
            <h1 className="model-hero__title">{modelName}</h1>
          </div>
          <div className="model-hero__stats">
            <span className="model-hero__count">{t('promptsFound', { count: result.total.toLocaleString() })}</span>
            <Link href={`/${locale}/models`} className="model-hero__back">{t('backToModels')}</Link>
          </div>
        </section>

        {tagOptions.length > 0 && (
          <div className="content-tag-area model-tag-tabs">
            <div className="content-tags">
              <Link href={`/${locale}/models/${model}`} className={`content-tag${!tag ? ' active' : ''}`}>
                {t('all')}
              </Link>
              {tagOptions.slice(0, 16).map((tt) => (
                <Link
                  key={tt.slug}
                  // 注意不要写成 `.../${model}/?tag=`：结尾多一个斜杠会让 middleware
                  // 每次都多走一次 308 → 301 跳转（见文件头注释）
                  href={`/${locale}/models/${model}?tag=${tt.slug}`}
                  className={`content-tag${tag === tt.slug ? ' active' : ''}`}
                >
                  {tt.name} <span className="tag-count">{tt.count}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* 2026-10-15：数据派生的概览 + 主力 tag / 相关 model 交叉链
            数字全部来自本页已加载的数据，零新增 D1 查询。 */}
        {!tag && (
          <section className="tag-overview">
            <p className="tag-overview__text">
              {t('overviewText', {
                model: modelName,
                count: result.total.toLocaleString(),
                share: shareText,
                total: totalCount.toLocaleString(),
                tags: topTags.length > 0 ? topTags.map((x) => x.name).join(', ') : t('overviewNoTag'),
              })}
            </p>

            {topTags.length > 0 && (
              <div className="tag-overview__related">
                <span className="content-tag content-tag--label">{t('topTags')}</span>
                {topTags.map((x) => (
                  <Link
                    key={x.slug}
                    href={`/${locale}/tags/${x.slug}`}
                    className="content-tag"
                    title={t('tagTitleCount', { count: x.count })}
                  >
                    {x.name} <span className="tag-count">{x.count}</span>
                  </Link>
                ))}
              </div>
            )}

            {relatedModels.length > 0 && (
              <div className="tag-overview__related">
                <span className="content-tag content-tag--label">{t('relatedModels')}</span>
                {relatedModels.map(([slug]) => (
                  <Link key={slug} href={`/${locale}/models/${slug}`} className="content-tag">
                    {slug}
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}

        {/* 2026-10-22：内容页化 —— 导语 + FAQ
            依据 docs/research-model-tag-pages-as-content-pages.md（业界调研）与
            docs/SEO-STATUS-AND-COST-NEUTRAL-PLAN-2026-10-18.md §6.4。
            内容全部由本页数据派生（零虚构、零新增 D1 查询）。
            带 ?tag= 筛选的变体页不输出（避免与主页面重复 → doorway abuse）。 */}
        {isMainVariant && modelIntro.length > 0 && (
          <section className="content-page-body" aria-label={t('aboutThisModel', { model: modelName })}>
            <h2 className="content-page-body__title">{t('aboutThisModel', { model: modelName })}</h2>
            {modelIntro.map((para, i) => (
              <p key={i} className="content-page-body__para">
                {para}
              </p>
            ))}

            {modelFaq.length > 0 && (
              <div className="content-page-faq">
                <h3 className="content-page-faq__title">{t('faqTitle')}</h3>
                {modelFaq.map((item, i) => (
                  <div key={i} className="content-page-faq__item">
                    <h4 className="content-page-faq__q">{item.question}</h4>
                    <p className="content-page-faq__a">{item.answer}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <div className="grid-header">
          <h2 className="grid-title">{modelName} video prompts</h2>
          <span className="result-count">{t('promptsFound', { count: result.total.toLocaleString() })}</span>
        </div>

        {modelItems.length > 0 ? (
          <>
            <GridEngine
              initialItems={modelItems}
              total={result.total}
              filters={{ model, tag }}
              initialPage={page}
              pageSize={PAGE_SIZE}
              locale={locale}
            />
            {last > 1 && (
              <Pagination
                basePath={`/${locale}/models/${model}`}
                current={page}
                last={last}
                label={t('paginationLabel', { model: modelName })}
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
