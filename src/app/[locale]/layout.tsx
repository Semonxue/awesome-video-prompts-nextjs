/**
 * Locale Layout — 接 Header / Footer
 * Phase 1：基础布局 + i18n provider
 */
import { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales, type Locale } from '@/i18n/request';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
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
          <Header locale={locale} />
          <main>
            {children}
          </main>
          <Footer locale={locale} />
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