/**
 * Footer — 站点底部
 * Server Component，next-intl getTranslations 走 i18n
 * 版本号由 src/lib/version.ts 提供（build 时 prebuild 脚本注入）
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { VERSION_STRING } from '@/lib/version';

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
        {/* 左侧：版权 + 版本号 */}
        <div className="footer-left">
          <span className="footer-copyright">
            {t('copyright', { year, siteName: t('siteName') })}
          </span>
          <span className="footer-version" title={`Build: ${VERSION_STRING}`}>
            {VERSION_STRING}
          </span>
        </div>

        {/* 右侧：导航链接 */}
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
