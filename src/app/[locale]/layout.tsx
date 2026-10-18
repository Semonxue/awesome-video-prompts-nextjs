/**
 * Locale Layout — 基础布局 + i18n provider
 * Header / Footer 由各 page 自己渲染（page 才知道 activeTag/activeModel/totalCount）
 *
 * 缓存策略（OpenNext on Workers）：
 * - middleware 无法可靠覆盖 cache-control（OpenNext 内部会 strip）
 * - 改用 route segment 的 revalidate = 3600（Next.js 标准 ISR 机制）
 * - Cloudflare Cache Rules 作为补充（边缘缓存）
 */
export const revalidate = 3600;

import { ReactNode } from 'react';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales, type Locale } from '@/i18n/request';
import { seoRobots } from '@/lib/seo';
import MobileFilters from '@/components/MobileFilters';

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

/**
 * 本地化 title 模板（B2，2026-09-08）
 *
 * 根 layout 的模板是英文 `%s | Awesome Video Prompts`，zh/ja 页面会变成
 * 中英/日英混排。这里按 locale 覆盖 default + template（Next.js 的嵌套
 * layout metadata 对本子树生效）。
 * 注意：模板里必须保留 `%s` 占位符，Next.js 用它拼接子页 title。
 *
 * robots（2026-10-18）：只把 en 送去 SEO，zh/ja 一律 `noindex, follow`。
 * 在 layout 上设是"兜底"——所有未显式声明 robots 的子页都会继承。
 * 显式声明了 robots 的页面（首页、model 页）内部也统一调用 seoRobots()，
 * 保证两处口径一致。见 src/lib/seo.ts。
 */
export async function generateMetadata({ params }: LocaleLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) return {};
  const t = await getTranslations({ locale, namespace: 'seo' });
  const brand = await getTranslations({ locale, namespace: 'site' });
  return {
    title: {
      default: brand('title'),
      template: t('titleTemplate'),
    },
    robots: seoRobots(locale),
  };
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale: rawLocale } = await params;
  if (!locales.includes(rawLocale as Locale)) notFound();
  const locale = rawLocale as Locale;

  const messages = await getMessages();

  return (
    <html lang={locale}>
      <head>
        {/* 品牌资源：favicon + manifest */}
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="manifest" href="/site.webmanifest" />
        {/* Matomo 监测（迁移自老站 layouts/_default/baseof.html） */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              var _paq = window._paq = window._paq || [];
              /* tracker methods like "setCustomDimension" should be called before "trackPageView" */
              _paq.push(['trackPageView']);
              _paq.push(['enableLinkTracking']);
              _paq.push(['enableHeartBeatTimer', 5]);
              (function() {
                var u="https://ga.lightcloudapps.com/";
                _paq.push(['setTrackerUrl', u+'matomo.php']);
                _paq.push(['setSiteId', '37']);
                var d=document, g=d.createElement('script'), s=d.getElementsByTagName('script')[0];
                g.async=true; g.src=u+'matomo.js'; s.parentNode.insertBefore(g,s);
              })();
            `,
          }}
        />
      </head>
      <body>
        <NextIntlClientProvider messages={messages} locale={locale}>
          {children}
          {/* Mobile filters 浮动在右下角，Phase 3 接筛选逻辑 */}
          <div
            style={{
              position: 'fixed',
              bottom: 16,
              right: 16,
              zIndex: 50,
              display: 'none',
            }}
            className="mobile-filters-slot"
          >
            <MobileFilters />
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}