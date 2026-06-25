/**
 * Footer — 站点底部
 * Server Component，next-intl getTranslations 走 i18n
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

interface Props {
  locale?: string;
}

export async function Footer({ locale = 'en' }: Props) {
  const t = await getTranslations('footer');
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="footer-line" />
      <div className="footer-content">
        <span className="footer-left">
          {t('copyright', { year, siteName: t('siteName') })}
        </span>
        <div className="footer-right">
          <Link href={`/${locale}/tags/`} className="footer-link">{t('tags')}</Link>
          <Link href={`/${locale}/models/`} className="footer-link">{t('models')}</Link>
          <a
            href="https://github.com/Semonxue/awesome-video-prompts"
            className="footer-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('github')}
          </a>
          <Link href={`/${locale}/about/`} className="footer-link">{t('about')}</Link>
        </div>
      </div>
    </footer>
  );
}
