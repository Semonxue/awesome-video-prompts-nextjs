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
 * 边缘缓存策略（2026-06-26 P0 perf 优化，2026-08-18 D1 cost 优化）
 *
 * 现象：默认 Next.js 对 SSR 页发 `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`
 *       + next-intl 发 set-cookie → 边缘完全无法命中缓存，每次请求都回源 → LCP 8.3s
 *
 * 修法：
 * 1. 关掉 localeCookie（已上）
 * 2. 对 HTML 页 GET 请求覆盖 cache-control 为 `public, s-maxage=28800, stale-while-revalidate=86400`
 *    - s-maxage=28800：CF 边缘 8h 命中（同 URL 直接返回，0 次 D1 调用）
 *      [2026-08-18 改动：从 3600 提到 28800。1h 后 SWR 触发的 worker ISR refresh 是 Q1 (getRelatedPrompts) 50K/h calls 的主因。提到 8h 预计 Q1 降至 ~6K/h (8x 降)]
 *    - stale-while-revalidate=86400：8h 后边缘自动 stale-while-revalidate 异步刷新，不阻塞用户
 *    - publish/unpublish 不会卡 8h：namespace version stamp 让 cache key 跟 version 走，admin 操作立即穿透
 * 3. 兜底删除 set-cookie（如果未来某路径又出现）
 *
 * 不影响的路径：
 * - /api/*：保持动态（默认行为）
 * - _next/static/* / favicon / 含扩展名文件：被 matcher 排除
 */
const EIGHT_HOURS = 28800;
const ONE_DAY = 86400;
const CDN_CACHE_CONTROL = `public, s-maxage=${EIGHT_HOURS}, stale-while-revalidate=${ONE_DAY}`;

function isLocalePage(pathname: string): boolean {
  // 匹配 /en, /en/page/2, /en/prompts/slug, /en/tags/foo 等
  return locales.some((loc) => pathname === `/${loc}` || pathname.startsWith(`/${loc}/`));
}

/**
 * 旧版网站 URL → 新版 URL 301 重定向（2026-08-05 GSC 收录修复）
 *
 * 背景：旧站 URL 格式与新站不同，GSC 里大量 "Crawled - currently not indexed" 的 URL
 *       都是旧格式，在新站上 404。加 301 让 Google 把旧 URL 权重转移给新 URL，
 *       并自动从索引中替换旧 URL。
 *
 * 旧格式 → 新格式：
 *   - /prompts/2026-05/2051883545807999024-wwe-championship-finale/  → /en/prompts/wwe-championship-finale
 *   - /tags/smile/                                                   → /en/tags/smile
 *   - /models/hedra/                                                 → /en/models/hedra
 *   - /prompts/page/150/                                             → /en?page=150
 *   - /zh-cn/...                                                     → /zh/...
 *   - 所有旧 URL 统一去尾部斜杠
 *
 * 规则：
 *   1. 去尾部斜杠（根路径除外）
 *   2. 旧 locale 前缀映射（zh-cn → zh）
 *   3. 无 locale 前缀 → 加 /en
 *   4. prompt 旧格式 /prompts/YYYY-MM/<slug> → /prompts/<slug>（去掉日期前缀 + Twitter ID 前缀）
 *   5. 旧分页 /prompts/page/N → /?page=N
 *   6. 其他路径若因去斜杠/加 locale 变化 → 重定向
 */
const LEGACY_LOCALE_MAP: Record<string, string> = {
  '/zh-cn': '/zh',
  '/zh-CN': '/zh',
  '/zh-tw': '/zh',
};

function legacyRedirect(pathname: string, search: string): string | null {
  // 根路径交给 intlMiddleware（302 → /en），不在这里处理
  if (pathname === '/') return null;

  // 1. 去尾部斜杠（根路径除外）
  let path = pathname;
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  // 2. 旧 locale 前缀映射：/zh-cn/... → /zh/...
  for (const [oldPrefix, newPrefix] of Object.entries(LEGACY_LOCALE_MAP)) {
    if (path === oldPrefix || path.startsWith(`${oldPrefix}/`)) {
      path = newPrefix + path.slice(oldPrefix.length);
      break;
    }
  }

  // 3. 无 locale 前缀 → 加 /en
  const hasLocale = locales.some((l) => path === `/${l}` || path.startsWith(`/${l}/`));
  if (!hasLocale) {
    path = `/en${path}`;
  }

  // 4. 旧 prompt 格式：/en/prompts/YYYY-MM/<slug> → /en/prompts/<slug>
  //    注意：新站 slug 就是 <twitter-id>-<slug>，与旧 URL 日期前缀后的部分完全一致，
  //    所以直接保留完整 slug（不去掉 ID 前缀），只去掉日期前缀 YYYY-MM/ 并加 locale。
  const promptMatch = path.match(/^\/(en|zh|ja)\/prompts\/(\d{4}-\d{2})\/(.+)$/);
  if (promptMatch) {
    const [, l, , rawSlug] = promptMatch;
    return `/${l}/prompts/${rawSlug}`;
  }

  // 5. 旧分页：/en/prompts/page/N → /en?page=N
  const pageMatch = path.match(/^\/(en|zh|ja)\/prompts\/page\/(\d+)$/);
  if (pageMatch) {
    const [, l, pageNum] = pageMatch;
    return `/${l}?page=${pageNum}`;
  }

  // 6. 其他路径：若因去斜杠/加 locale 变化 → 重定向
  if (path !== pathname) {
    return path + search;
  }

  return null;
}

export default function middleware(req: NextRequest) {
  // 旧 URL → 新 URL 301（在 intlMiddleware 之前，避免被 302 抢先）
  const legacy = legacyRedirect(req.nextUrl.pathname, req.nextUrl.search);
  if (legacy) {
    return NextResponse.redirect(new URL(legacy, req.url), 301);
  }

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
    // 排除 API、Next.js 静态、favicon、以及真正的静态资源扩展名
    // 注意：不能排除所有含 "." 的路径（如 /models/seedance1.5pro/ 旧 URL 含点号）
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|txt|xml|json|woff2?|ttf|eot|map)$).*)',
  ],
};
