/**
 * 首页 — 提示词列表
 * Server Component，数据源 listPrompts (Phase 1 返回空，Phase 2 接 D1)
 */
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales, type Locale } from '@/i18n/request';
import { listPrompts } from '@/db/queries';
import GridEngine from '@/components/GridEngine';

interface HomePageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tag?: string; model?: string; q?: string }>;
}

// ISR 1h — 1 小时内同 URL 0 次 D1 调用（详见 docs/EXECUTION.md §3.1）
export const revalidate = 3600;

export default async function HomePage({ params, searchParams }: HomePageProps) {
  const { locale: rawLocale } = await params;
  const sp = await searchParams;

  if (!locales.includes(rawLocale as Locale)) notFound();
  const locale = rawLocale as Locale;

  const t = await getTranslations();
  const result = await listPrompts({
    locale,
    tag: sp.tag,
    model: sp.model,
    q: sp.q,
  });

  return (
    <div className="main-content">
      <p className="intro-text">{t('site.description')}</p>
      <GridEngine prompts={result.items} locale={locale} />
    </div>
  );
}