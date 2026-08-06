/**
 * robots.txt — 允许主流爬虫，指向 sitemap
 */
import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// 必须 force-dynamic：让 robots 走 OpenNext wrapper 层（wrapper 设 s-maxage=3600 让 CF 边缘缓存）
// 否则 build 时静态预渲染，cache-control 是 no-store，每次 Googlebot 抓取都打 worker
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
