/**
 * model 分页真实路径 /[locale]/models/[model]/p/[page]（2026-10-08 P1-1 / P1-2）
 *
 * 与 tag 侧 /[locale]/tags/[tag]/p/[page] 同构，原因相同：
 *   旧 `?page=N` 被 robots.txt Disallow + 页面自带 noindex + 页面上无分页链接
 *   三重杀死，page 2+ 的内容既爬不到也收录不了。
 *
 * 成本护栏 G1：深度上限 MODEL_PAGE_MAX_DEPTH = 3，超出一律 notFound()，
 * 不产生额外可抓取面。legacy-url.ts 把旧 ?page=N 收敛时夹到同一上限。
 *
 * 刻意不做：tag 筛选态的分页（faceted），保持 robots 封锁 + noindex。
 *
 * 刻意不做：把 /p/N 加进 sitemap —— 靠分页控件的内链发现即可，
 * 加进 sitemap 与 P2-3「收敛提交面」的取向相反。
 */
import { notFound } from 'next/navigation';
import { ModelPageView } from '@/components/ModelPageView';
import { buildModelMetadata } from '@/lib/model-page-metadata';
import { MODEL_PAGE_MAX_DEPTH } from '@/lib/pagination';

export const revalidate = 86400;

interface Props {
  params: Promise<{ locale: string; model: string; page: string }>;
}

function parsePage(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = parseInt(raw, 10);
  if (n < 2 || n > MODEL_PAGE_MAX_DEPTH) return null; // /p/1 走 /[locale]/models/[model]
  return n;
}

export async function generateMetadata({ params }: Props) {
  const { locale, model, page: raw } = await params;
  const page = parsePage(raw);
  if (page === null) return {};
  return buildModelMetadata({ locale, model, page, filtered: false });
}

export default async function ModelPagedPage({ params }: Props) {
  const { locale, model, page: raw } = await params;
  if (!['en', 'zh', 'ja'].includes(locale)) notFound();

  const page = parsePage(raw);
  if (page === null) notFound();

  return <ModelPageView locale={locale} model={model} page={page} />;
}
