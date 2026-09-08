/**
 * 旧站 prompt URL 的「带存在性检查」跳转
 *
 * 由 src/middleware.ts 把 /{locale}/prompts/YYYY-MM/<slug> 内部 rewrite 到这里
 * （判定逻辑在 src/lib/legacy-url.ts 的 resolveLegacyAction）。
 *
 * 为什么不能只做字符串改写后直接 301：
 *   迁移时丢掉了一批旧 prompt，改写后的目标 URL 在新站不存在。
 *   GSC（2026-09-08）实测「Not found (404)」5,284 条，全部是这类旧格式 URL，
 *   每次被重爬都是一次 SSR + D1 —— 纯浪费抓取预算，且旧 URL 的外链权重无处可去。
 *
 * 行为：
 *   - 旧 slug 在新站存在 → 301 到 /{locale}/prompts/{slug}（保住外链权重）
 *   - 不存在 → 410 Gone（比 404 更快让 Google 移出索引、停止重爬）
 *
 * 缓存：两种响应都带 s-maxage=86400 —— 410/301 都是 CF 默认可缓存的 status code，
 * 命中后由边缘直接应答，不再打 Worker。slug 一经发布不会变（删除走
 * bumpNamespaceVersion 主动失效），所以 1 天 TTL 是安全的。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getPromptBySlugCached } from '@/db/queries';
import { SITE_URL } from '@/lib/site';

// 必须动态：响应取决于 D1 内容，且要带上自己的 Cache-Control
export const dynamic = 'force-dynamic';

const ALLOWED_LOCALES = new Set(['en', 'zh', 'ja']);
// 边缘 TTL 用 cloudflare-cdn-cache-control：CF 文档明确 s-maxage 会禁用 stale-while-revalidate，
// 用 max-age 才能让 SWR 生效（410/301 都是 Workers Cache 默认可缓存的 status code）。
const EDGE_TTL = 'public, max-age=86400, stale-while-revalidate=604800';
const BROWSER_TTL = 'public, max-age=0, must-revalidate';
const CACHE_HEADERS = {
  'Cache-Control': BROWSER_TTL,
  'Cloudflare-CDN-Cache-Control': EDGE_TTL,
};

export async function GET(req: NextRequest) {
  const locale = req.nextUrl.searchParams.get('locale') ?? 'en';
  const slug = req.nextUrl.searchParams.get('slug') ?? '';

  if (!ALLOWED_LOCALES.has(locale) || !slug) {
    return new NextResponse('Bad Request', {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const prompt = await getPromptBySlugCached(slug);

  if (prompt) {
    return new NextResponse(null, {
      status: 301,
      headers: {
        Location: `${SITE_URL}/${locale}/prompts/${encodeURIComponent(prompt.slug)}`,
        ...CACHE_HEADERS,
      },
    });
  }

  return new NextResponse('Gone', {
    status: 410,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      ...CACHE_HEADERS,
    },
  });
}
