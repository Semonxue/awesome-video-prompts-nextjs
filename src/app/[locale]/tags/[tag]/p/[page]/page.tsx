/**
 * tag 分页真实路径 /[locale]/tags/[tag]/p/[page]（2026-10-08 P1-1 / P1-2）
 *
 * 为什么要有这条路由：
 *   旧架构下 tag 分页用 `?page=N`，而它同时被三件事杀死 ——
 *     1) robots.txt `Disallow: /*?page=`（2026-08-07 为防 Error 1102 加的）
 *     2) 页面自带 `robots: { index: false }`（tags/[tag]/page.tsx 旧第 46 行）
 *     3) 页面上没有任何分页链接，全站 grep `?page=` 0 命中
 *   结果：313 个 tag 里约 97 个超过一页，page 2+ 的内容既爬不到也收录不了。
 *   抓完 313 个 tag 第 1 页实测：6,804 条 prompt 只有 2,061 条有入口链接，
 *   **4,743 条（70%）是孤儿** —— 对应 GSC "Discovered - currently not indexed" 19,530。
 *
 *   本路由把分页变成有独立 canonical 的真实路径，页码由 TagPagination 渲染成
 *   可跟随的 <a href>，让爬虫第一次能走进第 2 页。
 *
 * 成本护栏 G1：
 *   页码上限 TAG_PAGE_MAX_DEPTH = 3（48 × 3 = 每 tag 最多 144 条）。
 *   全量展开会是 6,850 个新 URL，在 0.22% 收录率下会把抓取预算全稀释掉。
 *   超出上限的请求一律 notFound()，不生成额外可抓取面。
 *   legacy-url.ts 把旧 `?page=N` 收敛时也夹到同一个上限，两边不会打架。
 *
 * 刻意不做的事：
 *   - 不把 /p/N 加进 sitemap。靠内链发现即可，加进 sitemap 只会扩大提交量，
 *     与 P2-3「收敛提交面」的取向相反。
 *   - 不改 robots.txt 对 ?page= 的封锁。老参数继续不可抓，避免双份 URL。
 */
import { notFound } from 'next/navigation';
import { TagPageView } from '@/components/TagPageView';
import { buildTagMetadata } from '@/lib/tag-page-metadata';
import { TAG_PAGE_MAX_DEPTH } from '@/lib/pagination';

export const revalidate = 86400;

interface Props {
  params: Promise<{ locale: string; tag: string; page: string }>;
}

function parsePage(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = parseInt(raw, 10);
  if (n < 2 || n > TAG_PAGE_MAX_DEPTH) return null; // /p/1 走 /[locale]/tags/[tag]
  return n;
}

export async function generateMetadata({ params }: Props) {
  const { locale, tag, page: raw } = await params;
  const page = parsePage(raw);
  if (page === null) return {};
  return buildTagMetadata({ locale, tag, page });
}

export default async function TagPagedPage({ params }: Props) {
  const { locale, tag, page: raw } = await params;
  if (!['en', 'zh', 'ja'].includes(locale)) notFound();

  const page = parsePage(raw);
  if (page === null) notFound();

  return <TagPageView locale={locale} tag={tag} page={page} />;
}
