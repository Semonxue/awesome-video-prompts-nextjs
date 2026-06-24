/**
 * About 占位页
 */
import { getTranslations } from 'next-intl/server';
import { locales, type Locale } from '@/i18n/request';
import { notFound } from 'next/navigation';

interface AboutPageProps {
  params: Promise<{ locale: string }>;
}

export default async function AboutPage({ params }: AboutPageProps) {
  const { locale: rawLocale } = await params;
  if (!locales.includes(rawLocale as Locale)) notFound();
  const locale = rawLocale as Locale;

  const t = await getTranslations();

  return (
    <div className="main-content" style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 12 }}>
        {t('pages.aboutTitle')}
      </h1>
      <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        {t('pages.aboutDescription')}
      </p>
      <p
        style={{
          marginTop: 24,
          padding: 16,
          background: 'var(--bg-muted)',
          borderRadius: 8,
          fontSize: 13,
          color: 'var(--text-tertiary)',
        }}
      >
        {t('empty.phaseOneHint')} · locale: {locale}
      </p>
    </div>
  );
}