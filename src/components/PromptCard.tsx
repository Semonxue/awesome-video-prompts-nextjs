/**
 * PromptCard — 提示词卡片
 * Server Component 主结构 + PromptCardVideo（client）做 hover 自动播放
 */
import Link from 'next/link';
import type { Locale } from '@/i18n/request';
import type { PromptCardData } from './types';
import TagDisplay from './TagDisplay';
import PromptCardVideo from './PromptCardVideo';

interface PromptCardProps {
  prompt: PromptCardData;
  locale: Locale;
}

export default function PromptCard({ prompt, locale }: PromptCardProps) {
  const detailHref = `/${locale}/prompts/${prompt.slug}`;
  const tagsAttr = prompt.tags.map((t) => t.slug).join(',');
  const modelAttr = prompt.models.map((m) => m.slug).join(',');

  return (
    <article
      className="prompt-card"
      data-tags={tagsAttr}
      data-model={modelAttr}
      data-prompt-name={prompt.slug}
    >
      {prompt.coverUrl && (
        <div className="prompt-image-wrapper">
          <img
            src={prompt.coverUrl}
            alt={prompt.title}
            className="prompt-image"
            loading="lazy"
            decoding="async"
          />

          {prompt.models.map((m) => (
            <span key={m.slug} className="model-badge" data-model-key={m.slug}>
              {m.name}
            </span>
          ))}

          {prompt.videoUrl && (
            <PromptCardVideo src={prompt.videoUrl} title={prompt.title} />
          )}

          <div className="prompt-overlay">
            <span className="hover-text">Hover to play</span>
          </div>
        </div>
      )}

      <div className="prompt-content">
        <h3 className="prompt-title">
          <Link href={detailHref} style={{ color: 'inherit', textDecoration: 'none' }}>
            {prompt.title}
          </Link>
        </h3>

        {prompt.description && (
          <p
            className="prompt-description"
            data-hint="Click to copy"
            title="Copy prompt"
            style={{ cursor: 'pointer' }}
          >
            <span className="prompt-description-text">{prompt.description}</span>
          </p>
        )}

        {prompt.tags.length > 0 && (
          <div className="prompt-tags">
            {prompt.tags.map((tag) => (
              <span key={tag.slug} className="prompt-tag">
                <TagDisplay tag={tag.slug} locale={locale} />
              </span>
            ))}
          </div>
        )}

        {(prompt.author || prompt.promptDate) && (
          <div className="prompt-meta">
            {prompt.author && (
              <div className="prompt-author">
                <span className="author-label">By</span>
                {prompt.sourceUrl ? (
                  <a
                    href={prompt.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="author-name"
                  >
                    {prompt.author}
                  </a>
                ) : (
                  <span className="author-name">{prompt.author}</span>
                )}
              </div>
            )}
            {prompt.promptDate && (
              <div className="prompt-date">{prompt.promptDate}</div>
            )}
          </div>
        )}

        <div className="prompt-actions" />
      </div>
    </article>
  );
}