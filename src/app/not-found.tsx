import Link from 'next/link';

/**
 * 根级 404（2026-11-21）
 *
 * 触发点：locale 本身非法（[locale]/layout 里的 notFound()）等越过 locale 边界的情况。
 * 根 layout 不含 html/body（它们在 [locale]/layout 里），所以这里必须自带，
 * 否则 404 响应是没有 <html> 的碎片文档。样式走 globals.css → main.css。
 */
export default function RootNotFound() {
  return (
    <html lang="en">
      <body>
        <main className="not-found-page">
          <h1>404 — Page not found</h1>
          <p>This page doesn&apos;t exist. Head back to the prompt library:</p>
          <nav aria-label="Back to the library">
            <Link href="/en">Home</Link>
            <Link href="/en/tags">Browse by tag</Link>
            <Link href="/en/models">Browse by model</Link>
          </nav>
        </main>
      </body>
    </html>
  );
}