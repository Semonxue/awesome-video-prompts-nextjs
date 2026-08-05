/**
 * Root Layout — 全局 HTML 框架
 * Locale-specific 内容在 src/app/[locale]/layout.tsx 里
 */
import type { ReactNode } from 'react';
import './globals.css';
import { SITE_URL, R2_PUBLIC_URL, DEFAULT_OG_IMAGE } from '@/lib/site';

export const metadata: {
  title: { default: string; template: string };
  description: string;
  metadataBase: string;
  alternates: { languages: Record<string, string> };
  openGraph: { type: string; siteName: string; title: string; description: string; url: string; images: { url: string; width: number; height: number }[] };
  twitter: { card: string; title: string; description: string; images: string[] };
} = {
  title: {
    default: 'Awesome Video Prompts',
    template: '%s | Awesome Video Prompts',
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
    siteName: 'Awesome Video Prompts',
    title: 'Awesome Video Prompts',
    description: 'Curated prompts for AI video generation',
    url: SITE_URL,
    images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Awesome Video Prompts',
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