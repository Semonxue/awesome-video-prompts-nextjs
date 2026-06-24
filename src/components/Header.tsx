/**
 * Header — 站点头部
 * Server Component，结构与老站 baseof.html 对齐
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { locales, type Locale } from '@/i18n/request';
import LangSwitcher from './LangSwitcher';

interface HeaderProps {
  locale: Locale;
}

export default async function Header({ locale }: HeaderProps) {
  const t = await getTranslations();
  const homeHref = `/${locale}`;
  const aboutHref = `/${locale}/about`;
  const tagsHref = `/${locale}/tags`;
  const modelsHref = `/${locale}/models`;

  return (
    <header className="site-header">
      <div className="header-container">
        <Link href={homeHref} className="logo-group">
          <div className="logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </div>
          <span className="site-title-text">{t('site.title')}</span>
        </Link>

        <nav className="header-nav" aria-label="primary">
          <Link href={tagsHref} className="nav-link" aria-label={t('nav.tags')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <circle cx="7" cy="7" r="1.5" fill="currentColor" />
            </svg>
          </Link>
          <Link href={modelsHref} className="nav-link" aria-label={t('nav.models')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </Link>
          <Link href={aboutHref} className="nav-link" aria-label={t('nav.about')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </Link>

          <LangSwitcher currentLocale={locale} locales={locales} />
        </nav>
      </div>
    </header>
  );
}