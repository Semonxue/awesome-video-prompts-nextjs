/**
 * Tags 索引页 /[locale]/tags
 *
 * 2026-09-08 SEO 修复：
 *   - 之前整页只有 h1 + 不可点击的 <span>，正文内 <a> 数量 = 0，
 *     294 个 tag 页只靠 sitemap + 详情页 meta 链接被发现（孤岛页，PageRank 传不进去）
 *   - 现在：Header + Footer 承担站点导航；每个 tag 都是指向
 *     /[locale]/tags/[slug] 的真实链接（tagHref 内部做 encodeURIComponent，
 *     覆盖 "martial arts" 这类含空格/非 ASCII 的 slug）
 *   - 计数用 .tag-count--show 显示（.tag-count 默认 display:none）
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { locales, type Locale } from '@/i18n/request';
import { notFound } from 'next/navigation';
import { listAllTags, listAllModels } from '@/db/queries';
import { AGG_CACHE_KEYS, readAggregateCache, type CountsCache } from '@/db/aggregate-cache';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { tagHref } from '@/lib/format';
import { SITE_URL, DEFAULT_OG_IMAGE } from '@/lib/site';

export const revalidate = 86400;

interface TagsPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: TagsPageProps) {
  const { locale } = await params;
  const canonical = `${SITE_URL}/${locale}/tags`;
  return {
    title: 'Browse by tag',
    description: 'Explore prompts organized by topic and style.',
    alternates: {
      canonical,
      languages: {
        en: `${SITE_URL}/en/tags`,
        zh: `${SITE_URL}/zh/tags`,
        ja: `${SITE_URL}/ja/tags`,
        'x-default': `${SITE_URL}/en/tags`,
      },
    },
    openGraph: {
      title: 'Browse by tag',
      description: 'Explore prompts organized by topic and style.',
      url: canonical,
      images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630 }],
      type: 'website',
    },
  };
}

export default async function TagsPage({ params }: TagsPageProps) {
  const { locale: rawLocale } = await params;
  if (!locales.includes(rawLocale as Locale)) notFound();
  const locale = rawLocale as Locale;

  const t = await getTranslations();
  // tags 已按 count desc 排序（queryAllTags 的 orderBy），热门 tag 自然排前
  const [tags, models, counts] = await Promise.all([
    listAllTags(),
    listAllModels(),
    readAggregateCache<CountsCache>(AGG_CACHE_KEYS.counts),
  ]);
  const totalCount = counts?.total ?? 0;

  return (
    <>
      <Header locale={locale} modelOptions={models} totalCount={totalCount} />

      <main className="main-content">
        <div className="grid-header">
          <div className="grid-header-left">
            <h1 className="grid-title">{t('pages.tagsTitle')}</h1>
          </div>
          <div className="grid-header-right">
            <span className="result-count">
              {tags.length.toLocaleString()} {t('stats.tags')}
            </span>
          </div>
        </div>

        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
          {t('pages.tagsDescription')}
        </p>

        {tags.length === 0 ? (
          <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>
            {t('empty.phaseOneHint')}
          </p>
        ) : (
          <div className="content-tags">
            {tags.map((tag) => (
              <Link key={tag.slug} href={tagHref(locale, tag.slug)} className="content-tag">
                {tag.name}
                <span className="tag-count tag-count--show">{tag.count.toLocaleString()}</span>
              </Link>
            ))}
          </div>
        )}
      </main>

      <Footer locale={locale} />
    </>
  );
}
