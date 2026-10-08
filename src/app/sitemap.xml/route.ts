/**
 * /sitemap.xml — sitemap index（2026-10-08 P2-1）
 *
 * 为什么是 route.ts 而不是 page.tsx：
 *   Next.js 的 `MetadataRoute.Sitemap` 只会渲染 `<urlset>`，**没有内建
 *   sitemap index 支持**。用 page.tsx 返回子表列表会生成
 *   `<urlset><url><loc>/sitemaps/prompts-en.xml</loc>...</urlset>`，
 *   Google 会把子表当普通页面 URL 收录 —— 线上实测确实是这样（已修）。
 *   所以这里手写 `<sitemapindex>` XML。
 *
 * 拆分的收益：
 *   原先一个 sitemap.xml 一次构造 21,429 个 URL 对象，代码注释里记着这是
 *   Error 1102（Worker 资源超限）的复发源之一。拆开后每次只构造 1/4~1/3。
 *
 * 子表（由 SITEMAP_CHILDREN 推导，见 lib/sitemap-builders.ts）：
 *   /sitemaps/prompts-en.xml   6,954   详情页（en，保留 lastmod）
 *   /sitemaps/tags.xml           963   tag 页（省略 lastmod，P2-2）
 *   /sitemaps/models.xml          75   model 页（省略 lastmod，P2-2）
 *   /sitemaps/static.xml          12   首页 + about + tags/models 索引
 *
 * 注意：`<sitemapindex>` 里**只能放 `<sitemap>`**，不能放页面 URL，
 * 所以 12 个静态页单独放进了 static.xml 子表。
 *
 * P2-3：只提交 en 的 prompt 详情页，提交量 21,468 → ~8,000（-63%）。
 *   zh/ja 详情页正文与 en 完全一致，同时提交三份等于告诉 Google
 *   「同样的内容给我三份 URL」。zh/ja 页面不会被移除或 noindex，
 *   仍通过 hreflang 互指与全站内链被发现。
 */
import { SITE_URL } from '@/lib/site';
import { SITEMAP_CHILDREN } from '@/lib/sitemap-builders';

export const dynamic = 'force-dynamic';
export const revalidate = 86400;

const XML_HEAD = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

export async function GET() {
  const body = `${XML_HEAD}
${SITEMAP_CHILDREN.map((c) => `  <sitemap>
    <loc>${SITE_URL}${c.path}</loc>
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
  </sitemap>`).join('\n')}
</sitemapindex>`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Cloudflare-CDN-Cache-Control': 'public, max-age=28800, stale-while-revalidate=86400',
    },
  });
}
