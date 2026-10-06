/**
 * Root Layout — 全局 HTML 框架
 * Locale-specific 内容在 src/app/[locale]/layout.tsx 里
 */
import type { ReactNode } from 'react';
import './globals.css';
import { SITE_URL, SITE_BRAND, R2_PUBLIC_URL, DEFAULT_OG_IMAGE } from '@/lib/site';

export const metadata: {
  title: { default: string; template: string };
  description: string;
  metadataBase: string;
  alternates: { languages: Record<string, string> };
  openGraph: { type: string; siteName: string; title: string; description: string; url: string; images: { url: string; width: number; height: number; alt: string }[] };
  twitter: { card: string; title: string; description: string; images: string[] };
} = {
  title: {
    default: SITE_BRAND,
    template: `%s | ${SITE_BRAND}`,
  },
  description: 'Curated prompts for AI video generation',
  metadataBase: SITE_URL,
  alternates: {
    languages: {
      en: '/en',
      zh: '/zh',
      ja: '/ja',
      'x-default': '/en',
    },
  },
  openGraph: {
    type: 'website',
    siteName: SITE_BRAND,
    title: SITE_BRAND,
    description: 'Curated prompts for AI video generation',
    url: SITE_URL,
    // og-default.png 实测就是 1200×630（1.9048:1），尺寸声明准确
    images: [
      { url: DEFAULT_OG_IMAGE, width: 1200, height: 630, alt: `${SITE_BRAND} — AI Video Prompt Library` },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_BRAND,
    description: 'Curated prompts for AI video generation',
    images: [DEFAULT_OG_IMAGE],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* DNS 预解析：R2 图片域在所有页面都可能出现 */}
      <link rel="preconnect" href={R2_PUBLIC_URL} crossOrigin="anonymous" />
      <link rel="dns-prefetch" href={R2_PUBLIC_URL} />
      {children}
    </>
  );
}