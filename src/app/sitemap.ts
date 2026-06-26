/**
 * sitemap.xml — 动态 sitemap（Next.js App Router）
 *
 * 覆盖：
 *   - /{locale}（首页，3 locale）
 *   - /{locale}/about（3 locale）
 *   - /{locale}/tags（3 locale）
 *   - /{locale}/models（3 locale）
 *   - /{locale}/prompts/{slug}（4479×3 locale）
 *   - /{locale}/tags/{tag}（按实际 tag 数量生成）
 *   - /{locale}/models/{model}（按实际 model 数量生成）
 *
 * ISR 1h：1 小时内同 URL 0 次 D1 调用
 * CF 边缘缓存：middleware 的 s-maxage=3600 对 /sitemap.xml 同样生效
 */
import type { MetadataRoute } from 'next';
import { listAllSlugsForSitemap, listAllTags, listAllModels } from '@/db/queries';
import { locales } from '@/i18n/request';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://awesome-video-prompts-nextjs.semonxue.workers.dev';

// sitemap 每次请求都动态生成（避免 build 时 prerender D1）
export const dynamic = 'force-dynamic';
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [rows, tags, models] = await Promise.all([
    listAllSlugsForSitemap(),
    listAllTags(),
    listAllModels(),
  ]);

  const now = new Date().toISOString();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: 'daily' as const,
      priority: 1.0,
    },
    ...locales.flatMap((locale) => [
      {
        url: `${SITE_URL}/${locale}/about`,
        lastModified: now,
        changeFrequency: 'monthly' as const,
        priority: 0.6,
      },
      {
        url: `${SITE_URL}/${locale}/tags`,
        lastModified: now,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      },
      {
        url: `${SITE_URL}/${locale}/models`,
        lastModified: now,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      },
    ]),
  ];

  const tagRoutes: MetadataRoute.Sitemap = tags.map((tag) => ({
    url: `${SITE_URL}/en/tags/${tag.slug}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  const modelRoutes: MetadataRoute.Sitemap = models.map((model) => ({
    url: `${SITE_URL}/en/models/${model.slug}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  // 详情页：每 slug × 3 locale
  const detailRoutes: MetadataRoute.Sitemap = rows.flatMap((row) =>
    locales.map((locale) => ({
      url: `${SITE_URL}/${locale}/prompts/${row.slug}`,
      lastModified: row.updatedAt ?? now,
      changeFrequency: 'monthly' as const,
      priority: locale === 'en' ? 0.9 : 0.7,
    })),
  );

  return [...staticRoutes, ...tagRoutes, ...modelRoutes, ...detailRoutes];
}
