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
 *   - R2 key 与 post_date 去耦（P0-2.1）：优先从 D1 的 cover_url/video_url
 *     反解 key，并扫尾 post_date 推导的旧路径（清理历史孤儿对象）
 *   - prompt_tags / prompt_models 由 D1 CASCADE 自动清理
 */
import { revalidatePath } from 'next/cache';
import { invalidateCache, CACHE_KEYS } from '@/db/cache';
import { rebuildAllAggregateCaches } from '@/db/queries';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getDb } from '@/db';
import { prompts } from '@/db/schema';
import { deriveYearMonth, keyFromMediaUrl, R2_KEY_PREFIX } from '@/lib/r2-keys';

// 显式标记使用 schema 里的 import（防止 lint 报 unused）
void prompts;

/** D1 binding 类型（来自 CloudflareEnv，OpenNext 内部版本） */
type D1 = CloudflareEnv['DB'];
/** R2 binding 类型（来自 CloudflareEnv，OpenPlus 内部版本） */
type R2 = NonNullable<CloudflareEnv['MEDIA']>;

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

  // 4) 查 D1（获取媒体 URL + prompt_date 以便定位 R2 key）
  const d1: D1 = ctx.env.DB;
  if (!d1) return NextResponse.json({ error: 'D1 binding missing' }, { status: 500 });
  const db = getDb(d1);
  const row = await db
    .select({
      id: prompts.id,
      promptDate: prompts.promptDate,
      coverUrl: prompts.coverUrl,
      videoUrl: prompts.videoUrl,
    })
    .from(prompts)
    .where(eq(prompts.slug, slug))
    .get();

  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // R2 key 候选集（P0-2.1 去耦）：优先从 D1 cover_url/video_url 反解，
  // 再带上 post_date 推导的旧路径扫尾（历史孤儿对象也一并清掉）
  const yearMonth = deriveYearMonth(row.promptDate ?? null);
  const coverKeys = new Set<string>([`${R2_KEY_PREFIX}/${yearMonth}/${slug}/cover.jpg`]);
  const videoKeys = new Set<string>([`${R2_KEY_PREFIX}/${yearMonth}/${slug}/video.mp4`]);
  const coverKeyFromUrl = keyFromMediaUrl(row.coverUrl, slug);
  const videoKeyFromUrl = keyFromMediaUrl(row.videoUrl, slug);
  if (coverKeyFromUrl) coverKeys.add(coverKeyFromUrl);
  if (videoKeyFromUrl) videoKeys.add(videoKeyFromUrl);

  // 5) 删除 R2（幂等，失败不中断）
  const r2: R2 = ctx.env.MEDIA;
  let r2CoverDeleted = false;
  let r2VideoDeleted = false;
  if (r2) {
    const coverResults = await Promise.all([...coverKeys].map((k) => deleteR2Key(r2, k)));
    const videoResults = await Promise.all([...videoKeys].map((k) => deleteR2Key(r2, k)));
    r2CoverDeleted = coverResults.every(Boolean);
    r2VideoDeleted = videoResults.every(Boolean);
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
    revalidatePath('/sitemap.xml');
  } catch (err) {
    console.warn('[delete] revalidate error:', err);
  }

  // 重建 R2 聚合缓存（tags/models/model-tag-dist/counts 全量重算覆盖写，保证删除后立即可见）
  await rebuildAllAggregateCaches();

  // 失效内存级缓存（recentPrompts / promptBySlug 仍走 cache.ts）
  await Promise.allSettled([
    invalidateCache(`${CACHE_KEYS.recentPrompts}-48`),
    invalidateCache(`${CACHE_KEYS.promptBySlug}-${slug}`),
  ]);

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
