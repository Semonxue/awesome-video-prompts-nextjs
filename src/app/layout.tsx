/**
 * Root Layout — 全局 HTML 框架
 * Locale-specific 内容在 src/app/[locale]/layout.tsx 里
 */
import type { ReactNode } from 'react';
import './globals.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://awesome-video-prompts-nextjs.semonxue.workers.dev';

export const metadata: { title: { default: string; template: string }; description: string; metadataBase: string; alternates: { languages: Record<string, string> } } = {
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
};

/** R2 公网域（用于 preconnect / dns-prefetch） */
const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? 'https://static.awesomevideoprompts.com';

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