/**
 * PromptCard — 瀑布流卡片
 * Server Component 主结构 + click-to-copy（client handler via useState）
 *
 * 行为：
 *   - 点击卡片：复制 description 到剪贴板 + ✓ Copied! 反馈
 *   - hover：image 保持，video 自动加载并 play（PromptCardVideo）
 *   - 视觉对齐 awesomevideoprompts.com：natural aspect ratio、model badge、tags
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { PromptCardData } from './types';
import PromptCardVideo from './PromptCardVideo';

interface Props {
  prompt: PromptCardData;
  locale: string;
}

export function PromptCard({ prompt, locale }: Props) {
  const t = useTranslations('card');
  const detailHref = `/${locale}/prompts/${prompt.slug}`;
  const modelLabel = prompt.models[0]?.slug ?? '';
  const modelDisplayName = prompt.models[0]?.name ?? '';
  const tagsAttr = prompt.tags.map((tt) => tt.slug).join(',');
  const modelAttr = prompt.models.map((m) => m.slug).join(',');

  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    if (!prompt.description) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(prompt.description);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback: execCommand
      const ta = document.createElement('textarea');
      ta.value = prompt.description;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {}
      document.body.removeChild(ta);
    }
  }

  return (
    <article
      className="prompt-card"
      data-tags={tagsAttr}
      data-model={modelAttr}
      data-prompt-name={prompt.slug}
      data-copied={copied || undefined}
      onClick={handleCopy}
      role="button"
      tabIndex={0}
      title={t('clickToCopyTitle')}
      style={{ cursor: 'pointer' }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCopy(e as unknown as React.MouseEvent);
        }
      }}
    >
      {prompt.coverUrl && (
        <div className="prompt-image-wrapper">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={prompt.coverUrl}
            alt={prompt.title}
            className="prompt-image"
            loading="lazy"
            decoding="async"
          />

          {modelLabel && (
            <Link
              href={`/${locale}?model=${modelLabel}`}
              className="model-badge"
              data-model-key={modelLabel}
              onClick={(e) => e.stopPropagation()}
            >
              {modelDisplayName}
            </Link>
          )}

          {prompt.videoUrl && (
            <PromptCardVideo src={prompt.videoUrl} title={prompt.title} />
          )}

          <div className="prompt-overlay">
            <span className="hover-text">{copied ? t('copied') : t('hoverHint')}</span>
          </div>
        </div>
      )}

      <div className="prompt-content">
        <h3 className="prompt-title">
          <Link href={detailHref} onClick={(e) => e.stopPropagation()} style={{ color: 'inherit', textDecoration: 'none' }}>
            {prompt.title}
          </Link>
        </h3>

        {prompt.tags.length > 0 && (
          <div className="prompt-tags">
            {prompt.tags.slice(0, 4).map((tag) => (
              <Link
                key={tag.slug}
                href={`/${locale}?tag=${tag.slug}`}
                className="prompt-tag"
                onClick={(e) => e.stopPropagation()}
              >
                {tag.name}
              </Link>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
