/**
 * 详情页 — 单个提示词
 * Server Component，按 slug + locale 查 D1
 * Phase 1：getPromptBySlug 返回 null → notFound()
 * Phase 2：实装后渲染真实提示词
 */
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { locales, type Locale } from '@/i18n/request';
import { getPromptBySlug } from '@/db/queries';
import CopyButton from '@/components/CopyButton';
import TagDisplay from '@/components/TagDisplay';

interface PromptDetailPageProps {
  params: Promise<{ locale: string; slug: string }>;
}

// ISR 1h
export const revalidate = 3600;

/**
 * 生成详情页 metadata — 标题/描述/OG 等
 * Phase 2 实装：按 slug 查 D1 → 拿 prompt.title / description / coverUrl
 */
export async function generateMetadata({
  params,
}: PromptDetailPageProps): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  if (!locales.includes(rawLocale as Locale)) return {};
  const locale = rawLocale as Locale;

  const prompt = await getPromptBySlug(locale, slug);

  if (!prompt) {
    // Phase 1：slug 不存在 → 通用 metadata
    return { title: 'Prompt not found' };
  }

  return {
    title: prompt.title,
    description: prompt.description.slice(0, 160),
    openGraph: {
      title: prompt.title,
      description: prompt.description.slice(0, 160),
      images: prompt.coverUrl ? [{ url: prompt.coverUrl }] : undefined,
    },
  };
}

export default async function PromptDetailPage({ params }: PromptDetailPageProps) {
  const { locale: rawLocale, slug } = await params;
  if (!locales.includes(rawLocale as Locale)) notFound();
  const locale = rawLocale as Locale;

  const t = await getTranslations();
  const prompt = await getPromptBySlug(locale, slug);
  if (!prompt) notFound();

  return (
    <article className="main-content" style={{ maxWidth: 800 }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>
          {prompt.title}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          {prompt.author && (
            <>
              <span>{t('prompt.byAuthor')} </span>
              {prompt.sourceUrl ? (
                <a
                  href={prompt.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  {prompt.author}
                </a>
              ) : (
                <span>{prompt.author}</span>
              )}
              {' · '}
            </>
          )}
          {prompt.promptDate && <span>{prompt.promptDate}</span>}
        </p>
      </header>

      {prompt.coverUrl && (
        <div style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 24 }}>
          <img
            src={prompt.coverUrl}
            alt={prompt.title}
            style={{ width: '100%', display: 'block' }}
          />
        </div>
      )}

      <section
        style={{
          padding: 20,
          background: 'var(--bg-muted)',
          borderRadius: 12,
          marginBottom: 24,
          position: 'relative',
        }}
      >
        <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, margin: 0 }}>
          {prompt.description || t('prompt.noDescription')}
        </p>
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <CopyButton text={prompt.description} variant="text" />
        </div>
      </section>

      {prompt.tags.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
            {t('prompt.tags')}
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {prompt.tags.map((tag) => (
              <span
                key={tag.slug}
                style={{
                  padding: '4px 10px',
                  background: 'var(--bg-muted)',
                  borderRadius: 16,
                  fontSize: 12,
                }}
              >
                <TagDisplay tag={tag.slug} locale={locale} />
              </span>
            ))}
          </div>
        </section>
      )}

      {prompt.videoUrl && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
            {t('prompt.watchVideo')}
          </h2>
          <video
            src={prompt.videoUrl}
            controls
            playsInline
            style={{ width: '100%', borderRadius: 12 }}
          />
        </section>
      )}
    </article>
  );
}