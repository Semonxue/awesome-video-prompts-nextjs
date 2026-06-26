'use client';

/**
 * GridEngine — 真瀑布流（CSS Grid）+ 真 infinite scroll（客户端累积）
 *
 * 架构：
 *   - SSR 渲染首批 items（首屏 + SEO + ISR 缓存命中）
 *   - IntersectionObserver 监听 sentinel，触底 fetch('/api/prompts?...') 拿增量
 *   - 客户端 useState 累积 items[]，新数据 append 到末尾
 *   - 滚动位置自然延续（不重置到顶部，因为 DOM 增长而非替换）
 *
 * 与之前实现的区别：
 *   - 旧：触底 router.push(?page=N) → 整页跳，URL 变化，体验差
 *   - 新：触底 fetch JSON → append items，URL 不变，体验是真 infinite scroll
 *
 * SEO 影响：
 *   - 首屏 24 条仍是 SSR（搜索引擎可见）
 *   - 后续增量由客户端 fetch JSON 拉取（深页对 SEO 价值低，可接受）
 *   - URL 保留 `?page=N` 直接访问：服务端仍按 page 渲染（保兼容性）
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PromptCard } from './PromptCard';
import type { PromptCardData } from './types';

interface Props {
  /** 服务端 SSR 渲染的首批 items（page 1 或 URL 指定页） */
  initialItems: PromptCardData[];
  /** 全集总数（用于 "X prompts found" 展示与 hasMore 判断） */
  total: number;
  /** 过滤条件（用于增量 fetch 时复用） */
  filters?: { tag?: string; model?: string; q?: string };
  /** 初始页码（URL ?page=N，默认 1） */
  initialPage?: number;
  /** 每页条数（默认 24，必须与 API endpoint 一致） */
  pageSize?: number;
  /** locale（用于卡片 href） */
  locale: string;
}

interface ApiResponse {
  items: PromptCardData[];
  total: number;
  hasMore: boolean;
  nextPage: number | null;
}

const DEFAULT_PAGE_SIZE = 24;

export function GridEngine({
  initialItems,
  total,
  filters,
  initialPage = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  locale,
}: Props) {
  const t = useTranslations('grid');

  // 累积的 items（SSR 首批 + 客户端追加）
  const [items, setItems] = useState<PromptCardData[]>(initialItems);
  // 下一页页码（null = 已到末页）
  const [nextPage, setNextPage] = useState<number | null>(
    initialItems.length < pageSize * initialPage
      ? null
      : initialPage + 1,
  );
  const [isLoading, setIsLoading] = useState(false);
  // 防止 IntersectionObserver 在快速滚动时多次触发
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 当过滤条件 / initialPage 变化时（例如 URL ?page=N 直访），重置累积
  // 关键：useState 的 lazy initializer 已经处理了 initialItems 同步
  // 这里只需要在 props 变化时 reset（client-side navigation 时）
  useEffect(() => {
    setItems(initialItems);
    setNextPage(
      initialItems.length < pageSize * initialPage ? null : initialPage + 1,
    );
  }, [initialItems, initialPage, pageSize]);

  // 拉取下一页
  const fetchNextPage = useCallback(async () => {
    if (loadingRef.current || nextPage === null) return;
    loadingRef.current = true;
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(nextPage));
      if (filters?.tag) params.set('tag', filters.tag);
      if (filters?.model) params.set('model', filters.model);
      if (filters?.q) params.set('q', filters.q);

      const res = await fetch(`/api/prompts?${params.toString()}`);
      if (!res.ok) {
        console.error('[GridEngine] fetch failed', res.status);
        return;
      }
      const data: ApiResponse = await res.json();
      // 累积：append 到末尾（去重 by slug，防止重复挂载）
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.slug));
        const fresh = data.items.filter((p) => !seen.has(p.slug));
        return [...prev, ...fresh];
      });
      setNextPage(data.nextPage);
    } catch (err) {
      console.error('[GridEngine] fetch error', err);
    } finally {
      loadingRef.current = false;
      setIsLoading(false);
    }
  }, [nextPage, filters]);

  // IntersectionObserver 监听 sentinel
  useEffect(() => {
    if (nextPage === null) return;
    const el = sentinelRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingRef.current) {
          fetchNextPage();
        }
      },
      { rootMargin: '600px' }, // 提前 600px 触发，让用户感知不到 loading
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [nextPage, fetchNextPage]);

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <p>{t('noPrompts')}</p>
      </div>
    );
  }

  const hasMore = nextPage !== null;

  return (
    <>
      <div className="prompt-grid" data-total={items.length}>
        {items.map((p, i) => (
          <PromptCard key={p.slug} prompt={p} locale={locale} isFirst={i === 0} />
        ))}
      </div>

      {/* sentinel：hasMore 时始终保留在 DOM 末尾供 IO 监听 */}
      <div ref={sentinelRef} className="grid-sentinel" aria-hidden="true">
        {hasMore && (
          <div className="grid-loading">
            <span className="grid-spinner" />
            <span className="grid-loading-text">{t('loadingMore')}</span>
          </div>
        )}
      </div>
    </>
  );
}
