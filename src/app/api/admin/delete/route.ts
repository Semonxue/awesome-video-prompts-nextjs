/**
 * /api/admin/delete — 按 slug 删除线上 prompt（D1 row + R2 媒体）
 *
 * 请求：
 *   POST /api/admin/delete
 *   Authorization: Bearer <ADMIN_SECRET>
 *   Content-Type: application/json
 *   Body: { "slug": "<slug>" }
 *
 * 响应：
 *   200: { ok: true, slug, deleted: { d1: true/false, r2: { cover: true/false, video: true/false } }, revalidated: [...] }
 *   400: { error: "..." }
 *   401: { error: "Unauthorized" }
 *   404: { error: "Not found" }
 *   500: { error: "..." }
 *
 * 注意：
 *   - R2 删除幂等：key 不存在不算错
 *   - prompt_tags / prompt_models 由 D1 CASCADE 自动清理
 */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getDb } from '@/db';
import { prompts } from '@/db/schema';

// 显式标记使用 schema 里的 import（防止 lint 报 unused）
void prompts;

/** D1 binding 类型（来自 CloudflareEnv，OpenNext 内部版本） */
type D1 = CloudflareEnv['DB'];
/** R2 binding 类型（来自 CloudflareEnv，OpenPlus 内部版本） */
type R2 = NonNullable<CloudflareEnv['MEDIA']>;

const R2_KEY_PREFIX = 'prompts';
const R2_PUBLIC = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? '';

type D1Result = { meta?: { changes?: number; last_row_id?: number } };

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

/** 从 prompt_date 提取 YYYY-MM */
function deriveYearMonth(postDate: string | null | undefined, fallback: string): string {
  const src = postDate || fallback;
  const m = String(src).match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 尝试删除 R2 对象（幂等） */
async function deleteR2Key(bucket: R2, key: string): Promise<boolean> {
  try {
    const existing = await bucket.head(key);
    if (!existing) return true; // 不存在就当删除成功
    await bucket.delete(key);
    return true;
  } catch {
    return false;
  }
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

  // 3) 拿 ctx（后面 D1/R2 共用）
  const ctx = await getCloudflareContext({ async: true });

  // 4) 查 D1（获取 prompt_date 以便拼 R2 key）
  const d1: D1 = ctx.env.DB;
  if (!d1) return NextResponse.json({ error: 'D1 binding missing' }, { status: 500 });
  const db = getDb(d1);
  const row = await db
    .select({ id: prompts.id, promptDate: prompts.promptDate })
    .from(prompts)
    .where(eq(prompts.slug, slug))
    .get();

  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const yearMonth = deriveYearMonth(row.promptDate ?? null, '');
  const coverKey = `${R2_KEY_PREFIX}/${yearMonth}/${slug}/cover.jpg`;
  const videoKey = `${R2_KEY_PREFIX}/${yearMonth}/${slug}/video.mp4`;

  // 5) 删除 R2（幂等，失败不中断）
  const r2: R2 = ctx.env.MEDIA;
  let r2CoverDeleted = false;
  let r2VideoDeleted = false;
  if (r2) {
    r2CoverDeleted = await deleteR2Key(r2, coverKey);
    r2VideoDeleted = await deleteR2Key(r2, videoKey);
  }

  // 6) 删除 D1（cascade 自动清理 prompt_tags / prompt_models）
  let d1Deleted = false;
  try {
    const result = await db.delete(prompts).where(eq(prompts.id, row.id)).run() as D1Result;
    d1Deleted = (result.meta?.changes ?? 0) > 0;
  } catch (err) {
    console.error('[delete] D1 delete error:', err);
    return NextResponse.json({ error: `D1 delete failed: ${String(err)}` }, { status: 500 });
  }

  if (!d1Deleted) {
    return NextResponse.json({ error: 'D1 delete reported 0 changes (row already gone?)' }, { status: 500 });
  }

  // 7) revalidate（清理后立即刷新缓存）
  try {
    revalidatePath('/en');
    revalidatePath('/zh');
    revalidatePath('/ja');
    revalidatePath(`/en/prompts/${slug}`);
    revalidatePath(`/zh/prompts/${slug}`);
    revalidatePath(`/ja/prompts/${slug}`);
  } catch (err) {
    console.warn('[delete] revalidate error:', err);
  }

  return NextResponse.json({
    ok: true,
    slug,
    deleted: {
      d1: d1Deleted,
      r2: { cover: r2CoverDeleted, video: r2VideoDeleted },
    },
    revalidated: [
      '/en', '/zh', '/ja',
      `/en/prompts/${slug}`, `/zh/prompts/${slug}`, `/ja/prompts/${slug}`,
    ],
  });
}
