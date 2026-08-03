/**
 * /api/admin/unpublish — 按 slug 下架线上 prompt（is_draft=1，可恢复）
 *
 * 与 /api/admin/delete 的区别：
 *   - delete    = 物理删除（D1 row + R2 媒体，不可恢复）
 *   - unpublish = 逻辑下架（is_draft=1，D1 row + R2 媒体保留）
 *
 * 下架后效果：
 *   - 详情页 404（getPromptBySlug 过滤 is_draft=0 → notFound()）
 *   - 首页 / tag / model 列表、sitemap 全部消失（查询均过滤 is_draft=0）
 *   - 恢复方式：md-editor 重新发布（publish 始终写 is_draft=0）
 *
 * 请求：
 *   POST /api/admin/unpublish
 *   Authorization: Bearer <ADMIN_SECRET>
 *   Content-Type: application/json
 *   Body: { "slug": "<slug>" }
 *
 * 响应：
 *   200: { ok: true, slug, changed: true|false, revalidated: [...] }
 *        changed=false 表示该 prompt 已是草稿（幂等，不报错）
 *   400: { error: "..." }
 *   401: { error: "Unauthorized" }
 *   404: { error: "Not found" }
 *   500: { error: "..." }
 */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getDb } from '@/db';
import { prompts } from '@/db/schema';

/** D1 binding 类型（来自 CloudflareEnv，OpenNext 内部版本） */
type D1 = CloudflareEnv['DB'];

/** 统一从 ctx.env 读 CF Secret，尝试多种命名变体 */
async function getSecret(...names: string[]): Promise<string> {
  const ctx = await getCloudflareContext({ async: true });
  const env = ctx.env as unknown as Record<string, unknown>;
  for (const name of names) {
    const v = env[name];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'function') {
      const s = String(v());
      if (!s.startsWith('[')) return s;
    }
  }
  return '';
}

/** revalidate 三语言路径 + 首页 + tags/models 索引（与 publish 同一套） */
function revalidatePromptPaths(slug: string): string[] {
  const paths = [
    `/en/prompts/${slug}`,
    `/zh/prompts/${slug}`,
    `/ja/prompts/${slug}`,
  ];
  for (const p of paths) {
    try {
      revalidatePath(p);
    } catch (e) {
      console.warn(`[admin/unpublish] revalidatePath failed for ${p}:`, e);
    }
  }
  // 顺手刷首页 + 标签/模型索引（下架后列表也要消失）
  for (const p of ['/en', '/zh', '/ja', '/en/tags', '/zh/tags', '/ja/tags', '/en/models', '/zh/models', '/ja/models']) {
    try {
      revalidatePath(p);
    } catch {
      // 静默
    }
  }
  return paths;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1) 鉴权
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const adminSecretStr = await getSecret('admin-secret', 'ADMIN_SECRET', 'ADMIN_SECRET_DEV');
  if (!adminSecretStr || bearer !== adminSecretStr) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2) 解析 body
  let body: { slug?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  if (!slug) {
    return NextResponse.json({ error: 'slug is required' }, { status: 400 });
  }

  // 3) 查 D1
  const ctx = await getCloudflareContext({ async: true });
  const d1: D1 = ctx.env.DB;
  if (!d1) return NextResponse.json({ error: 'D1 binding missing' }, { status: 500 });
  const db = getDb(d1);
  const row = await db
    .select({ id: prompts.id, isDraft: prompts.isDraft })
    .from(prompts)
    .where(eq(prompts.slug, slug))
    .get();

  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // 4) 置 is_draft=1（幂等：已是草稿则 changed=false）
  const alreadyDraft = row.isDraft === 1;
  if (!alreadyDraft) {
    try {
      await db
        .update(prompts)
        .set({ isDraft: 1, updatedAt: new Date().toISOString() })
        .where(eq(prompts.id, row.id))
        .run();
    } catch (err) {
      console.error('[admin/unpublish] D1 update error:', err);
      return NextResponse.json({ error: `D1 update failed: ${String(err)}` }, { status: 500 });
    }
  }

  // 5) revalidate（下架后立即刷新缓存）
  const revalidated = revalidatePromptPaths(slug);

  console.log(`[admin/unpublish] slug=${slug} changed=${!alreadyDraft}`);

  return NextResponse.json({
    ok: true,
    slug,
    changed: !alreadyDraft,
    revalidated,
  });
}

// 禁止 GET
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: 'Use POST' }, { status: 405 });
}