/**
 * /sitemaps/prompts-zh.xml — zh 语言的全部 prompt 详情页
 * 构建逻辑见 src/lib/sitemap-builders.ts（P2-1 拆分，降低单次调用的 CPU/内存）
 */
import { buildPromptsSitemap } from '@/lib/sitemap-builders';

export const dynamic = 'force-dynamic';
export const revalidate = 86400;

export async function GET() {
  const body = await buildPromptsSitemap('zh');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body
  .map(
    (u) => `  <url>
    <loc>${u.url}</loc>${u.lastModified ? `
    <lastmod>${String(u.lastModified).slice(0, 10)}</lastmod>` : ''}
    <changefreq>${u.changeFrequency ?? 'monthly'}</changefreq>
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
