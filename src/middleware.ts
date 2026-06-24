import createMiddleware from 'next-intl/middleware';
import { locales, defaultLocale } from '@/i18n/request';

/**
 * next-intl 中间件
 *
 * - localePrefix: 'always' → 总是带 locale 前缀 (/zh /ja /en)
 * - URL 不带 locale 时自动 302 到默认 locale (/ → /en)
 * - 排除：API、Next.js 静态、favicon、含扩展名的文件
 */
export default createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
});

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
};