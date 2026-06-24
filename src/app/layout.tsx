/**
 * Root Layout — 全局 HTML 框架
 * Locale-specific 内容在 src/app/[locale]/layout.tsx 里
 */
import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Awesome Video Prompts',
  description: 'Curated prompts for AI video generation',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}