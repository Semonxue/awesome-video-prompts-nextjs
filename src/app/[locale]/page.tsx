/**
 * 首页 — 提示词列表
 * Server Component，数据源 listPrompts / listAllModels / listAllTags（Phase 2 接 D1）
 * 视觉对齐 awesomevideoprompts.com：search-section（Header）+ grid-header（标题 + view-all 入口 + count）+ masonry-grid
 */
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales, type Locale } from '@/i18n/request';
import { listPrompts, listAllModels, listAllTags } from '@/db/queries';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { GridEngine } from '@/components/GridEngine';

interface HomePageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tag?: string; model?: string; q?: string }>;
}

// ISR 1h — 1 小时内同 URL 0 次 D1 调用
export const revalidate = 3600;

export default async function HomePage({ params, searchParams }: HomePageProps) {
  const { locale: rawLocale } = await params;
  const sp = await searchParams;

  if (!locales.includes(rawLocale as Locale)) notFound();
  const locale = rawLocale as Locale;

  const t = await getTranslations('home');

  // 列表（按 sp.tag / sp.model / sp.q 过滤）
  const result = await listPrompts({
    locale,
    tag: sp.tag,
    model: sp.model,
    q: sp.q,
  });

  // 模型/标签 tabs 数据
  const [allModels, allTags] = await Promise.all([
    listAllModels(locale),
    listAllTags(locale),
  ]);

  // "view more" 入口需要的本地化名字
  const activeModel = sp.model
    ? allModels.find((m) => m.slug === sp.model)?.name ?? sp.model
    : null;
  const activeTag = sp.tag ?? null;

  return (
    <>
      <Header
        locale={locale}
        activeTag={sp.tag}
        activeModel={sp.model}
        modelOptions={allModels}
        tagOptions={allTags}
        totalCount={result.total}
      />

      <main className="main-content">
        <div className="grid-header">
          <div className="grid-header-left">
            <h2 className="grid-title">{t('popularPrompts')}</h2>
            {/* "view more" 入口（model / tag 同时存在时分别显示，不去重） */}
            <div className="grid-header-links">
              {sp.model && activeModel && (
                <Link
                  href={`/${locale}/models/${sp.model}/`}
                  className="view-all-link"
                  data-view-more="model"
                >
                  {t('viewMoreModel', { name: activeModel })}
                </Link>
              )}
              {sp.tag && activeTag && (
                <Link
                  href={`/${locale}/tags/${sp.tag}/`}
                  className="view-all-link"
                  data-view-more="tag"
                >
                  {t('viewMoreTag', { name: activeTag })}
                </Link>
              )}
            </div>
          </div>
          <div className="grid-header-right">
            <span className="result-count">
              {t('promptsFound', { count: result.total.toLocaleString() })}
            </span>
          </div>
        </div>

        <GridEngine
          items={result.items}
          locale={locale}
          total={result.total}
          hasMore={result.hasMore}
        />
      </main>

      <Footer locale={locale} />
    </>
  );
}

// Link 组件 import（避免上面未声明）
import Link from 'next/link';
