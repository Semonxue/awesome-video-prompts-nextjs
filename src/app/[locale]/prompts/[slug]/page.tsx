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
import { getPromptBySlug, getPromptBySlugCached, listRecentPromptsCached, listAllModels, listAllTags } from '@/db/queries';
import { formatModelName } from '@/lib/format';
import { SITE_URL, R2_PUBLIC_URL } from '@/lib/site';

function r2Webp(url: string | null, _width: number): string | null {
  // 当前 R2 自定义域不支持 transform；CF 降级到原图
  return url;
}

export const revalidate = 3600;

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
  const canonical = `${SITE_URL}/${locale}/prompts/${slug}`;
  const description = prompt.description.replace(/\s+/g, ' ').trim().slice(0, 160);
  const ogImage = prompt.coverUrl
    ? [{ url: prompt.coverUrl, width: 960, height: 540 }]
    : [];
  return {
    title: prompt.title,
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
      title: prompt.title,
      description,
      url: canonical,
      images: ogImage,
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: prompt.title,
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

  // 相关推荐：同 model 优先 + tag 重叠打分，取前 6
  // Perf 优化（2026-08-06 Error 1102 修复）：limit 200 → 48
  //   之前每次详情页渲染拉 200 条 + hydrate 4 次 D1 查询，是 CPU 超限主因之一。
  //   相关推荐只需 6 条，上下篇只需相邻 2 条，48 条足够覆盖（同 model 的 prompt 通常在前 48 条内）。
  // Perf 优化（2026-08-07）：改用跨实例缓存版本，避免每次详情页渲染都查 D1
  const allResult = await listRecentPromptsCached(48);
  const related = allResult.items
    .filter((p) => p.slug !== prompt.slug)
    .map((p) => {
      let score = 0;
      if (p.models.some((m) => prompt.models.some((pm) => pm.slug === m.slug))) score += 10;
      const overlap = p.tags.filter((t) => prompt.tags.some((pt) => pt.slug === t.slug)).length;
      score += overlap * 2;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((x) => x.p);

  // 上下篇
  const sortedByDate = [...allResult.items].sort((a, b) =>
    (b.promptDate ?? '').localeCompare(a.promptDate ?? ''),
  );
  const idx = sortedByDate.findIndex((p) => p.slug === prompt.slug);
  const prev = idx > 0 ? sortedByDate[idx - 1] : undefined;
  const next = idx >= 0 && idx < sortedByDate.length - 1 ? sortedByDate[idx + 1] : undefined;

  // Header 数据（不分 locale）
  const [modelOptions, tagOptions] = await Promise.all([listAllModels(), listAllTags()]);

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

      <Header
        locale={locale}
        modelOptions={modelOptions}
        tagOptions={tagOptions}
        totalCount={allResult.total}
      />

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
                  <Link key={tag.slug} href={`/${locale}?tag=${tag.slug}`} className="meta-link">
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
                  <Link key={m.slug} href={`/${locale}?model=${m.slug}`} className="meta-link meta-link--model">
                    {formatModelName(m.slug)}
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
