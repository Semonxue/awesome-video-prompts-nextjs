/**
 * Home placeholder — Phase 0 占位
 * Phase 1 之后接 Header/GridEngine/PromptCard + D1 直查（ISR 1h 缓存）
 */
import { getTranslations } from 'next-intl/server';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations();

  return (
    <main style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>{t('site.title')}</h1>
      <p>{t('site.description')}</p>
      <p style={{ marginTop: '1rem', opacity: 0.6, fontSize: '0.875rem' }}>
        Locale: <code>{locale}</code> · Phase 0 scaffold (no data yet)
      </p>
    </main>
  );
}