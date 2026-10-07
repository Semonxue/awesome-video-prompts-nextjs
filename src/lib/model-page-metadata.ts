import { getTranslations } from 'next-intl/server';
import { listAllModels, getModelName } from '@/db/queries';
import { SITE_URL, DEFAULT_OG_IMAGE } from '@/lib/site';

/**
 * model 页 metadata 共享构造（2026-10-08 P1-1）
 *
 * /[locale]/models/[model]（page 1）与 /[locale]/models/[model]/p/[page] 共用。
 *
 * 关键变化：分页页**不再**带 robots noindex（旧 models/[model]/page.tsx:45-46 是
 * `page > 1 || tag 筛选 → index:false`）。现在只有 tag 筛选（faceted，与
 * /[locale]/tags/[tag] 重复）继续 noindex + robots 封锁，分页本身是可索引的真实路径。
 */
interface Args {
  locale: string;
  model: string;
  page: number;
  /** tag 筛选命中时保持 noindex（faceted 交叉面） */
  filtered: boolean;
}

export async function buildModelMetadata({ locale, model, page, filtered }: Args) {
  const [t, name, models] = await Promise.all([
    getTranslations({ locale, namespace: 'seo' }),
    getModelName(model),
    listAllModels(),
  ]);
  const count = models.find((m) => m.slug === model)?.count ?? 0;

  const path = (loc: string) =>
    page === 1
      ? `${SITE_URL}/${loc}/models/${model}`
      : `${SITE_URL}/${loc}/models/${model}/p/${page}`;

  const canonical = path(locale);

  return {
    // 不要手写站点名后缀：layout 的 title 模板会再拼一次（曾出现 "x | AVP | AVP"）
    title: t('modelTitle', { name }),
    description: t('modelDescription', { name, count }),
    alternates: {
      canonical,
      languages: {
        en: path('en'),
        zh: path('zh'),
        ja: path('ja'),
        'x-default': path('en'),
      },
    },
    // 只有 tag 筛选是低价值重复面；分页页现在有独立内容，改为可索引
    robots: filtered ? { index: false, follow: true } : undefined,
    openGraph: {
      title: t('modelTitle', { name }),
      description: t('modelDescription', { name, count }),
      url: canonical,
      locale: t('ogLocale'),
      images: [
        { url: DEFAULT_OG_IMAGE, width: 1200, height: 630, alt: t('modelTitle', { name }) },
      ],
      type: 'website',
    },
  };
}
