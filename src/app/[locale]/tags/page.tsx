/**
 * Tags 占位页 — Phase 3 接 D1 实装
 */
import { getTranslations } from 'next-intl/server';
import { locales, type Locale } from '@/i18n/request';
import { notFound } from 'next/navigation';
import { listAllTags } from '@/db/queries';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://awesome-video-prompts-nextjs.semonxue.workers.dev';

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
  };
}

export default async function TagsPage({ params }: TagsPageProps) {
  const { locale: rawLocale } = await params;
  if (!locales.includes(rawLocale as Locale)) notFound();

  const t = await getTranslations();
  const tags = await listAllTags();

  return (
    <div className="main-content">
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
        {t('pages.tagsTitle')}
      </h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
        {t('pages.tagsDescription')}
      </p>

      {tags.length === 0 ? (
        <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>
          {t('empty.phaseOneHint')}
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {tags.map((tag) => (
            <span
              key={tag.slug}
              style={{
                padding: '6px 12px',
                background: 'var(--bg-muted)',
                borderRadius: 16,
                fontSize: 13,
              }}
            >
              {tag.name} ({tag.count})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}