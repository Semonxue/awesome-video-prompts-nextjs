/**
 * /api/prompt/[slug] — 取单条 prompt 的完整 description（列表页懒加载用）
 *
 * 为什么需要这个接口（2026-10-15 Workers CPU 优化）：
 *   PromptCard 是 'use client' 组件，props 会全量序列化进 RSC flight payload。
 *   卡片 UI 只渲染 truncate(description, 180)，但服务端原本下发完整正文 ——
 *   实测一页 48 条合计 188,871 B（最大单条 17,846 B），是 flight payload 的主要体积。
 *   列表页改为只下发摘要（LIST_DESCRIPTION_LIMIT），用户在点击复制时再按 slug
 *   来这里取全文。这把「每次渲染都要序列化 188 KB」变成「只在用户真的复制时才付」。
 *
 * 数据源：getPromptBySlugCached —— 复用详情页同一份 per-slug L1+L2 缓存，
 *   命中时 0 次 D1 调用；未命中也只有 1 次 round-trip。
 *
 * 缓存头：
 *   - 边缘用 cloudflare-cdn-cache-control（max-age 才启用 SWR，见 middleware 注释）
 *   - description 内容与 slug 一一对应且极少变（内容更新走 publish 主动失效 slug 缓存），
 *     1 天边缘 TTL 安全
 *   - 浏览器 must-revalidate：本接口是写操作的前置读取，保持每次校验
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getPromptBySlugCached } from '@/db/queries';

// 必须动态：内容取决于 D1，且要带自己的 Cache-Control
export const dynamic = 'force-dynamic';

const EDGE_TTL = 'public, max-age=86400, stale-while-revalidate=604800';
const BROWSER_TTL = 'public, max-age=0, must-revalidate';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  // slug 为空 → 400，不去查 D1
  if (!slug || typeof slug !== 'string') {
    return NextResponse.json(
      { error: 'missing slug' },
      { status: 400, headers: { 'Cache-Control': BROWSER_TTL } },
    );
  }

  const prompt = await getPromptBySlugCached(slug);

  // 不存在（含草稿 / 已下架）→ 404。与详情页一致的语义。
  if (!prompt) {
    return NextResponse.json(
      { error: 'not found' },
      { status: 404, headers: { 'Cache-Control': BROWSER_TTL } },
    );
  }

  return NextResponse.json(
    { slug: prompt.slug, description: prompt.description },
    {
      headers: {
        'Cache-Control': BROWSER_TTL,
        'Cloudflare-CDN-Cache-Control': EDGE_TTL,
      },
    },
  );
}
