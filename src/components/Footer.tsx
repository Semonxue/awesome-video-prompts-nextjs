/**
 * Footer — 站点底部
 * Server Component
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { type Locale, localeNames } from '@/i18n/request';

interface FooterProps {
  locale: Locale;
}

export default async function Footer({ locale }: FooterProps) {
  const t = await getTranslations();
  const year = new Date().getFullYear();
  const tagsHref = `/${locale}/tags`;
  const modelsHref = `/${locale}/models`;
  const aboutHref = `/${locale}/about`;

  return (
    <footer className="site-footer">
      <div className="footer-line" />
      <div className="footer-content">
        <div className="footer-left">
          <div>{t('site.footer.copyright', { year })}</div>
          <div style={{ marginTop: 4, opacity: 0.7 }}>{t('site.footer.tagline')}</div>
        </div>
        <div className="footer-right">
          <Link href={tagsHref} className="footer-link">{t('nav.tags')}</Link>
          <Link href={modelsHref} className="footer-link">{t('nav.models')}</Link>
          <Link href={aboutHref} className="footer-link">{t('nav.about')}</Link>
          <span className="footer-link" aria-label="locale" style={{ opacity: 0.5 }}>
            {localeNames[locale]}
          </span>
        </div>
      </div>
    </footer>
  );
}