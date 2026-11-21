import Link from 'next/link';

/**
 * locale 内的 404（2026-11-21）
 *
 * 触发点：详情页 slug 不存在、tag/model 不存在、薄分页越界等 notFound()。
 * 渲染在 [locale]/layout 内（有 html/body 与 intl provider）。
 * 刻意保持纯静态：404 页不打任何 D1/R2 查询，只给出回到主干的链接。
 * 链接固定指向 en（zh/ja 已 noindex，en 是 SEO 主语言）。
 */
export default function LocaleNotFound() {
  return (
    <main className="not-found-page">
      <h1>404 — Page not found</h1>
      <p>
        This page doesn&apos;t exist. The prompt may have been removed, or the address is
        misspelled. The library is still here:
      </p>
      <nav aria-label="Back to the library">
        <Link href="/en">Home</Link>
        <Link href="/en/tags">Browse by tag</Link>
        <Link href="/en/models">Browse by model</Link>
      </nav>
    </main>
  );
}