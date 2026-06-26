/**
 * 详情页 /[locale]/prompts/[slug]
 * 视觉对齐 awesomevideoprompts.com/prompts/[slug]/：
 *   - H1 标题
 *   - 4 格 meta grid：Date / Tags / Models / Source
 *   - Copy prompt 区块（H2 + 按钮 + 段落描述）
 *   - You Might Also Like（6 张相关 prompt-card）
 *   - 上下篇导航
 */
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import CopyButton from '@/components/CopyButton';
import { GridEngine } from '@/components/GridEngine';
import { getPromptBySlug, listPrompts, listAllModels, listAllTags } from '@/db/queries';
import { formatModelName } from '@/lib/format';

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
  const prompt = await getPromptBySlug(slug);
  if (!prompt) return { title: 'Prompt not found' };
  return {
    title: `${prompt.title} | Awesome Video Prompts`,
    description: prompt.description.slice(0, 160),
    openGraph: {
      title: prompt.title,
      description: prompt.description.slice(0, 160),
      images: prompt.coverUrl ? [prompt.coverUrl] : [],
    },
  };
}

export default async function PromptDetailPage({ params }: Props) {
  const { locale, slug } = await params;
  const t = await getTranslations('detail');
  if (!['en', 'zh', 'ja'].includes(locale)) notFound();

  // 内容不分 locale：slug 全局唯一；locale 仅用于 UI（next-intl）
  const prompt = await getPromptBySlug(slug);
  if (!prompt) notFound();

  // 相关推荐：同 model 优先 + tag 重叠打分，取前 6
  const allResult = await listPrompts({ limit: 200 });
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

  return (
    <>
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
                poster={prompt.coverUrl ?? undefined}
                className="prompt-detail__video"
              />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={prompt.coverUrl!} alt={prompt.title} className="prompt-detail__cover" />
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
            <CopyButton text={prompt.description} />
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
            <GridEngine items={related} locale={locale} total={related.length} />
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
