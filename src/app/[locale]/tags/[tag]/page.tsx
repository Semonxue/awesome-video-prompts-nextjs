/**
 * 独立 tag 页面 /[locale]/tags/[tag]
 * 视觉对齐线上 awesomevideoprompts.com/tags/[tag]/：
 *   - Header
 *   - Breadcrumb: Home › Tags › [tag]
 *   - Hero: H1 + 描述 + N prompts found + ← Tags
 *   - 该 tag 下的相关 model tabs
 *   - "Popular prompts" + 瀑布流
 *   - Footer
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { GridEngine } from '@/components/GridEngine';
import { listAllModels, listAllTags, listPrompts } from '@/db/queries';

export const revalidate = 3600;

interface Props {
  params: Promise<{ locale: string; tag: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { locale, tag } = await params;
  return {
    title: `${tag} | Awesome Video Prompts`,
    description: `Browse ${tag} video prompts on Awesome Video Prompts`,
  };
}

export default async function TagPage({ params }: Props) {
  const { locale, tag } = await params;
  const t = await getTranslations('tag');
  if (!['en', 'zh', 'ja'].includes(locale)) notFound();

  const ll = locale as 'en' | 'zh' | 'ja';

  // 该 tag 下的 prompts
  const result = await listPrompts({ locale: ll, tag });
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

  // 全集 tagOptions（顶部 tag tabs）
  const allTags = await listAllTags(ll);

  return (
    <>
      <Header
        locale={locale}
        activeTag={tag}
        tagOptions={allTags}
        totalCount={result.total}
      />

      <main className="main-content model-tag-page">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link href={`/${locale}`}>Home</Link>
          <span className="breadcrumb-sep">›</span>
          <Link href={`/${locale}/tags/`}>{t('breadcrumbTags')}</Link>
          <span className="breadcrumb-sep">›</span>
          <span>{tag}</span>
        </nav>

        <section className="model-hero">
          <h1 className="model-hero__title">{tag}</h1>
          <div className="model-hero__stats">
            <span className="model-hero__count">{t('promptsFound', { count: result.total.toLocaleString() })}</span>
            <Link href={`/${locale}/tags/`} className="model-hero__back">{t('backToTags')}</Link>
          </div>
        </section>

        {modelOptions.length > 0 && (
          <div className="content-tag-area model-tag-tabs">
            <div className="content-tags">
              <span className="content-tag content-tag--label">{t('byModel')}</span>
              {modelOptions.slice(0, 12).map((m) => (
                <Link
                  key={m.slug}
                  href={`/${locale}/models/${m.slug}/`}
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
          <GridEngine items={tagItems} locale={locale} total={result.total} hasMore={result.hasMore} />
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
