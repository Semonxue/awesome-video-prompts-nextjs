import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { locales, defaultLocale } from '@/i18n/request';

/**
 * next-intl 中间件
 *
 * - localePrefix: 'always' → 总是带 locale 前缀 (/zh /ja /en)
 * - URL 不带 locale 时自动 302 到默认 locale (/ → /en)
 * - localeCookie: false → 不写 NEXT_LOCALE cookie（URL 已经有 locale 前缀，写 cookie 会让所有响应 Vary，使 CDN 边缘无法缓存）
 * - localeDetection: false → 不用 cookie/Accept-Language 推断 locale（URL 是唯一来源）
 * - 排除：API、Next.js 静态、favicon、含扩展名的文件
 */
const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
  localeCookie: false,
  localeDetection: false,
});

/**
 * 边缘缓存策略（2026-06-26 P0 perf 优化）
 *
 * 现象：默认 Next.js 对 SSR 页发 `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`
 *       + next-intl 发 set-cookie → 边缘完全无法命中缓存，每次请求都回源 → LCP 8.3s
 *
 * 修法：
 * 1. 关掉 localeCookie（已上）
 * 2. 对 HTML 页 GET 请求覆盖 cache-control 为 `public, s-maxage=3600, stale-while-revalidate=86400`
 *    - s-maxage=3600：CF 边缘 1h 命中（同 URL 直接返回，0 次 D1 调用）
 *    - stale-while-revalidate=86400：1h 后边缘自动 stale-while-revalidate 异步刷新，不阻塞用户
 * 3. 兜底删除 set-cookie（如果未来某路径又出现）
 *
 * 不影响的路径：
 * - /api/*：保持动态（默认行为）
 * - _next/static/* / favicon / 含扩展名文件：被 matcher 排除
 */
const ONE_HOUR = 3600;
const ONE_DAY = 86400;
const CDN_CACHE_CONTROL = `public, s-maxage=${ONE_HOUR}, stale-while-revalidate=${ONE_DAY}`;

function isLocalePage(pathname: string): boolean {
  // 匹配 /en, /en/page/2, /en/prompts/slug, /en/tags/foo 等
  return locales.some((loc) => pathname === `/${loc}` || pathname.startsWith(`/${loc}/`));
}

export default function middleware(req: NextRequest) {
  const res = intlMiddleware(req);

  // 只对 GET 的 locale HTML 页面设 CDN cache
  if (req.method === 'GET' && isLocalePage(req.nextUrl.pathname)) {
    // 兜底删除 set-cookie（理论上 localeCookie:false 已不会写，但保险起见）
    // Headers 对象没有 delete-all，单条删除；next-intl 只可能写一条 NEXT_LOCALE
    res.headers.delete('set-cookie');

    // 覆盖 Next.js 的 no-store 为 CDN 友好的 cache-control
    res.headers.set('Cache-Control', CDN_CACHE_CONTROL);
  }

  return res;
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
};
