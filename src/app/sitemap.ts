/**
 * sitemap.xml — 动态 sitemap（Next.js App Router）
 *
 * 覆盖：
 *   - /{locale}（首页，3 locale）
 *   - /{locale}/about（3 locale）
 *   - /{locale}/tags（3 locale）
 *   - /{locale}/models（3 locale）
 *   - /{locale}/prompts/{slug}（4479×3 locale）
 *   - /{locale}/tags/{tag}（按实际 tag 数量 × 3 locale）
 *   - /{locale}/models/{model}（按实际 model 数量 × 3 locale）
 *
 * lastModified 策略：
 *   - 详情页：prompt.updatedAt（真实更新时间）
 *   - tag/model 页：该分类下 prompts 的 max(updatedAt)
 *   - 静态页：省略 lastModified（避免每次生成都变，误导 Google）
 *
 * ISR 1h：1 小时内同 URL 0 次 D1 调用
 * CF 边缘缓存：middleware 的 s-maxage=3600 对 /sitemap.xml 同样生效
 */
import type { MetadataRoute } from 'next';
import { listAllSlugsForSitemap, listAllTags, listAllModels } from '@/db/queries';
import { locales } from '@/i18n/request';
import { SITE_URL } from '@/lib/site';

// sitemap 每次请求都动态生成（避免 build 时 prerender D1）
export const dynamic = 'force-dynamic';
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [rows, tags, models] = await Promise.all([
    listAllSlugsForSitemap(),
    listAllTags(),
    listAllModels(),
  ]);

  // 首页：3 locale（根 URL 会 302 到 /en，Google 实际收录 /en，所以直接提交 locale 版本）
  const homeRoutes: MetadataRoute.Sitemap = locales.map((locale) => ({
    url: `${SITE_URL}/${locale}`,
    changeFrequency: 'daily' as const,
    priority: locale === 'en' ? 1.0 : 0.9,
  }));

  // 静态页：3 locale（省略 lastModified，避免每次生成都变）
  const staticRoutes: MetadataRoute.Sitemap = locales.flatMap((locale) => [
    {
      url: `${SITE_URL}/${locale}/about`,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/${locale}/tags`,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/${locale}/models`,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    },
  ]);

  // tag 页：每 tag × 3 locale，lastModified = 该 tag 下 prompts 的 max(updatedAt)
  const tagRoutes: MetadataRoute.Sitemap = tags.flatMap((tag) =>
    locales.map((locale) => ({
      url: `${SITE_URL}/${locale}/tags/${tag.slug}`,
      lastModified: tag.updatedAt || undefined,
      changeFrequency: 'weekly' as const,
      priority: locale === 'en' ? 0.7 : 0.6,
    })),
  );

  // model 页：每 model × 3 locale，lastModified = 该 model 下 prompts 的 max(updatedAt)
  const modelRoutes: MetadataRoute.Sitemap = models.flatMap((model) =>
    locales.map((locale) => ({
      url: `${SITE_URL}/${locale}/models/${model.slug}`,
      lastModified: model.updatedAt || undefined,
      changeFrequency: 'weekly' as const,
      priority: locale === 'en' ? 0.7 : 0.6,
    })),
  );

  // 详情页：每 slug × 3 locale，lastModified = prompt.updatedAt
  const detailRoutes: MetadataRoute.Sitemap = rows.flatMap((row) =>
    locales.map((locale) => ({
      url: `${SITE_URL}/${locale}/prompts/${row.slug}`,
      lastModified: row.updatedAt ?? undefined,
      changeFrequency: 'monthly' as const,
      priority: locale === 'en' ? 0.9 : 0.7,
    })),
  );

  return [...homeRoutes, ...staticRoutes, ...tagRoutes, ...modelRoutes, ...detailRoutes];
}
