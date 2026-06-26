/**
 * About 页 — 完整三语言内容
 */
import { getTranslations } from 'next-intl/server';
import { locales, type Locale } from '@/i18n/request';
import { notFound } from 'next/navigation';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://awesome-video-prompts.semonxue.workers.dev';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const canonical = `${SITE_URL}/${locale}/about`;
  return {
    title: 'about.title',
    description: 'about.intro',
    alternates: {
      canonical,
      languages: {
        en: `${SITE_URL}/en/about`,
        zh: `${SITE_URL}/zh/about`,
        ja: `${SITE_URL}/ja/about`,
        'x-default': `${SITE_URL}/en/about`,
      },
    },
  };
}

interface AboutPageProps {
  params: Promise<{ locale: string }>;
}

export default async function AboutPage({ params }: AboutPageProps) {
  const { locale: rawLocale } = await params;
  if (!locales.includes(rawLocale as Locale)) notFound();
  const locale = rawLocale as Locale;

  const t = await getTranslations('about');

  return (
    <div className="main-content about-page">
      {/* Hero */}
      <section className="about-hero">
        <h1 className="about-title">{t('title')}</h1>
        <p className="about-intro">{t('intro')}</p>
      </section>

      {/* What We Do */}
      <section className="about-section">
        <h2 className="about-section-title">{t('whatWeDo')}</h2>
        <ul className="about-bullets">
          <li>{t('bullet1')}</li>
          <li>{t('bullet2')}</li>
          <li>{t('bullet3')}</li>
        </ul>
      </section>

      {/* Get Involved */}
      <section className="about-section">
        <h2 className="about-section-title">{t('getInvolved')}</h2>
        <p className="about-text">{t('getInvolvedText')}</p>
        <p className="about-github">
          <span className="about-github-label">{t('githubLabel')}</span>
          <a
            href={t('githubUrl')}
            target="_blank"
            rel="noopener noreferrer"
            className="about-github-link"
          >
            {t('githubUrl')}
          </a>
        </p>
      </section>

      {/* CTA */}
      <section className="about-cta">
        <p className="about-cta-text">{t('cta')}</p>
      </section>
    </div>
  );
}
