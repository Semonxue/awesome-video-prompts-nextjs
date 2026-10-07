import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { pageWindow } from '@/lib/pagination';

/**
 * 列表页分页控件（2026-10-08 P1-1）
 *
 * 为什么必须有它：
 *   列表页用 `?page=N` 分页时，**页面上没有任何分页链接**（全站 grep 0 命中），
 *   同时 robots.txt 又 Disallow 了 `?page=`，页面自己还带 noindex ——
 *   三重叠加导致 page 2+ 的内容既爬不到也收录不了。
 *   tag 页 313 个里约 97 个超过一页，model 页同理；sitemap 中 6,804 条 prompt
 *   有 4,743 条（70%）因此没有任何入口链接（GSC "Discovered - not indexed" 19,530 主因）。
 *
 *   现在分页是真实路径 /p/N（可抓取、有独立 canonical），这个组件负责把
 *   prev / next / 页码全部渲染成真实 <a href>，让爬虫有路可走。
 *
 * 成本护栏：
 *   - 页码用 pageWindow 折叠，头部（tag max 4,511 条）也不会生成上百个链接撑大 HTML
 *   - 深度上限由调用方（TAG_PAGE_MAX_DEPTH / MODEL_PAGE_MAX_DEPTH）约束，
 *     本组件不生成超出范围的链接
 *
 * 通用化：2026-10-08 先做 tag 页时叫 TagPagination，models 页复用时改成按
 * basePath 拼 URL 的通用组件，避免复制一份。
 */
interface Props {
  /** 第 1 页的路径前缀，如 /en/tags/cinematic 或 /en/models/seedance25 */
  basePath: string;
  current: number;
  last: number;
  /** 无障碍标签的语义化名字 */
  label: string;
}

export async function Pagination({ basePath, current, last, label }: Props) {
  if (last <= 1) return null;

  const t = await getTranslations('pagination');
  const href = (p: number) => (p === 1 ? basePath : `${basePath}/p/${p}`);

  return (
    <nav className="tag-pagination" aria-label={label}>
      {current > 1 ? (
        <Link className="tag-pagination__step" href={href(current - 1)} rel="prev">
          ← {t('prev')}
        </Link>
      ) : (
        <span className="tag-pagination__step is-disabled" aria-disabled="true">
          ← {t('prev')}
        </span>
      )}

      <span className="tag-pagination__pages">
        {pageWindow(current, last).map((p, i) =>
          p === 'gap' ? (
            // eslint-disable-next-line react/no-array-index-key
            <span key={`gap-${i}`} className="tag-pagination__gap" aria-hidden="true">
              …
            </span>
          ) : p === current ? (
            <span key={p} className="tag-pagination__page is-current" aria-current="page">
              {p}
            </span>
          ) : (
            <Link key={p} className="tag-pagination__page" href={href(p)}>
              {p}
            </Link>
          ),
        )}
      </span>

      {current < last ? (
        <Link className="tag-pagination__step" href={href(current + 1)} rel="next">
          {t('next')} →
        </Link>
      ) : (
        <span className="tag-pagination__step is-disabled" aria-disabled="true">
          {t('next')} →
        </span>
      )}
    </nav>
  );
}
