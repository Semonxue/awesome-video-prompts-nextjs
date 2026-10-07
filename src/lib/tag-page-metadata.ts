import { getTranslations } from 'next-intl/server';
import { listAllTags } from '@/db/queries';
import { SITE_URL, DEFAULT_OG_IMAGE } from '@/lib/site';

/**
 * tag 页 metadata 共享构造（2026-10-08 P1-1）
 *
 * /[locale]/tags/[tag]（page 1）与 /[locale]/tags/[tag]/p/[page] 共用，
 * 区别只有 canonical / hreflang / og:url 是否带 /p/N。
 *
 * 关键变化：分页页**不再**带 robots noindex。
 * 之前 tags/[tag]/page.tsx:46 有 `isLowValue = page > 1 → index:false`，
 * 加上 robots.txt 的 `Disallow: /*?page=` 和"页面无分页链接"，三重叠加让
 * page 2+ 既爬不到也收录不了。分页升级成真实路径后，这些内容第一次
 * 具备被索引的资格 —— 这是 sitemap 里 4,743 条孤儿 prompt 的主要出口。
 *
 * 注意 x-default 仍指向 en 的对应页（保持与站内既有 hreflang 约定一致）。
 */
interface Args {
  locale: string;
  tag: string;
  page: number;
}

export async function buildTagMetadata({ locale, tag, page }: Args) {
  const [t, tags] = await Promise.all([
    getTranslations({ locale, namespace: 'seo' }),
    listAllTags(),
  ]);

  const hit = tags.find((x) => x.slug === tag);
  const displayName = hit?.name ?? tag;
  const count = hit?.count ?? 0;

  const path = (loc: string) =>
    page === 1
      ? `${SITE_URL}/${loc}/tags/${tag}`
      : `${SITE_URL}/${loc}/tags/${tag}/p/${page}`;

  const canonical = path(locale);

  return {
    // 不要手写站点名后缀：layout 的 title 模板会再拼一次（曾出现 "x | AVP | AVP"）
    title: t('tagTitle', { name: displayName }),
    description: t('tagDescription', { name: displayName, count }),
    alternates: {
      canonical,
      languages: {
        en: path('en'),
        zh: path('zh'),
        ja: path('ja'),
        'x-default': path('en'),
      },
    },
    openGraph: {
      title: t('tagTitle', { name: displayName }),
      description: t('tagDescription', { name: displayName, count }),
      url: canonical,
      locale: t('ogLocale'),
      images: [
        { url: DEFAULT_OG_IMAGE, width: 1200, height: 630, alt: t('tagTitle', { name: displayName }) },
      ],
      type: 'website',
    },
  };
}
