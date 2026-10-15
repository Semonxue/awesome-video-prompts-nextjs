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
import { AGG_CACHE_KEYS, readAggregateCache, type CountsCache } from '@/db/aggregate-cache';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { GridEngine } from '@/components/GridEngine';
import { HEADER_TAG_LIMIT, LIST_DESCRIPTION_LIMIT } from '@/components/types';
import Link from 'next/link';
import { SITE_URL, SITE_BRAND, DEFAULT_OG_IMAGE } from '@/lib/site';

interface HomePageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tag?: string; model?: string; q?: string; page?: string }>;
}

// ISR 24h — publish/delete 时 revalidatePath 主动失效，无需短 TTL
export const revalidate = 86400;

// 2026-10-08 P1-3：PAGE_SIZE 统一从 lib/pagination 取（此前 5 处各写一份 24，
// 改一处忘一处会让 GridEngine 无限滚动跳页/重复条目）
import { PAGE_SIZE } from '@/lib/pagination';

export async function generateMetadata({ params, searchParams }: HomePageProps) {
  const { locale } = await params;
  const sp = await searchParams;
  const canonical = `${SITE_URL}/${locale}`;
  // B2：meta 三语化（zh/ja 页面此前是英文 title/description，与 en 近似重复）
  const t = await getTranslations({ locale, namespace: 'seo' });

  // 低质量页面 noindex：分页 >1 / 搜索 / 筛选（与独立 tag/model 页重复）
  const isLowValue =
    (sp.page && parseInt(sp.page, 10) > 1) ||
    Boolean(sp.q) ||
    Boolean(sp.tag) ||
    Boolean(sp.model);

  return {
    // absolute：首页标题已自带品牌名，不能再套 title 模板（否则品牌重复）
    title: { absolute: t('homeTitle') },
    description: t('homeDescription'),
    alternates: {
      canonical,
      languages: {
        en: `${SITE_URL}/en`,
        zh: `${SITE_URL}/zh`,
        ja: `${SITE_URL}/ja`,
        'x-default': `${SITE_URL}/en`,
      },
    },
    robots: isLowValue ? { index: false, follow: true } : undefined,
    openGraph: {
      title: t('homeTitle'),
      description: t('homeDescription'),
      url: canonical,
      locale: t('ogLocale'),
      images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630, alt: t('homeTitle') }],
      type: 'website',
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
  // descriptionLimit：只下发 180 字符摘要，卡片 UI 也只显示这么多；
  // 复制全文时由 PromptCard 按 slug 懒加载 /api/prompt/[slug]。详见 src/lib/description.ts。
  const result = await listPrompts({
    tag: sp.tag,
    model: sp.model,
    q: sp.q,
    limit: PAGE_SIZE,
    offset,
    descriptionLimit: LIST_DESCRIPTION_LIMIT,
  });

  // 模型/标签 tabs 数据（全局唯一，不分 locale）
  // tag 只传前 N 个：Header 是客户端组件，props 会全量序列化进 RSC 载荷。
  // 实测全量传 1486 个 tag 导致 HTML 303KB 中有 235KB 是这份载荷（77%），
  // 而页面只渲染 15 个 chip。详见 components/types.ts 的 HEADER_TAG_LIMIT。
  // counts 缓存：Header intro "Collected N prompts" 需要的是全站总数，不能用 result.total
  // （带 ?tag= / ?model= / ?q= 时 result.total 是子集数，2026-08-07 修复）。
  const [allModels, allTags, counts] = await Promise.all([
    listAllModels(),
    listAllTags(),
    readAggregateCache<CountsCache>(AGG_CACHE_KEYS.counts),
  ]);
  const headerTags = allTags.slice(0, HEADER_TAG_LIMIT);
  const totalCount = counts?.total ?? 0;

  // "view more" 入口需要的本地化名字
  const activeModel = sp.model
    ? allModels.find((m) => m.slug === sp.model)?.name ?? sp.model
    : null;
  const activeTag = sp.tag ?? null;

  return (
    <>
      {/* 站点级结构化数据（2026-10-06 补）——之前整站首页 JSON-LD 块数为 0。
          WebSite + SearchAction：站点本来就有 ?q= 搜索，这是拿 Google
          Sitelinks 搜索框的正规途径；Organization 帮搜索引擎把品牌与 GitHub
          仓库、社交账号这些实体关联起来。 */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@graph': [
              {
                '@type': 'WebSite',
                '@id': `${SITE_URL}/#website`,
                url: `${SITE_URL}/${locale}`,
                name: SITE_BRAND,
                inLanguage: locale,
                publisher: { '@id': `${SITE_URL}/#organization` },
                potentialAction: {
                  '@type': 'SearchAction',
                  target: {
                    '@type': 'EntryPoint',
                    urlTemplate: `${SITE_URL}/${locale}?q={search_term_string}`,
                  },
                  'query-input': 'required name=search_term_string',
                },
              },
              {
                '@type': 'Organization',
                '@id': `${SITE_URL}/#organization`,
                name: SITE_BRAND,
                url: SITE_URL,
                logo: { '@type': 'ImageObject', url: `${SITE_URL}/favicon.svg` },
                sameAs: ['https://github.com/Semonxue/awesome-video-prompts'],
              },
            ],
          }),
        }}
      />
      <Header
        locale={locale}
        activeTag={sp.tag}
        activeModel={sp.model}
        modelOptions={allModels}
        tagOptions={headerTags}
        totalCount={totalCount}
      />

      <main className="main-content">
        <div className="grid-header">
          <div className="grid-header-left">
            {/* H1：首页此前整页没有 <h1>（只有这个 h2），是权重最高页面的语义缺失。
                .grid-title 显式设了 font-size/weight，改标签不影响视觉 */}
            <h1 className="grid-title">{t('popularPrompts')}</h1>
            <div className="grid-header-links">
              {sp.model && activeModel && (
                <Link
                  href={`/${locale}/models/${sp.model}`}
                  className="view-all-link"
                  data-view-more="model"
                >
                  {t('viewMoreModel', { name: activeModel })}
                </Link>
              )}
              {sp.tag && activeTag && (
                <Link
                  href={`/${locale}/tags/${sp.tag}`}
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
