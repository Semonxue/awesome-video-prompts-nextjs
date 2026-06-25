/**
 * GridEngine — 瀑布流网格（masonry-layout 4.x）
 *
 * 设计：
 *   - 列宽 224px（跟老站 .masonry-grid 一致）
 *   - 客户端 useEffect 后 dynamic import masonry-layout
 *   - 窗口 resize 时重新布局
 *   - 触底加载：IntersectionObserver
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type Masonry from 'masonry-layout';
import { PromptCard } from './PromptCard';
import type { PromptCardData } from './types';

interface Props {
  items: PromptCardData[];
  locale: string;
  total: number;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

const COLUMN_WIDTH = 224;
const GUTTER = 16;

export function GridEngine({ items, locale, hasMore, onLoadMore }: Props) {
  const t = useTranslations('grid');
  const gridRef = useRef<HTMLDivElement>(null);
  const msnryRef = useRef<Masonry | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 初始化 / 重建 Masonry
  useEffect(() => {
    if (!gridRef.current) return;
    let active = true;

    (async () => {
      const MasonryModule = (await import('masonry-layout')).default;
      if (!active || !gridRef.current) return;

      if (msnryRef.current) {
        msnryRef.current.destroy?.();
        msnryRef.current = null;
      }
      const msnry = new MasonryModule(gridRef.current, {
        itemSelector: '.prompt-card',
        columnWidth: COLUMN_WIDTH,
        gutter: GUTTER,
        fitWidth: false,
        percentPosition: false,
      });
      msnryRef.current = msnry;
      msnry.layout?.();

      // 等图片加载完再 layout（masonry 初始 layout 时图片可能没尺寸 → 高度算少）
      const imgs = Array.from(gridRef.current.querySelectorAll('img'));
      await Promise.all(
        imgs.map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((r) => {
                img.addEventListener('load', () => r(), { once: true });
                img.addEventListener('error', () => r(), { once: true });
              }),
        ),
      );
      if (active && msnryRef.current === msnry) {
        msnryRef.current?.layout?.();
      }

      const onResize = () => msnryRef.current?.layout?.();
      window.addEventListener('resize', onResize);
      cleanupRef.current = () => window.removeEventListener('resize', onResize);
    })();

    return () => {
      active = false;
      cleanupRef.current?.();
      cleanupRef.current = null;
      msnryRef.current?.destroy?.();
      msnryRef.current = null;
    };
  }, [items]);

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

  // masonry 算的高度偶尔偏小，强制按 cards 最大 bottom 重设 grid height
  useEffect(() => {
    if (!gridRef.current) return;
    const grid = gridRef.current;
    const sync = () => {
      const maxBottom = Array.from(grid.querySelectorAll('.prompt-card')).reduce(
        (m, c) => Math.max(m, c.getBoundingClientRect().bottom),
        0,
      );
      const gridTop = grid.getBoundingClientRect().top;
      const target = Math.max(200, Math.ceil(maxBottom - gridTop));
      if (grid.style.height !== `${target}px`) {
        grid.style.height = `${target}px`;
      }
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(grid);
    Array.from(grid.querySelectorAll('img')).forEach((img) => {
      if (!img.complete) {
        img.addEventListener('load', sync, { once: true });
        img.addEventListener('error', sync, { once: true });
      }
    });
    return () => ro.disconnect();
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <p>{t('noPrompts')}</p>
      </div>
    );
  }

  return (
    <>
      <div ref={gridRef} className="masonry-grid" data-total={items.length} style={{ minHeight: '200px' }}>
        {items.map((p) => (
          <PromptCard key={p.slug} prompt={p} locale={locale} />
        ))}
      </div>
      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
    </>
  );
}
