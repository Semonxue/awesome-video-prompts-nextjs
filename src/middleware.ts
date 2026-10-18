import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { locales, defaultLocale } from '@/i18n/request';
import { resolveLegacyAction } from '@/lib/legacy-url';

/**
 * next-intl 中间件
 *
 * - localePrefix: 'always' → 总是带 locale 前缀 (/zh /ja /en)
 * - URL 不带 locale 时自动 302 到默认 locale (/ → /en)
 * - localeCookie: false → 不写 NEXT_LOCALE cookie（URL 已经有 locale 前缀，写 cookie 会让所有响应 Vary，使 CDN 边缘无法缓存）
 * - localeDetection: false → 不用 cookie/Accept-Language 推断 locale（URL 是唯一来源）
 * - alternateLinks: **false**（2026-10-18）→ 见下方说明
 * - 排除：API、Next.js 静态、favicon、含扩展名的文件
 *
 * ⚠️ alternateLinks 为什么要关：
 *   next-intl 3.26 默认会按 `locales` 给**每个 HTML 响应**追加一个
 *   `Link: <...>; rel="alternate"; hreflang="..."` 响应头，
 *   而且协议是从 `x-forwarded-proto` 现取的（会让 /en 和 /ja 出现 http/https 不一致）。
 *   它与页面 metadata 的 `alternates.languages` 是**两个独立来源** ——
 *   2026-10-18 把 zh/ja 改成 noindex 后，HTML 里已经只剩 en + x-default，
 *   但响应头仍然列出 en/zh/ja，等于给 Google 发两套互相冲突的 hreflang。
 *   关闭后，hreflang 唯一真源 = 各页面的 `alternates.languages`
 *   （统一由 src/lib/seo.ts 的 buildSeoAlternates() 生成）。
 */
const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
  localeCookie: false,
  localeDetection: false,
  alternateLinks: false,
});

/**
 * 边缘缓存策略（2026-06-26 P0 perf 优化，2026-08-18 D1 cost 优化，2026-09-08 Workers Cache）
 *
 * 现象：默认 Next.js 对动态 SSR 页发 `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`
 *       + next-intl 发 set-cookie → 边缘完全无法命中缓存，每次请求都回源 → LCP 8.3s
 *
 * 修法：
 * 1. 关掉 localeCookie（已上）
 * 2. 边缘 TTL 用 `cloudflare-cdn-cache-control`（见 wrappers/cache-control-cloudflare-node.js）：
 *    - 必须先开 Workers Cache（wrangler.toml `[cache] enabled = true`），
 *      因为 zone 级 Cache Rule 对 Worker 生成的响应完全无效
 *    - 用 max-age 而非 s-maxage：CF 文档明确 s-maxage 会禁用 stale-while-revalidate
 *    - 浏览器侧保持 `public, max-age=0, must-revalidate`，避免用户看到陈旧 HTML
 * 3. 兜底删除 set-cookie（带 Set-Cookie 的响应会被 CF 强制 BYPASS）
 *
 * 注意：真正生效的覆盖点是 OpenNext wrapper（Next.js page handler 会覆盖 middleware 的设置），
 *      这里的设置是双保险 + 保持两侧常量一致。
 *
 * 不影响的路径：
 * - /api/*：保持动态（默认行为）
 * - _next/static/* / favicon / 含扩展名文件：被 matcher 排除
 */
const EDGE_CACHE_CONTROL = 'public, max-age=28800, stale-while-revalidate=86400';
const BROWSER_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

function isLocalePage(pathname: string): boolean {
  // 匹配 /en, /en/page/2, /en/prompts/slug, /en/tags/foo 等
  return locales.some((loc) => pathname === `/${loc}` || pathname.startsWith(`/${loc}/`));
}

export default function middleware(req: NextRequest) {
  // 旧 URL → 新 URL（在 intlMiddleware 之前，避免被 302 抢先）
  // 判定规则全部在 src/lib/legacy-url.ts（纯函数，有单测）
  const action = resolveLegacyAction(req.nextUrl.pathname, req.nextUrl.search);

  if (action?.kind === 'redirect') {
    return NextResponse.redirect(new URL(action.to, req.url), 301);
  }

  if (action?.kind === 'legacyPrompt') {
    // 旧 prompt URL 不能靠字符串改写后直接 301：迁移时丢了一批 prompt，
    // 改写出来的目标可能根本不存在（GSC 2026-09-08：5,284 条 "Not found"）。
    // 内部 rewrite 到 /api/legacy-prompt，由它查一次存在性：
    //   存在 → 301 到新 URL；不存在 → 410 Gone（让 Google 停止重爬）
    const url = req.nextUrl.clone();
    url.pathname = '/api/legacy-prompt';
    url.search = `?locale=${encodeURIComponent(action.locale)}&slug=${encodeURIComponent(action.slug)}`;
    return NextResponse.rewrite(url);
  }

  const res = intlMiddleware(req);

  // 只对 GET/HEAD 的 locale HTML 页面设 CDN cache
  if ((req.method === 'GET' || req.method === 'HEAD') && isLocalePage(req.nextUrl.pathname)) {
    // 兜底删除 set-cookie（理论上 localeCookie:false 已不会写；带 Set-Cookie 会被 CF 强制 BYPASS）
    // Headers 对象没有 delete-all，单条删除；next-intl 只可能写一条 NEXT_LOCALE
    res.headers.delete('set-cookie');

    // 覆盖 Next.js 的 no-store：浏览器每次校验 + 边缘 8h/SWR
    res.headers.set('Cache-Control', BROWSER_CACHE_CONTROL);
    res.headers.set('Cloudflare-CDN-Cache-Control', EDGE_CACHE_CONTROL);
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
