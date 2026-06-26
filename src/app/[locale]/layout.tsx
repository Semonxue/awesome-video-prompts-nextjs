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
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales, type Locale } from '@/i18n/request';
import MobileFilters from '@/components/MobileFilters';

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale: rawLocale } = await params;
  if (!locales.includes(rawLocale as Locale)) notFound();
  const locale = rawLocale as Locale;

  const messages = await getMessages();

  return (
    <html lang={locale}>
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