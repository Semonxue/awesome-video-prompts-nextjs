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
import { PAGE_SIZE, MODEL_PAGE_MAX_DEPTH, lastUsablePage, MIN_PAGE_ITEMS } from '@/lib/pagination';
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
  const [result, tagOptions, modelOptions, counts, modelName] = await Promise.all([
    listPrompts({ model, tag, limit: PAGE_SIZE, offset }),
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
