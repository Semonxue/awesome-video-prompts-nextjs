'use client';

/**
 * PromptCard — 瀑布流卡片（CSS Grid + grid-row span）
 *
 * 行为：
 *   - 缩略图 hover → PromptCardVideo 自动加载并播放（无缝替换 cover）
 *   - 缩略图 click 或 提示词文字 click → 复制 description 到剪贴板 + ✓ Copied! 反馈
 *   - 标题 / model badge / tag click → 跳转（stopPropagation 阻止冒泡）
 *   - hover 缩略图 / hover 提示词文字 → 不同视觉反馈（区分两者）
 *   - 视觉对齐 awesomevideoprompts.com：natural aspect ratio、model badge、tags、author/date
 *
 * 瀑布流实现：
 *   - .prompt-grid 用 grid-auto-rows: 10px + grid-auto-flow: dense
 *   - 每张卡按"图片 natural w/h + 内容区固定高"算出 grid-row span
 *   - 通过 inline style 注入 --card-rows CSS var（fallback 22 rows）
 *   - 图片宽/高比由 .prompt-image-wrapper 的 padding-bottom hack 实现（不依赖 grid 宽度）
 *
 * Perf 优化（P0 Phase 4）：
 *   - 首张卡片：fetchpriority="high" + decoding="sync"（LCP）
 *   - 其余卡片：loading="lazy" + decoding="async"
 *   - 图片走 R2 Transform WebP（?width=N&format=webp&q=75）
 *   - PromptCardVideo 动态 import（bundle 拆分）
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import type { PromptCardData } from './types';
import type { PromptCardVideoHandle } from './PromptCardVideo';

/** PromptCardVideo 动态 import（不在首屏 bundle 里） */
const PromptCardVideo = dynamic(() => import('./PromptCardVideo'), { ssr: false });

/**
 * R2 Transform URL 注释（2026-06-26）：
 * R2 自定义域（static.awesomevideoprompts.com）不支持 transform 参数
 * Cloudflare Image Resizing 需要 Cloudflare Images 订阅 或 Workers 代理
 * 当前：srcset 仍按 R2 Transform 格式拼接，CF 若不支持则降级原图
 * TODO：等 Phase 5 实装 Cloudflare Workers 图片代理（完整版 OG image 一起做）
 */
const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? '';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function r2Webp(url: string | null, _width: number): string | null {
  if (!url) return null;
  // 当前 R2 自定义域不支持 transform；srcset 按理想格式拼接，由 CF 降级
  // 未来实装 Workers 代理后改为：return `${url}?width=${width}&format=webp&q=75`;
  return url;
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

interface Props {
  prompt: PromptCardData;
  locale: string;
  /** 首张卡片（isFirst=true）：fetchpriority=high + decoding=sync，用于 LCP 优化 */
  isFirst?: boolean;
}

/** grid-auto-rows 10px + gap 16px → 每 row 实际占 26px（除最后一行） */
const ROW_HEIGHT = 10;
const ROW_GAP = 16;
/** fallback span：约 22*26 = 572px 高（aspect 16:9 + 约 130px content） */
const DEFAULT_ROWS = 22;
/** 内容区估算高度（含 title 2 行 / description 2 行 / tags / meta），用于计算总 span */
const ESTIMATED_CONTENT_HEIGHT = 130;

export function PromptCard({ prompt, locale, isFirst = false }: Props) {
  const t = useTranslations('card');
  const detailHref = `/${locale}/prompts/${prompt.slug}`;
  const modelLabel = prompt.models[0]?.slug ?? '';
  const modelDisplayName = prompt.models[0]?.name ?? '';
  const tagsAttr = prompt.tags.map((tt) => tt.slug).join(',');
  const modelAttr = prompt.models.map((m) => m.slug).join(',');

  const [copied, setCopied] = useState(false);
  const [aspect, setAspect] = useState<number | null>(null);
  const videoRef = useRef<PromptCardVideoHandle>(null);

  // 读封面图 naturalW/naturalH → 计算 wrapper 的 padding-bottom %
  // 然后根据当前 grid 列宽 + 内容区高度算出 grid-row span
  // 注意：aspect-ratio 用 R2 transform 后的 WebP URL 计算（宽高比一致）
  useEffect(() => {
    if (!prompt.coverUrl) return;
    setAspect(null);
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setAspect(img.naturalWidth / img.naturalHeight);
      }
    };
    img.onerror = () => {
      setAspect(16 / 9);
    };
    // 用 R2 WebP URL 预加载以获取正确的 naturalWidth/Height
    img.src = r2Webp(prompt.coverUrl, 480) ?? prompt.coverUrl;
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

  // 计算 grid-row span: 基于当前实际 .prompt-grid 列宽 + 图片 aspect
  const cardRef = useRef<HTMLElement>(null);
  const [rows, setRows] = useState<number>(DEFAULT_ROWS);

  useEffect(() => {
    if (!aspect || !cardRef.current) return;
    const grid = cardRef.current.parentElement;
    if (!grid) return;

    function recalc() {
      if (!grid || !cardRef.current || !aspect) return;
      const colW = (grid.getBoundingClientRect().width - ROW_GAP * (getColumnCount() - 1)) / getColumnCount();
      if (colW <= 0) return;
      const imgH = colW / aspect;
      const totalH = imgH + ESTIMATED_CONTENT_HEIGHT;
      // N rows 实际占 = N * (ROW_HEIGHT + ROW_GAP) - ROW_GAP
      // totalH = N * (ROW_HEIGHT + ROW_GAP) - ROW_GAP → N = (totalH + ROW_GAP) / (ROW_HEIGHT + ROW_GAP)
      const nextRows = Math.max(8, Math.ceil((totalH + ROW_GAP) / (ROW_HEIGHT + ROW_GAP)));
      setRows(nextRows);
    }

    function getColumnCount(): number {
      if (!grid) return 5;
      const w = grid.getBoundingClientRect().width;
      if (w < 640) return 2;
      if (w < 900) return 3;
      if (w < 1200) return 4;
      return 5;
    }

    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [aspect]);

  // CSS 变量：--card-aspect（wrapper padding-bottom 用）+ --card-rows（grid-row span 用）
  const cardStyle: React.CSSProperties = {
    ...(aspect ? ({ ['--card-aspect' as string]: aspect } as React.CSSProperties) : {}),
    ['--card-rows' as string]: rows,
    cursor: 'pointer',
  };

  return (
    <article
      ref={cardRef}
      className="prompt-card"
      data-tags={tagsAttr}
      data-model={modelAttr}
      data-prompt-name={prompt.slug}
      data-copied={copied || undefined}
      onClick={handleCopy}
      role="button"
      tabIndex={0}
      title={t('clickToCopyTitle')}
      style={cardStyle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleCopy(e);
        }
      }}
    >
      {prompt.coverUrl && (
        <div
          className="prompt-image-wrapper"
          style={aspect ? { paddingBottom: `${(1 / aspect) * 100}%` } : undefined}
          onMouseEnter={() => {
            videoRef.current?.play();
          }}
          onMouseLeave={() => {
            videoRef.current?.pause();
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={r2Webp(prompt.coverUrl, 480) ?? prompt.coverUrl ?? undefined}
            srcSet={
              prompt.coverUrl
                ? `${r2Webp(prompt.coverUrl, 320) ?? prompt.coverUrl} 320w, ${r2Webp(prompt.coverUrl, 480) ?? prompt.coverUrl} 480w, ${r2Webp(prompt.coverUrl, 768) ?? prompt.coverUrl} 768w`
                : undefined
            }
            sizes="(max-width: 640px) 50vw, (max-width: 900px) 33vw, (max-width: 1200px) 25vw, 20vw"
            alt={prompt.title}
            className="prompt-image"
            loading={isFirst ? 'eager' : 'lazy'}
            decoding={isFirst ? 'sync' : 'async'}
            fetchPriority={isFirst ? 'high' : undefined}
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
