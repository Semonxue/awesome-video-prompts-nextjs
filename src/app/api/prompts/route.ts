/**
 * /api/prompts — Infinite scroll 增量拉取 JSON endpoint
 *
 * 输入（query string）：
 *   - page: 1-based 页码（默认 1）
 *   - tag / model / q: 过滤条件（同首页）
 *
 * 输出（JSON）：
 *   {
 *     items: PromptCardData[],  // 当前页 items（不含累积）
 *     total: number,             // 全集总数（不变）
 *     hasMore: boolean,          // 是否还有下一页
 *     nextPage: number | null    // 下一页页码；null = 已到末页
 *   }
 *
 * 缓存：s-maxage=3600, stale-while-revalidate=86400
 *   - 与 SSR 页面同源缓存策略：1h 命中、stale 后台刷新
 *   - 同一 URL 1h 内重复请求 0 次 D1 调用
 *
 * 注意：与 SSR 页面不同，本 endpoint 不需要 set-cookie 抹除（never sets cookie），
 *       浏览器 + CDN 都可以放心缓存。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { listPrompts } from '@/db/queries';

// ISR: 让 API endpoint 也走边缘 ISR 缓存（同 URL 1h 命中）
export const revalidate = 3600;

const PAGE_SIZE = 24;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const tag = sp.get('tag') ?? undefined;
  const model = sp.get('model') ?? undefined;
  const q = sp.get('q') ?? undefined;

  const result = await listPrompts({
    tag: tag || undefined,
    model: model || undefined,
    q: q || undefined,
    limit: PAGE_SIZE,
    offset,
  });

  const hasMore = offset + result.items.length < result.total;

  const res = NextResponse.json({
    items: result.items,
    total: result.total,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
  });

  // CDN 缓存头（与 SSR 页面策略一致：s-maxage + swr）
  res.headers.set(
    'Cache-Control',
    'public, s-maxage=3600, stale-while-revalidate=86400',
  );

  return res;
}
