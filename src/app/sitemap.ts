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
import { getCachedData, invalidateCache, CACHE_KEYS } from '@/db/cache';
import { locales } from '@/i18n/request';
import { SITE_URL } from '@/lib/site';

// sitemap ISR 缓存：1 天 revalidate（sitemap 数据小时级变化即可，更激进缓存）
// 之前 force-dynamic 导致每次请求都打 D1，加上 13437 个 URL 对象构造时内存压力大，
// 是 Error 1102（Worker 资源超限）的主要复发源（2026-08-07 修复）。
// publish/unpublish/delete 会主动 revalidatePath('/sitemap.xml') 保证时效。
// 必须 force-dynamic：让 Next.js 把 sitemap 视为动态路由，走 OpenNext wrapper 层
// （wrapper 把 cache-control 设为 s-maxage=3600 让 CF 边缘缓存）
// 否则 Next.js 在 build 时静态预渲染，绕过 wrapper，cache-control 永远是 no-store
export const dynamic = 'force-dynamic';
export const revalidate = 86400;

/**
 * 把 DB 里的 updatedAt 转成 W3C Datetime 格式（sitemap lastmod 要求）
 *
 * D1/SQLite 的 updated_at 实际存的是 `YYYY-MM-DD HH:MM:SS`（空格分隔），
 * 不是 W3C 标准格式。GSC 会报 "Invalid date"。
 * 这里统一转成 `YYYY-MM-DDTHH:MM:SSZ`。
 */
function toW3CDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // 已经是 W3C 格式（含 T 或 Z）则原样返回
  if (/[TZ]/.test(trimmed)) return trimmed;
  // `YYYY-MM-DD HH:MM:SS` → `YYYY-MM-DDTHH:MM:SSZ`
  const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  if (m) return `${m[1]}T${m[2]}Z`;
  // `YYYY-MM-DD` → 原样（W3C 允许纯日期）
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return undefined;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // 整个 sitemap 输出加跨实例缓存（2026-08-07 Error 1102 修复）
  // 背景：sitemap 构造 18000+ 个 URL 对象 + 多次 D1 round-trip，CPU 重
  // 缓存 1h：1h 内所有请求从缓存返回，不重新生成，避免 CPU 超限
  // publish/unpublish/delete 会主动 invalidateCache(sitemapOutput) 立即失效
  return getCachedData(CACHE_KEYS.sitemapOutput, async () => {
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
      lastModified: toW3CDate(tag.updatedAt),
      changeFrequency: 'weekly' as const,
      priority: locale === 'en' ? 0.7 : 0.6,
    })),
  );

  // model 页：每 model × 3 locale，lastModified = 该 model 下 prompts 的 max(updatedAt)
  const modelRoutes: MetadataRoute.Sitemap = models.flatMap((model) =>
    locales.map((locale) => ({
      url: `${SITE_URL}/${locale}/models/${model.slug}`,
      lastModified: toW3CDate(model.updatedAt),
      changeFrequency: 'weekly' as const,
      priority: locale === 'en' ? 0.7 : 0.6,
    })),
  );

  // 详情页：每 slug × 3 locale，lastModified = prompt.updatedAt
  const detailRoutes: MetadataRoute.Sitemap = rows.flatMap((row) =>
    locales.map((locale) => ({
      url: `${SITE_URL}/${locale}/prompts/${row.slug}`,
      lastModified: toW3CDate(row.updatedAt),
      changeFrequency: 'monthly' as const,
      priority: locale === 'en' ? 0.9 : 0.7,
    })),
  );

    return [...homeRoutes, ...staticRoutes, ...tagRoutes, ...modelRoutes, ...detailRoutes];
  });
}
