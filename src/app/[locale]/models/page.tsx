/**
 * Models 索引页 /[locale]/models
 *
 * 2026-09-08 SEO 修复：
 *   - 之前整页只有 h1 + 不可点击的 <span>，正文内 <a> 数量 = 0，
 *     model 页只靠 sitemap + 详情页 meta 链接被发现（孤岛页）
 *   - 现在：Header + Footer 承担站点导航；每个 model 都是指向
 *     /[locale]/models/[slug] 的真实链接（modelHref 内部 encodeURIComponent）
 *   - 计数用 .tag-count--show 显示（.tag-count 默认 display:none）
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { locales, type Locale } from '@/i18n/request';
import { notFound } from 'next/navigation';
import { listAllModels, listAllTags } from '@/db/queries';
import { AGG_CACHE_KEYS, readAggregateCache, type CountsCache } from '@/db/aggregate-cache';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { modelHref } from '@/lib/format';
import { HEADER_TAG_LIMIT } from '@/components/types';
import { SITE_URL, DEFAULT_OG_IMAGE } from '@/lib/site';

export const revalidate = 86400;

interface ModelsPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: ModelsPageProps) {
  const { locale } = await params;
  const canonical = `${SITE_URL}/${locale}/models`;
  return {
    title: 'Browse by model',
    description: 'Find prompts for your favorite video generation models.',
    alternates: {
      canonical,
      languages: {
        en: `${SITE_URL}/en/models`,
        zh: `${SITE_URL}/zh/models`,
        ja: `${SITE_URL}/ja/models`,
        'x-default': `${SITE_URL}/en/models`,
      },
    },
    openGraph: {
      title: 'Browse by model',
      description: 'Find prompts for your favorite video generation models.',
      url: canonical,
      images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630 }],
      type: 'website',
    },
  };
}

export default async function ModelsPage({ params }: ModelsPageProps) {
  const { locale: rawLocale } = await params;
  if (!locales.includes(rawLocale as Locale)) notFound();
  const locale = rawLocale as Locale;

  const t = await getTranslations();
  // models 已按 count desc 排序（queryAllModels 的 orderBy）
  // tagOptions 只取前 HEADER_TAG_LIMIT 个：Header 是客户端组件，props 会全量进 RSC 载荷
  const [models, tags, counts] = await Promise.all([
    listAllModels(),
    listAllTags(),
    readAggregateCache<CountsCache>(AGG_CACHE_KEYS.counts),
  ]);
  const totalCount = counts?.total ?? 0;

  return (
    <>
      <Header
        locale={locale}
        modelOptions={models}
        tagOptions={tags.slice(0, HEADER_TAG_LIMIT)}
        totalCount={totalCount}
      />

      <main className="main-content">
        <div className="grid-header">
          <div className="grid-header-left">
            <h1 className="grid-title">{t('pages.modelsTitle')}</h1>
          </div>
          <div className="grid-header-right">
            <span className="result-count">
              {models.length.toLocaleString()} {t('stats.models')}
            </span>
          </div>
        </div>

        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
          {t('pages.modelsDescription')}
        </p>

        {models.length === 0 ? (
          <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>
            {t('empty.phaseOneHint')}
          </p>
        ) : (
          <div className="content-tags">
            {models.map((model) => (
              <Link key={model.slug} href={modelHref(locale, model.slug)} className="content-tag">
                {model.name}
                <span className="tag-count tag-count--show">{model.count.toLocaleString()}</span>
              </Link>
            ))}
          </div>
        )}
      </main>

      <Footer locale={locale} />
    </>
  );
}
