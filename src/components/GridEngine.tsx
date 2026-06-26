'use client';

/**
 * GridEngine — 5 列 CSS Grid（去掉 masonry-layout）
 *
 * 设计：
 *   - CSS Grid 5 列 + gap 16，每张卡按自己的 --card-aspect 决定高度（自然比例）
 *   - 响应式：≥1200 5 列 / ≥900 4 列 / ≥640 3 列 / 默认 2 列
 *   - 触底加载：IntersectionObserver（保持不变）
 *   - 视频加载并发由 PromptCardVideo 内部 videoLoadQueue 限制（最多 2 个）
 */

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { PromptCard } from './PromptCard';
import type { PromptCardData } from './types';

interface Props {
  items: PromptCardData[];
  locale: string;
  total: number;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

export function GridEngine({ items, locale, hasMore, onLoadMore }: Props) {
  const t = useTranslations('grid');
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 触底加载
  useEffect(() => {
    if (!hasMore || !sentinelRef.current || !onLoadMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { rootMargin: '400px' },
    );
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [hasMore, onLoadMore]);

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <p>{t('noPrompts')}</p>
      </div>
    );
  }

  return (
    <>
      <div className="prompt-grid" data-total={items.length}>
        {items.map((p) => (
          <PromptCard key={p.slug} prompt={p} locale={locale} />
        ))}
      </div>
      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
    </>
  );
}