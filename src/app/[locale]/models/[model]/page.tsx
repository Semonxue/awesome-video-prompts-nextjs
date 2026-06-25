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
import type { Locale } from '@/i18n/request';

export const revalidate = 3600;

interface Props {
  params: Promise<{ locale: string; model: string }>;
  searchParams: Promise<{ tag?: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { locale, model } = await params;
  const name = formatModelName(model);
  return {
    title: `${name} Prompts | Awesome Video Prompts`,
    description: `Browse ${name} video prompts on Awesome Video Prompts`,
  };
}

export default async function ModelPage({ params, searchParams }: Props) {
  const { locale, model } = await params;
  const sp = await searchParams;
  const t = await getTranslations('model');
  if (!['en', 'zh', 'ja'].includes(locale)) notFound();

  const ll = locale as Locale;
  const modelName = formatModelName(model);

  // 该 model 下的 prompts
  const result = await listPrompts({ locale: ll, model, tag: sp.tag });
  const modelItems = result.items;

  // 该 model 下的 tag 分布（来自全集）
  const allForLocale = await listPrompts({ locale: ll, model });
  const tagSet = new Map<string, number>();
  for (const p of allForLocale.items) for (const tag of p.tags) {
    tagSet.set(tag.slug, (tagSet.get(tag.slug) ?? 0) + 1);
  }
  const tagOptions = [...tagSet.entries()]
    .map(([slug, count]) => ({ slug, name: slug, count }))
    .sort((a, b) => b.count - a.count);

  // 全集 modelOptions（顶部 model tabs）
  const modelOptions = await listAllModels(ll);

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
          <GridEngine items={modelItems} locale={locale} total={result.total} hasMore={result.hasMore} />
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
