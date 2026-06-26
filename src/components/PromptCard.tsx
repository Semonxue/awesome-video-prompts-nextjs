'use client';

/**
 * PromptCard — 瀑布流卡片（5 列 CSS Grid + natural aspect ratio）
 *
 * 行为：
 *   - 缩略图 hover → PromptCardVideo 自动加载并播放（无缝替换 cover）
 *   - 缩略图 click 或 提示词文字 click → 复制 description 到剪贴板 + ✓ Copied! 反馈
 *   - 标题 / model badge / tag click → 跳转（stopPropagation 阻止冒泡）
 *   - hover 缩略图 / hover 提示词文字 → 不同视觉反馈（区分两者）
 *   - 视觉对齐 awesomevideoprompts.com：natural aspect ratio、model badge、tags、author/date
 *
 * 数据契约：图片 naturalW/naturalH 在客户端 useEffect 后注入 --card-aspect CSS var，
 *           .prompt-image-wrapper 继承此 aspect-ratio 实现"比例跟随原图"。
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { PromptCardData } from './types';
import PromptCardVideo, { type PromptCardVideoHandle } from './PromptCardVideo';

function truncate(s: string, n: number): string {
  if (!s) return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

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
  const [aspect, setAspect] = useState<number | null>(null);
  const videoRef = useRef<PromptCardVideoHandle>(null);

  // 读封面图 naturalW/naturalH → 注入 CSS var，让 wrapper 跟随原图比例
  useEffect(() => {
    if (!prompt.coverUrl) return;
    // 重置（locale 切换时 URL 可能变）
    setAspect(null);
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setAspect(img.naturalWidth / img.naturalHeight);
      }
    };
    img.onerror = () => {
      // 加载失败 → fallback 16/9
      setAspect(16 / 9);
    };
    img.src = prompt.coverUrl;
  }, [prompt.coverUrl]);

  async function handleCopy(e?: React.MouseEvent | React.KeyboardEvent) {
    if (!prompt.description) return;
    e?.preventDefault?.();
    e?.stopPropagation?.();
    try {
      await navigator.clipboard.writeText(prompt.description);
      flashCopied();
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
        flashCopied();
      } catch {
        /* give up */
      }
      document.body.removeChild(ta);
    }
  }

  function flashCopied() {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const cardStyle = aspect ? ({ ['--card-aspect' as string]: aspect } as React.CSSProperties) : undefined;

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
      style={{ ...cardStyle, cursor: 'pointer' }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleCopy(e);
        }
      }}
    >
      {prompt.coverUrl && (
        <div
          className="prompt-image-wrapper"
          onMouseEnter={() => {
            videoRef.current?.play();
          }}
          onMouseLeave={() => {
            videoRef.current?.pause();
          }}
        >
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

          {/* 复制反馈 toast（替代 overlay 文字，更明显） */}
          <div className="prompt-copy-toast" aria-live="polite">
            {copied ? t('copied') : ''}
          </div>

          {prompt.videoUrl && (
            <PromptCardVideo ref={videoRef} src={prompt.videoUrl} title={prompt.title} />
          )}

          {/* hover 提示层（不拦截 click，视频播放时淡出） */}
          <div className="prompt-overlay" aria-hidden="true">
            <span className="hover-text">{t('hoverHint')}</span>
          </div>
        </div>
      )}

      <div className="prompt-content">
        <h3 className="prompt-title">
          <Link
            href={detailHref}
            onClick={(e) => e.stopPropagation()}
            style={{ color: 'inherit', textDecoration: 'none' }}
          >
            {prompt.title}
          </Link>
        </h3>

        {prompt.description && (
          <p
            className="prompt-description"
            onClick={handleCopy}
            title={t('clickToCopyTitle')}
          >
            <span className="prompt-description-text">{truncate(prompt.description, 180)}</span>
          </p>
        )}

        <div className="prompt-meta">
          {prompt.author && (
            <span className="prompt-author">
              <span className="author-label">By</span>{' '}
              {prompt.sourceUrl ? (
                <a
                  href={prompt.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="author-name"
                  onClick={(e) => e.stopPropagation()}
                >
                  {prompt.author}
                </a>
              ) : (
                <span className="author-name">{prompt.author}</span>
              )}
            </span>
          )}
          {prompt.promptDate && <span className="prompt-date">{prompt.promptDate}</span>}
        </div>

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