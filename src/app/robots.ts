/**
 * robots.txt — 允许主流爬虫，指向 sitemap
 *
 * 查询串屏蔽（2026-08-07 爬取面收敛）：
 *   首页的 ?tag= / ?model= / ?q= / ?page= 变体在 [locale]/page.tsx 里已标 index:false，
 *   但 follow:true，爬虫照样会抓；而这些页面的内容与 /tags/[tag]、/models/[model]
 *   完全重复（后者才是 canonical）。1486 个 tag × 3 语言 = 4458 个零 SEO 价值的 URL，
 *   每次抓取都是一次完整 SSR —— 这是 Worker CPU 超限（Error 1102）的主要来源。
 *
 *   配套改动：全站 6 处 `?tag=`/`?model=` 链接已改为直接指向 canonical 页
 *   （见 lib/format.ts 的 tagHref/modelHref），此处的 Disallow 是双保险，
 *   同时清理爬虫已经积累的旧 URL 队列。
 *
 * 注意：Disallow 只阻止抓取，不移除已收录的 URL。已收录的低质量 URL 靠页面上的
 *       index:false 逐步退出索引 —— 两者并存是有意为之。
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
        disallow: [
          '/*?tag=',
          '/*?model=',
          '/*?q=',
          '/*?page=',
          '/*&tag=',
          '/*&model=',
          '/*&q=',
          '/*&page=',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
