/**
 * /sitemaps/models.xml — 全部 model 页（3 locale）
 * P2-2：省略 lastModified，理由见 src/lib/sitemap-builders.ts 文件头
 */
import { buildModelsSitemap } from '@/lib/sitemap-builders';

export const dynamic = 'force-dynamic';
export const revalidate = 86400;

export async function GET() {
  const body = await buildModelsSitemap();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body
  .map(
    (u) => `  <url>
    <loc>${u.url}</loc>
    <changefreq>${u.changeFrequency ?? 'weekly'}</changefreq>
    <priority>${u.priority ?? 0.5}</priority>
  </url>`,
  )
  .join('\n')}
</urlset>`;
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Cloudflare-CDN-Cache-Control': 'public, max-age=28800, stale-while-revalidate=86400',
    },
  });
}
