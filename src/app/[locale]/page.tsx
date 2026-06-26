/**
 * 首页 — 提示词列表
 * Server Component，数据源 listPrompts / listAllModels / listAllTags（D1）
 * 视觉对齐 awesomevideoprompts.com：search-section（Header）+ grid-header（标题 + view-all 入口 + count）+ masonry-grid
 *
 * 分页：URL ?page=N（默认 1），每页 24 条；触底时 GridEngine router.push 下一页 URL
 * ISR 1h 缓存：同 URL 1 小时内 0 次 D1 调用；不同 page 是不同 URL 各自缓存
 */
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales, type Locale } from '@/i18n/request';
import { listPrompts, listAllModels, listAllTags } from '@/db/queries';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { GridEngine } from '@/components/GridEngine';
import Link from 'next/link';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://awesome-video-prompts-nextjs.semonxue.workers.dev';

interface HomePageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tag?: string; model?: string; q?: string; page?: string }>;
}

// ISR 1h — 1 小时内同 URL 0 次 D1 调用
export const revalidate = 3600;

const PAGE_SIZE = 24;

export async function generateMetadata({ params }: HomePageProps) {
  const { locale } = await params;
  const canonical = `${SITE_URL}/${locale}`;
  return {
    title: 'Awesome Video Prompts',
    description: 'An open-source collection of awesome AI video generation prompts. Browse, copy, and remix.',
    alternates: {
      canonical,
      languages: {
        en: `${SITE_URL}/en`,
        zh: `${SITE_URL}/zh`,
        ja: `${SITE_URL}/ja`,
        'x-default': `${SITE_URL}/en`,
      },
    },
  };
}

export default async function HomePage({ params, searchParams }: HomePageProps) {
  const { locale: rawLocale } = await params;
  const sp = await searchParams;

  if (!locales.includes(rawLocale as Locale)) notFound();
  const locale = rawLocale as Locale;

  const t = await getTranslations('home');

  // 分页（默认 page 1）
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // 列表（按 sp.tag / sp.model / sp.q 过滤；不分 locale）
  const result = await listPrompts({
    tag: sp.tag,
    model: sp.model,
    q: sp.q,
    limit: PAGE_SIZE,
    offset,
  });

  // 模型/标签 tabs 数据（全局唯一，不分 locale）
  const [allModels, allTags] = await Promise.all([listAllModels(), listAllTags()]);

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
          initialItems={result.items}
          total={result.total}
          filters={{ tag: sp.tag, model: sp.model, q: sp.q }}
          initialPage={page}
          pageSize={PAGE_SIZE}
          locale={locale}
        />
      </main>

      <Footer locale={locale} />
    </>
  );
}
