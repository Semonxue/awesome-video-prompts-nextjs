/**
 * 详情页 /[locale]/prompts/[slug]
 * 视觉对齐 awesomevideoprompts.com/prompts/[slug]/：
 *   - H1 标题
 *   - 4 格 meta grid：Date / Tags / Models / Source
 *   - Copy prompt 区块（H2 + 按钮 + 段落描述）
 *   - You Might Also Like（6 张相关 prompt-card）
 *   - 上下篇导航
 *
 * Perf 优化（P0 Phase 4）：
 *   - 封面图：fetchpriority=high + decoding=sync（LCP）
 *   - 图片走 R2 Transform WebP
 */
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import CopyButton from '@/components/CopyButton';
import { GridEngine } from '@/components/GridEngine';
import { getPromptBySlugCached, getAdjacentPromptsFromMap, getRelatedPromptsFromMap } from '@/db/queries';
import { AGG_CACHE_KEYS, readAggregateCache, type CountsCache } from '@/db/aggregate-cache';
import { tagHref, modelHref } from '@/lib/format';
import { SITE_URL, DEFAULT_OG_IMAGE } from '@/lib/site';


function r2Webp(url: string | null, _width: number): string | null {
  // 当前 R2 自定义域不支持 transform；CF 降级到原图
  return url;
}

export const revalidate = 86400; // 24h（publish 时 revalidatePath 主动失效，无需短 TTL）

interface Props {
  params: Promise<{ locale: string; slug: string }>;
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(
    locale === 'zh' ? 'zh-CN' : locale === 'ja' ? 'ja-JP' : 'en-US',
    { year: 'numeric', month: 'short', day: 'numeric' },
  );
}

function splitParagraphs(text: string): string[] {
  if (!text) return [];
  return text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!['en', 'zh', 'ja'].includes(locale)) return {};
  const prompt = await getPromptBySlugCached(slug);
  if (!prompt) return { title: 'Prompt not found' };
  // B2：meta 三语化 —— prompt 正文是英文原文（不改数据），但 title/description
  // 带上目标语言的标识与引导语，让 zh/ja 页面不再是 en 的近似重复。
  const t = await getTranslations({ locale, namespace: 'seo' });
  const canonical = `${SITE_URL}/${locale}/prompts/${slug}`;

  // 按词边界截断（原实现 slice(0,160) 会截出半个单词，线上曾出现 "... jungle. Extremely"）
  const prefix = t('promptDescriptionPrefix');
  const body = prompt.description.replace(/\s+/g, ' ').trim();
  const budget = Math.max(40, 160 - prefix.length - 1);
  const clipped =
    body.length <= budget ? body : `${body.slice(0, budget).replace(/\s+\S*$/, '')}…`;
  const description = `${prefix} ${clipped}`;
  const metaTitle = `${prompt.title} — ${t('promptTitleSuffix')}`;

  // 无封面时回退到默认 OG 图：原来回退成 []，会让 og:image / twitter:image 整体缺失
  const ogImage = prompt.coverUrl
    ? [{ url: prompt.coverUrl, width: 960, height: 540 }]
    : [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630 }];
  return {
    title: metaTitle,
    description,
    alternates: {
      canonical,
      languages: {
        en: `${SITE_URL}/en/prompts/${slug}`,
        zh: `${SITE_URL}/zh/prompts/${slug}`,
        ja: `${SITE_URL}/ja/prompts/${slug}`,
        'x-default': `${SITE_URL}/en/prompts/${slug}`,
      },
    },
    openGraph: {
      title: metaTitle,
      description,
      url: canonical,
      locale: t('ogLocale'),
      images: ogImage,
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: metaTitle,
      description,
      images: ogImage.map((img) => img.url),
    },
  };
}

export default async function PromptDetailPage({ params }: Props) {
  const { locale, slug } = await params;
  const t = await getTranslations('detail');
  if (!['en', 'zh', 'ja'].includes(locale)) notFound();

  // 内容不分 locale：slug 全局唯一；locale 仅用于 UI（next-intl）
  const prompt = await getPromptBySlugCached(slug);
  if (!prompt) notFound();

  // 相关推荐 + 上下篇 — 2026-08-18 D1 cost 静态化：
  //   旧路径：getRelatedPromptsCached / getAdjacentPromptsCached → namespace cache → D1
  //     → Query 1 (1.48M runs / 7.6B rows read) + Queries 2-5
  //   新路径：publish 时预计算存 R2 → 读 R2 aggregate cache → 零 D1 扫描
  //     容错：R2 miss 时自动 fallback 到旧 namespace cache
  //   并发取：两个查询无依赖，并发执行
  const [related, { prev, next }] = await Promise.all([
    getRelatedPromptsFromMap(prompt),
    getAdjacentPromptsFromMap(slug),
  ]);

  // Header 数据（不分 locale）
  //   Phase 2：详情页不再给 Header 传 modelOptions / tagOptions ——
  //   Header 的 `length > 0` 判断会自动隐藏 model tab 和 tag tab 两排，
  //   避免 1486+49 个对象序列化进 RSC 载荷。
  //   Header intro 的总数从 R2 counts 缓存取（后续 A2 加 L1 后几乎 0 开销）。
  const counts = await readAggregateCache<CountsCache>(AGG_CACHE_KEYS.counts);
  const totalCount = counts?.total ?? 0;

  const paragraphs = splitParagraphs(prompt.description);

  // JSON-LD 结构化数据（Article + VideoObject + BreadcrumbList）
  const canonicalUrl = `${SITE_URL}/${locale}/prompts/${slug}`;
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: prompt.title,
    description: prompt.description.replace(/\s+/g, ' ').trim().slice(0, 160),
    url: canonicalUrl,
    ...(prompt.coverUrl ? { image: prompt.coverUrl } : {}),
    ...(prompt.promptDate ? { datePublished: prompt.promptDate } : {}),
    ...(prompt.author ? { author: { '@type': 'Person', name: prompt.author } } : {}),
    mainEntityOfPage: canonicalUrl,
  };
  const videoJsonLd = prompt.videoUrl
    ? {
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: prompt.title,
        description: prompt.description.replace(/\s+/g, ' ').trim().slice(0, 160),
        thumbnailUrl: prompt.coverUrl ?? undefined,
        contentUrl: prompt.videoUrl,
        uploadDate: prompt.promptDate ?? new Date().toISOString(),
      }
    : null;
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/${locale}` },
      { '@type': 'ListItem', position: 2, name: prompt.title, item: canonicalUrl },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {videoJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(videoJsonLd) }}
        />
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      {/* Phase 2 优化：不传 modelOptions / tagOptions —— Header 的 `length > 0` 判断自动隐藏两排 tab，避免 1535 个对象序列化进 RSC 载荷 */}
      <Header locale={locale} totalCount={totalCount} />

      <main className="main-content prompt-detail">
        {/* 视频/封面 */}
        {(prompt.videoUrl || prompt.coverUrl) && (
          <div className="prompt-detail__media">
            {prompt.videoUrl ? (
              <video
                src={prompt.videoUrl}
                controls
                playsInline
                preload="metadata"
                poster={r2Webp(prompt.coverUrl, 960) ?? prompt.coverUrl ?? undefined}
                className="prompt-detail__video"
              />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={r2Webp(prompt.coverUrl, 960) ?? prompt.coverUrl ?? undefined}
                srcSet={
                  prompt.coverUrl
                    ? `${r2Webp(prompt.coverUrl, 480) ?? prompt.coverUrl} 480w, ${r2Webp(prompt.coverUrl, 960) ?? prompt.coverUrl} 960w`
                    : undefined
                }
                sizes="(max-width: 640px) 100vw, 960px"
                alt={prompt.title}
                className="prompt-detail__cover"
                loading="eager"
                decoding="sync"
                fetchPriority="high"
              />
            )}
          </div>
        )}

        <h1 className="prompt-detail__title">{prompt.title}</h1>

        {/* 4 格 meta grid（Date / Tags / Models / Source） */}
        <div className="prompt-detail__meta-grid">
          <div className="meta-cell">
            <div className="meta-label">{t('date')}</div>
            <time className="meta-value">{formatDate(prompt.promptDate, locale)}</time>
          </div>

          {prompt.tags.length > 0 && (
            <div className="meta-cell">
              <div className="meta-label">{t('tags')}</div>
              <div className="meta-value meta-tags">
                {prompt.tags.map((tag) => (
                  <Link key={tag.slug} href={tagHref(locale, tag.slug)} className="meta-link">
                    {tag.name}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {prompt.models.length > 0 && (
            <div className="meta-cell">
              <div className="meta-label">{t('models')}</div>
              <div className="meta-value meta-models">
                {prompt.models.map((m) => (
                  <Link key={m.slug} href={modelHref(locale, m.slug)} className="meta-link meta-link--model">
                    {m.name}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {prompt.sourceUrl && (
            <div className="meta-cell">
              <div className="meta-label">{t('source')}</div>
              <div className="meta-value">
                <a
                  href={prompt.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="meta-link meta-link--source"
                >
                  {prompt.author ||
                    new URL(prompt.sourceUrl).pathname.split('/').filter(Boolean).slice(-1)[0] ||
                    t('source')}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="meta-ext-icon" aria-hidden="true">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Copy prompt 区块 */}
        <section className="prompt-detail__copy">
          <div className="copy-header">
            <h2>{t('copyPromptTitle')}</h2>
            <CopyButton text={prompt.description} promptName={prompt.title} />
          </div>
          <div className="copy-body" title={t('clickToCopyHint')}>
            {paragraphs.length > 1 ? (
              paragraphs.map((p, i) => (
                <p key={i} className="copy-paragraph">{p}</p>
              ))
            ) : (
              <p className="copy-paragraph">{prompt.description}</p>
            )}
          </div>
        </section>

        {/* You Might Also Like */}
        {related.length > 0 && (
          <section className="prompt-detail__related">
            <h2>{t('youMightAlsoLike')}</h2>
            <GridEngine
              initialItems={related}
              total={related.length}
              initialPage={1}
              pageSize={related.length}
              locale={locale}
            />
          </section>
        )}

        {/* 上下篇 */}
        {(prev || next) && (
          <nav className="prompt-detail__nav" aria-label="Prompt navigation">
            {prev ? (
              <Link href={`/${locale}/prompts/${prev.slug}`} className="nav-link nav-link--prev">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {prev.coverUrl && <img src={prev.coverUrl} alt="" className="nav-thumb" />}
                <span className="nav-text">
                  <span className="nav-label">{t('previous')}</span>
                  <span className="nav-title">{prev.title}</span>
                </span>
              </Link>
            ) : <span />}
            {next ? (
              <Link href={`/${locale}/prompts/${next.slug}`} className="nav-link nav-link--next">
                <span className="nav-text">
                  <span className="nav-label">{t('next')}</span>
                  <span className="nav-title">{next.title}</span>
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {next.coverUrl && <img src={next.coverUrl} alt="" className="nav-thumb" />}
              </Link>
            ) : <span />}
          </nav>
        )}
      </main>

      <Footer locale={locale} />
    </>
  );
}
