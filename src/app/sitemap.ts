/**
 * /sitemap.xml — sitemap index（2026-10-08 P2-1 从单文件拆成 index + 4 子表）
 *
 * 拆的原因：原先这里一次构造 21,429 个 URL 对象，代码注释记着这是
 * Error 1102（Worker 资源超限）的复发源之一。拆开后每次只构造 1/3 ~ 1/5。
 *
 * 子表（由 SITEMAP_PROMPT_LOCALES 推导，当前只含 en —— 理由见该常量注释）：
 *   /sitemaps/prompts-en.xml   6,886
 *   /sitemaps/tags.xml           939
 *   /sitemaps/models.xml          75
 *
 * P2-2：首页与静态页省略 lastModified —— 每次生成都变会误导 Google。
 * P2-3：只提交 en 的 prompt 详情页，提交量 21,468 → ~7,900（-63%）。
 *       zh/ja 详情页仍在 hreflang 组与内链里，不会被移除或 noindex。
 */
import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';
import { buildIndexSitemap, SITEMAP_CHILDREN } from '@/lib/sitemap-builders';

export const dynamic = 'force-dynamic';
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes = await buildIndexSitemap();
  const children: MetadataRoute.Sitemap = SITEMAP_CHILDREN.map((c) => ({
    url: `${SITE_URL}${c.path}`,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }));
  return [...staticRoutes, ...children];
}
