'use client';

/**
 * GridEngine — 提示词网格容器
 *
 * Phase 1：CSS columns 瀑布流（无 JS masonry）+ IntersectionObserver 加载更多占位
 * Phase 3：替换为更精确的 masonry 算法（如果性能需要）
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/request';
import type { PromptCardData } from './types';
import PromptCard from './PromptCard';

interface GridEngineProps {
  prompts: PromptCardData[];
  locale: Locale;
  /** 初始渲染条数（Phase 3 实装分页） */
  initialLimit?: number;
  /** 每次加载更多条数 */
  pageSize?: number;
}

export default function GridEngine({
  prompts,
  locale,
  initialLimit = 24,
  pageSize = 24,
}: GridEngineProps) {
  const t = useTranslations();
  const [visibleCount, setVisibleCount] = useState(Math.min(initialLimit, prompts.length));
  const sentinelRef = useRef<HTMLDivElement>(null);

  // IntersectionObserver — 触底加载
  useEffect(() => {
    if (visibleCount >= prompts.length) return;
    const el = sentinelRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((v) => Math.min(v + pageSize, prompts.length));
        }
      },
      { rootMargin: '200px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visibleCount, prompts.length, pageSize]);

  if (prompts.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '64px 24px' }}>
        <h2 style={{ fontSize: 20, marginBottom: 8 }}>{t('empty.title')}</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 4 }}>
          {t('empty.noResults')}
        </p>
        <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginTop: 12 }}>
          {t('empty.phaseOneHint')}
        </p>
      </div>
    );
  }

  const visible = prompts.slice(0, visibleCount);
  const hasMore = visibleCount < prompts.length;

  return (
    <>
      <div
        className="masonry-grid"
        style={{
          columnCount: 3,
          columnGap: 16,
        }}
      >
        {visible.map((prompt) => (
          <div
            key={prompt.slug}
            style={{
              breakInside: 'avoid',
              marginBottom: 16,
              display: 'inline-block',
              width: '100%',
            }}
          >
            <PromptCard prompt={prompt} locale={locale} />
          </div>
        ))}
      </div>

      {hasMore && (
        <div ref={sentinelRef} className="loading-more">
          <div className="loading-spinner" />
          <span className="loading-text">{t('common.loading')}</span>
        </div>
      )}
    </>
  );
}