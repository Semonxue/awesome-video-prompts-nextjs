'use client';

/**
 * GridEngine — 真瀑布流（CSS Grid + grid-auto-rows + grid-row span）+ 触底加载
 *
 * 设计：
 *   - 5 列 CSS Grid + grid-auto-rows: 10px + grid-auto-flow: dense
 *   - 每张卡由 PromptCard 自算 --card-rows（图片 aspect 决定）
 *   - 触底加载：IntersectionObserver 监听 sentinel，触发 router.push(nextPageUrl)
 *   - 加载中状态：底部显示极简 spinner
 *
 * 数据契约：分页由父组件用 URL ?page=N 驱动，nextPageUrl 给出"下一页完整 URL"
 *           GridEngine 只负责触发导航，不直接 fetch 数据（让 ISR 缓存生效）
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PromptCard } from './PromptCard';
import type { PromptCardData } from './types';

interface Props {
  items: PromptCardData[];
  locale: string;
  total: number;
  hasMore?: boolean;
  /** 下一页完整 URL（保留 search params）；null = 已到末页 */
  nextPageUrl?: string | null;
  /** 加载中文案（i18n） */
  loadingText?: string;
}

export function GridEngine({ items, locale, hasMore, nextPageUrl, loadingText }: Props) {
  const t = useTranslations('grid');
  const router = useRouter();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);

  // 触底加载（next 页面 URL 已由父组件拼好，router.push 即可）
  useEffect(() => {
    if (!hasMore || !nextPageUrl || !sentinelRef.current) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isLoading) {
          setIsLoading(true);
          router.push(nextPageUrl);
        }
      },
      { rootMargin: '400px' },
    );
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [hasMore, nextPageUrl, isLoading, router]);

  // 路由切换完成 → 重置 loading（best-effort；新页 items 变化时组件会 re-render）
  useEffect(() => {
    setIsLoading(false);
  }, [items.length]);

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

      {/* 触底 sentinel：hasMore 时显示 loading + 继续监听，否则纯末尾 */}
      {hasMore && (
        <div ref={sentinelRef} className="grid-sentinel" aria-hidden="true">
          {isLoading && (
            <div className="grid-loading">
              <span className="grid-spinner" />
              <span className="grid-loading-text">{loadingText ?? t('loadingMore')}</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
