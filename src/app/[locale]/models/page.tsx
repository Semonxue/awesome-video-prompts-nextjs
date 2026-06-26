/**
 * Models 占位页 — Phase 3 接 D1 实装
 */
import { getTranslations } from 'next-intl/server';
import { locales, type Locale } from '@/i18n/request';
import { notFound } from 'next/navigation';
import { listAllModels } from '@/db/queries';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://awesome-video-prompts-nextjs.semonxue.workers.dev';

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
  };
}

export default async function ModelsPage({ params }: ModelsPageProps) {
  const { locale: rawLocale } = await params;
  if (!locales.includes(rawLocale as Locale)) notFound();

  const t = await getTranslations();
  const models = await listAllModels();

  return (
    <div className="main-content">
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
        {t('pages.modelsTitle')}
      </h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
        {t('pages.modelsDescription')}
      </p>

      {models.length === 0 ? (
        <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>
          {t('empty.phaseOneHint')}
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {models.map((model) => (
            <span
              key={model.slug}
              style={{
                padding: '6px 12px',
                background: 'var(--bg-muted)',
                borderRadius: 16,
                fontSize: 13,
              }}
            >
              {model.name} ({model.count})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}