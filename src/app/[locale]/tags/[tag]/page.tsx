/**
 * tag 页面 /[locale]/tags/[tag]（第 1 页）
 *
 * 2026-10-08 P1-1 重构：JSX 与 metadata 抽到共享组件/函数，
 * 与新增的 /[locale]/tags/[tag]/p/[page] 真实分页路径共用同一实现。
 *
 * 本文件只负责：参数校验 + metadata + 渲染 <TagPageView page={1} />。
 * 分页控件见 components/TagPagination.tsx。
 *
 * 为什么分页不用 ?page=N：
 *   旧实现下 `?page=N` 同时被 robots.txt Disallow、页面自带 noindex、
 *   且没有任何分页链接指向它 —— 三重死区，page 2+ 的内容永远进不了索引。
 *   现在统一走真实路径 /p/N。`?page=N` 由 src/lib/legacy-url.ts 301 收敛过去，
 *   robots.txt 里对 ?page= 的封锁保持不变（老参数不再产生可抓取面）。
 */
import { notFound } from 'next/navigation';
import { TagPageView } from '@/components/TagPageView';
import { buildTagMetadata } from '@/lib/tag-page-metadata';

export const revalidate = 86400;

interface Props {
  params: Promise<{ locale: string; tag: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { locale, tag } = await params;
  return buildTagMetadata({ locale, tag, page: 1 });
}

export default async function TagPage({ params }: Props) {
  const { locale, tag } = await params;
  if (!['en', 'zh', 'ja'].includes(locale)) notFound();
  return <TagPageView locale={locale} tag={tag} page={1} />;
}
