/**
 * 独立 model 页面 /[locale]/models/[model]
 * 视觉对齐线上 awesomevideoprompts.com/models/[model]/：
 *   - Header
 *   - Breadcrumb: Home › models: [Model Name]
 *   - Hero: H1 + "Official Website" link
 *   - 该 model 下的 tag tabs
 *   - "Model Name video prompts" + N prompts found
 *   - 瀑布流
 *   - Footer
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { GridEngine } from '@/components/GridEngine';
import { listAllModels, listAllTags, listPrompts } from '@/db/queries';
import { formatModelName } from '@/lib/format';

export const revalidate = 3600;

const PAGE_SIZE = 24;

interface Props {
  params: Promise<{ locale: string; model: string }>;
  searchParams: Promise<{ tag?: string; page?: string }>;
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://awesome-video-prompts-nextjs.semonxue.workers.dev';

export async function generateMetadata({ params }: Props) {
  const { locale, model } = await params;
  const name = formatModelName(model);
  const canonical = `${SITE_URL}/${locale}/models/${model}`;
  return {
    title: `${name} Prompts | Awesome Video Prompts`,
    description: `Browse ${name} video prompts on Awesome Video Prompts`,
    alternates: {
      canonical,
      languages: {
        en: `${SITE_URL}/en/models/${model}`,
        zh: `${SITE_URL}/zh/models/${model}`,
        ja: `${SITE_URL}/ja/models/${model}`,
        'x-default': `${SITE_URL}/en/models/${model}`,
      },
    },
  };
}

export default async function ModelPage({ params, searchParams }: Props) {
  const { locale, model } = await params;
  const sp = await searchParams;
  const t = await getTranslations('model');
  if (!['en', 'zh', 'ja'].includes(locale)) notFound();

  const modelName = formatModelName(model);

  // 分页
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // 该 model 下的 prompts（不分 locale）
  const result = await listPrompts({ model, tag: sp.tag, limit: PAGE_SIZE, offset });
  const modelItems = result.items;

  // 该 model 下的 tag 分布（来自全集）
  const allForModel = await listPrompts({ model });
  const tagSet = new Map<string, number>();
  for (const p of allForModel.items) for (const tag of p.tags) {
    tagSet.set(tag.slug, (tagSet.get(tag.slug) ?? 0) + 1);
  }
  const tagOptions = [...tagSet.entries()]
    .map(([slug, count]) => ({ slug, name: slug, count }))
    .sort((a, b) => b.count - a.count);

  // 全集 modelOptions（顶部 model tabs，不分 locale）
  const modelOptions = await listAllModels();

  return (
    <>
      <Header
        locale={locale}
        activeModel={model}
        activeTag={sp.tag}
        modelOptions={modelOptions}
        tagOptions={tagOptions.slice(0, 12)}
        totalCount={result.total}
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
            <Link href={`/${locale}/models/`} className="model-hero__back">{t('backToModels')}</Link>
          </div>
        </section>

        {tagOptions.length > 0 && (
          <div className="content-tag-area model-tag-tabs">
            <div className="content-tags">
              <Link href={`/${locale}/models/${model}/`} className={`content-tag${!sp.tag ? ' active' : ''}`}>
                {t('all')}
              </Link>
              {tagOptions.slice(0, 16).map((tt) => (
                <Link
                  key={tt.slug}
                  href={`/${locale}/models/${model}/?tag=${tt.slug}`}
                  className={`content-tag${sp.tag === tt.slug ? ' active' : ''}`}
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
          <GridEngine
            initialItems={modelItems}
            total={result.total}
            filters={{ model, tag: sp.tag }}
            initialPage={page}
            pageSize={PAGE_SIZE}
            locale={locale}
          />
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
