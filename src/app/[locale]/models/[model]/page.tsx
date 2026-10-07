/**
 * model 页面 /[locale]/models/[model]（第 1 页）
 *
 * 2026-10-08 P1-1 重构：JSX 与 metadata 抽到共享组件/函数，
 * 与新增的 /[locale]/models/[model]/p/[page] 真实分页路径共用同一实现。
 *
 * 分页不用 ?page=N 的原因与 tag 页完全一样：
 *   旧实现下 `?page=N` 同时被 robots.txt Disallow、页面自带 noindex、
 *   且没有任何分页链接指向它 —— 三重死区。现在统一走真实路径 /p/N。
 *
 * `?tag=X` 分面筛选保持原状（robots 封锁 + noindex），刻意不并入 /p/N 体系：
 *   model × tag 与 /[locale]/tags/[tag] 内容重复，合并会让提交量按乘法膨胀。
 */
import { notFound } from 'next/navigation';
import { ModelPageView } from '@/components/ModelPageView';
import { buildModelMetadata } from '@/lib/model-page-metadata';

export const revalidate = 86400;

interface Props {
  params: Promise<{ locale: string; model: string }>;
  searchParams: Promise<{ tag?: string; page?: string }>;
}

export async function generateMetadata({ params, searchParams }: Props) {
  const { locale, model } = await params;
  const sp = await searchParams;
  return buildModelMetadata({ locale, model, page: 1, filtered: Boolean(sp.tag) });
}

export default async function ModelPage({ params, searchParams }: Props) {
  const { locale, model } = await params;
  const sp = await searchParams;
  if (!['en', 'zh', 'ja'].includes(locale)) notFound();

  return <ModelPageView locale={locale} model={model} page={1} tag={sp.tag} />;
}
