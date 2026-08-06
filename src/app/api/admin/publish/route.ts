/**
 * /api/admin/publish — md-editor 发布端点
 *
 * 用途：md-editor 收到用户"📤 发布"操作后，HTTP multipart 上传
 *       front matter + cover + video → 本端点原子化写入 D1 + R2 + revalidate
 *
 * 行为决策（详见 EXECUTION.md）：
 * - 每次都覆盖 R2 对象（PUT 同 key，覆盖语义，幂等）
 * - R2 key 与 post_date 去耦（P0-2.1）：slug 已存在且 D1 已有媒体 URL 时，
 *   从 URL 反解 key 覆盖同一路径——编辑 post_date 重传媒体不会产生孤儿对象
 * - D1 部分字段更新（PATCH 语义）：不提供的字段不擦除
 *   例：只上传 front matter 不带 cover → 不重新上传 R2 媒体，D1 媒体 URL 保持原值
 *       只上传 cover 不带 description → 不动 description
 * - 发布后立即 revalidate（用户期望立即看到）
 * - is_draft 始终写 0（这里的"草稿"指本地 MD 文件，不在 D1 里）
 * - 发布前自动备份（3.4）：update 前把旧 row + tags/models 关联 dump 到
 *   R2 `backups/<slug>/<timestamp>.json`（best-effort，失败不阻断发布，响应里带 backup 字段）
 *   注意：备份只含 D1 数据，不含 R2 媒体字节（媒体覆盖式 PUT 同 key，无历史）
 *
 * 请求：
 *   POST /api/admin/publish
 *   Authorization: Bearer <ADMIN_SECRET>
 *   Content-Type: multipart/form-data
 *   Fields:
 *     - slug (string, required)
 *     - frontmatter (string, JSON of fields to upsert)
 *     - cover (file, optional)
 *     - video (file, optional)
 *
 * 响应：
 *   200: { ok: true, slug, operation: "create"|"update", revalidated: [...] }
 *   400: { error: "..." } — 参数错误
 *   401: { error: "Unauthorized" } — secret 不匹配
 *   500: { error: "..." } — 内部错误
 *
 * 安全：
 *   - 必须 ADMIN_SECRET 匹配（env 注入，dev .dev.vars / prod wrangler secret）
 *   - OpenNext on Workers：env.ADMIN_SECRET 来自 [env] or secrets
 */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getDb } from '@/db';
import { prompts, tags, models, promptTags, promptModels } from '@/db/schema';
import { deriveYearMonth, keyFromMediaUrl, R2_KEY_PREFIX } from '@/lib/r2-keys';
import { invalidateCache, CACHE_KEYS } from '@/db/cache';

// 显式标记使用 schema 里的 import（防止 lint 报 unused）
void prompts; void tags; void models; void promptTags; void promptModels;

// 使用 Cloudflare workers-types 里的 R2Object（避免与项目自带的同名全局冲突）
import type { R2Object as CFR2Object } from '@cloudflare/workers-types';
type R2Obj = CFR2Object;

/** D1 binding 类型（来自 CloudflareEnv，OpenNext 内部版本） */
type D1 = CloudflareEnv['DB'];
/** R2 binding 类型（来自 CloudflareEnv，OpenNext 内部版本） */
type R2 = NonNullable<CloudflareEnv['MEDIA']>;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB 单文件上限（视频够用）

/** 统一从 ctx.env 读 CF Secret，尝试多种命名变体（Dashboard 可能用 kebab-case 或 SNAKE_CASE） */
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

interface FrontmatterPayload {
  title?: string;
  description?: string;
  author?: string;
  source_url?: string;
  post_date?: string; // ISO 8601 YYYY-MM-DD or YYYY-MM-01
  tags?: string[];
  models?: string[]; // 数组形式（已和老流程对齐）
}

interface PublishResult {
  ok: true;
  slug: string;
  operation: 'create' | 'update';
  uploaded: { cover: boolean; video: boolean };
  revalidated: string[];
  promptId: number;
  /** 3.4 发布前备份结果（仅 update 时存在） */
  backup?: { ok: boolean; key?: string; error?: string };
}

interface PublishError {
  error: string;
  detail?: string;
}

function unauthorized(): NextResponse<PublishError> {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function badRequest(error: string, detail?: string): NextResponse<PublishError> {
  return NextResponse.json({ error, detail }, { status: 400 });
}

function serverError(error: string, detail?: string): NextResponse<PublishError> {
  return NextResponse.json({ error, detail }, { status: 500 });
}

/** 验证 slug 格式：TWEET_ID-kebab-slug（kebab 只允许小写字母/数字/连字符） */
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]{1,200}$/i.test(slug) && !slug.includes('..') && !slug.startsWith('-');
}

/** 从 multipart frontmatter JSON 安全 parse */
function parseFrontmatterField(raw: string | null): FrontmatterPayload {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('frontmatter must be a JSON object');
    }
    return parsed as FrontmatterPayload;
  } catch (e) {
    throw new Error(`Invalid frontmatter JSON: ${(e as Error).message}`);
  }
}

/** 上传单个文件到 R2（覆盖语义，幂等）。
 * 严格校验：put 必须返回非 null R2Object + size 匹配 + head 二次确认写入。
 * 任何一步不通过都返回 false —— 避免 silent-fail 让 D1 留下孤儿 cover_url。
 */
async function uploadToR2(
  bucket: R2,
  key: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<{ ok: boolean; error?: string }> {
  const expectedSize = body.byteLength;
  let result: R2Obj | null = null;
  try {
    result = await bucket.put(key, body, {
      httpMetadata: { contentType },
    });
  } catch (e) {
    return { ok: false, error: `put threw: ${(e as Error).message}` };
  }
  if (!result) {
    return { ok: false, error: 'put returned null (silent fail — likely binding/bucket mismatch)' };
  }
  if (result.size !== expectedSize) {
    return { ok: false, error: `size mismatch: put reported ${result.size}, expected ${expectedSize}` };
  }
  // 二次校验：head 取回
  let head: R2Obj | null = null;
  try {
    head = await bucket.head(key);
  } catch (e) {
    return { ok: false, error: `head threw: ${(e as Error).message}` };
  }
  if (!head) {
    return { ok: false, error: 'head returned null (object not visible after put)' };
  }
  if (head.size !== expectedSize) {
    return { ok: false, error: `head size mismatch: ${head.size} vs ${expectedSize}` };
  }
  return { ok: true };
}

/**
 * 3.4 发布前备份：update 前把旧 row + tags/models 关联 dump 到 R2
 * `backups/<slug>/<timestamp>.json`（best-effort，失败不阻断发布）
 */
async function backupBeforeUpdate(
  r2: R2,
  d1: D1,
  slug: string,
  promptId: number,
  now: string,
): Promise<{ ok: boolean; key?: string; error?: string }> {
  try {
    const row = await d1
      .prepare('SELECT * FROM prompts WHERE id = ?')
      .bind(promptId)
      .first<Record<string, unknown>>();
    if (!row) return { ok: false, error: 'row not found' };

    const tagRows = await d1
      .prepare('SELECT t.name FROM prompt_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.prompt_id = ?')
      .bind(promptId)
      .all<{ name: string }>();
    const modelRows = await d1
      .prepare('SELECT m.slug FROM prompt_models pm JOIN models m ON m.id = pm.model_id WHERE pm.prompt_id = ?')
      .bind(promptId)
      .all<{ slug: string }>();

    const payload = {
      backed_up_at: now,
      reason: 'pre-publish-update',
      prompt: row,
      tags: (tagRows.results ?? []).map((r) => r.name),
      models: (modelRows.results ?? []).map((r) => r.slug),
    };
    // ISO 时间戳的 : 和 . 对 key 不友好，替换为 -
    const ts = now.replace(/[:.]/g, '-');
    const key = `backups/${slug}/${ts}.json`;
    await r2.put(key, JSON.stringify(payload, null, 2), {
      httpMetadata: { contentType: 'application/json' },
    });
    return { ok: true, key };
  } catch (e) {
    console.warn(`[admin/publish] backup failed for ${slug}:`, e);
    return { ok: false, error: (e as Error).message };
  }
}

/** 获取 D1 binding */
async function getD1(): Promise<D1> {
  const ctx = await getCloudflareContext({ async: true });
  const db = ctx.env.DB;
  if (!db) throw new Error('D1 binding (env.DB) not found in Cloudflare context');
  return db;
}

/** 获取 R2 binding */
async function getR2(): Promise<R2> {
  const ctx = await getCloudflareContext({ async: true });
  const r2 = ctx.env.MEDIA;
  if (!r2) throw new Error('R2 binding (env.MEDIA) not found in Cloudflare context');
  return r2;
}

/** revalidate 三语言对应路径 */
function revalidatePromptPaths(slug: string): string[] {
  const paths = [
    `/${'en'}/prompts/${slug}`,
    `/${'zh'}/prompts/${slug}`,
    `/${'ja'}/prompts/${slug}`,
  ];
  for (const p of paths) {
    try {
      revalidatePath(p);
    } catch (e) {
      console.warn(`[admin/publish] revalidatePath failed for ${p}:`, e);
    }
  }
  // 顺手刷首页 + 标签/模型索引
  for (const p of ['/en', '/zh', '/ja', '/en/tags', '/zh/tags', '/ja/tags', '/en/models', '/zh/models', '/ja/models']) {
    try {
      revalidatePath(p);
    } catch (e) {
      // 静默
    }
  }
  return paths;
}

/** upsert tags 表（去重 + 返回 ids） */
async function upsertTags(
  d1: D1,
  db: ReturnType<typeof getDb>,
  tagSlugs: string[],
): Promise<number[]> {
  if (!tagSlugs.length) return [];

  // 1) 查已存在的
  const existing = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.name, tagSlugs[0])) // 占位
    .all();

  // 简化做法：每个 tag 单独 INSERT OR IGNORE 后查 id
  // （tags 数量小，无需 batch 优化）
  const ids: number[] = [];
  for (const name of tagSlugs) {
    await d1
      .prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)')
      .bind(name)
      .run();
    const row = await d1
      .prepare('SELECT id FROM tags WHERE name = ?')
      .bind(name)
      .first<{ id: number }>();
    if (row) ids.push(row.id);
  }
  return ids;
}

/** upsert models 表（去重 + 返回 ids） */
async function upsertModels(
  d1: D1,
  db: ReturnType<typeof getDb>,
  modelSlugs: string[],
): Promise<{ id: number; slug: string; name: string }[]> {
  if (!modelSlugs.length) return [];

  const result: { id: number; slug: string; name: string }[] = [];
  for (const slug of modelSlugs) {
    const name = slug; // model 显示名就是 slug（schema 上没强制映射）
    await d1
      .prepare('INSERT OR IGNORE INTO models (slug, name) VALUES (?, ?)')
      .bind(slug, name)
      .run();
    const row = await d1
      .prepare('SELECT id, slug, name FROM models WHERE slug = ?')
      .bind(slug)
      .first<{ id: number; slug: string; name: string }>();
    if (row) result.push(row);
  }
  return result;
}

/** 重置 prompt 的 tags/models 关联（先全删后插） */
async function resetAssociations(
  d1: D1,
  promptId: number,
  tagIds: number[],
  modelIds: number[],
): Promise<void> {
  await d1
    .prepare('DELETE FROM prompt_tags WHERE prompt_id = ?')
    .bind(promptId)
    .run();
  await d1
    .prepare('DELETE FROM prompt_models WHERE prompt_id = ?')
    .bind(promptId)
    .run();

  for (const tagId of tagIds) {
    await d1
      .prepare('INSERT INTO prompt_tags (prompt_id, tag_id) VALUES (?, ?)')
      .bind(promptId, tagId)
      .run();
  }
  for (const modelId of modelIds) {
    await d1
      .prepare('INSERT INTO prompt_models (prompt_id, model_id) VALUES (?, ?)')
      .bind(promptId, modelId)
      .run();
  }
}

export async function POST(req: NextRequest): Promise<NextResponse<PublishResult | PublishError>> {
  const startTime = Date.now();

  // 1) 鉴权
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const adminSecretStr = await getSecret('admin-secret', 'ADMIN_SECRET', 'ADMIN_SECRET_DEV');
  if (!adminSecretStr || bearer !== adminSecretStr) {
    return unauthorized();
  }

  // 2) 解析 multipart
  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return badRequest('Failed to parse multipart body', (e as Error).message);
  }

  // 3) 必填字段
  const slug = String(form.get('slug') ?? '').trim();
  if (!slug) return badRequest('Missing required field: slug');
  if (!isValidSlug(slug)) {
    return badRequest('Invalid slug format', 'slug must be kebab-case without path traversal');
  }

  let frontmatter: FrontmatterPayload;
  try {
    frontmatter = parseFrontmatterField(form.get('frontmatter') as string | null);
  } catch (e) {
    return badRequest((e as Error).message);
  }

  // 4) 拿 D1 + R2
  let d1: D1;
  let r2: R2;
  let db: ReturnType<typeof getDb>;
  try {
    d1 = await getD1();
    r2 = await getR2();
    db = getDb(d1);
  } catch (e) {
    return serverError('Failed to access D1 or R2 binding', (e as Error).message);
  }

  // 5) 判断是 create 还是 update（同时取既有媒体 URL，用于 R2 key 去耦）
  const existing = await d1
    .prepare('SELECT id, cover_url, video_url FROM prompts WHERE slug = ?')
    .bind(slug)
    .first<{ id: number; cover_url: string | null; video_url: string | null }>();
  const operation: 'create' | 'update' = existing ? 'update' : 'create';

  // 6) 计算 R2 key（P0-2.1 去耦）：
  //    update 且 D1 已有媒体 URL → 从 URL 反解，覆盖同一路径（post_date 改动不产生孤儿对象）
  //    否则 → 按 post_date 推 YYYY-MM（create，或历史数据缺 URL 的兜底）
  const yearMonth = deriveYearMonth(frontmatter.post_date);
  const coverKey =
    keyFromMediaUrl(existing?.cover_url, slug) ?? `${R2_KEY_PREFIX}/${yearMonth}/${slug}/cover.jpg`;
  const videoKey =
    keyFromMediaUrl(existing?.video_url, slug) ?? `${R2_KEY_PREFIX}/${yearMonth}/${slug}/video.mp4`;

  // 7) 上传 R2（每次都覆盖；不提供则跳过）
  const uploaded = { cover: false, video: false };
  const coverFile = form.get('cover');
  if (coverFile instanceof File && coverFile.size > 0) {
    if (coverFile.size > MAX_FILE_SIZE) {
      return badRequest(`cover file too large`, `${coverFile.size} > ${MAX_FILE_SIZE}`);
    }
    const buf = await coverFile.arrayBuffer();
    const coverRes = await uploadToR2(r2, coverKey, buf, 'image/jpeg');
    uploaded.cover = coverRes.ok;
    if (!coverRes.ok) {
      return serverError('Failed to upload cover to R2', `${coverKey}: ${coverRes.error}`);
    }
  }
  const videoFile = form.get('video');
  if (videoFile instanceof File && videoFile.size > 0) {
    if (videoFile.size > MAX_FILE_SIZE) {
      return badRequest(`video file too large`, `${videoFile.size} > ${MAX_FILE_SIZE}`);
    }
    const buf = await videoFile.arrayBuffer();
    const videoRes = await uploadToR2(r2, videoKey, buf, 'video/mp4');
    uploaded.video = videoRes.ok;
    if (!videoRes.ok) {
      return serverError('Failed to upload video to R2', `${videoKey}: ${videoRes.error}`);
    }
  }

  // 8) 构建 R2 公开 URL（与实际上传 key 一致；update 未重传媒体时不会写入 D1，见下方 PATCH）
  const R2_PUBLIC = process.env.NEXT_PUBLIC_R2_PUBLIC_URL
    ?? 'https://static.awesomevideoprompts.com';
  const coverUrl = `${R2_PUBLIC}/${coverKey}`;
  const videoUrl = `${R2_PUBLIC}/${videoKey}`;

  // 9) D1 upsert
  const now = new Date().toISOString();
  let promptId: number;
  let backup: PublishResult['backup'];

  if (operation === 'create') {
    // INSERT 必须有 title（NOT NULL）
    if (!frontmatter.title) {
      return badRequest('title is required for create operation');
    }
    const insertResult = await d1
      .prepare(
        `INSERT INTO prompts (
          slug, title, description, video_url, cover_url, source_url, author,
          prompt_date, is_draft, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .bind(
        slug,
        frontmatter.title,
        frontmatter.description ?? '',
        videoUrl,
        coverUrl,
        frontmatter.source_url ?? null,
        frontmatter.author ?? null,
        frontmatter.post_date ?? now,
        now,
        now,
      )
      .run();
    // D1 的 last_row_id 在 meta 对象里（D1Result.meta.last_row_id）
    promptId = Number((insertResult as { meta?: { last_row_id?: number } }).meta?.last_row_id ?? 0);
    if (!promptId) {
      return serverError('Insert succeeded but no rowid returned', JSON.stringify(insertResult));
    }
  } else {
    // UPDATE：只更新提供的字段（PATCH 语义）
    promptId = existing!.id;

    // 3.4 发布前备份（best-effort，失败不阻断）
    backup = await backupBeforeUpdate(r2, d1, slug, promptId, now);

    const updates: string[] = [];
    const binds: unknown[] = [];

    if (frontmatter.title !== undefined) {
      updates.push('title = ?');
      binds.push(frontmatter.title);
    }
    if (frontmatter.description !== undefined) {
      updates.push('description = ?');
      binds.push(frontmatter.description);
    }
    // 媒体 URL：只在本次上传了新文件时更新（防止覆盖 R2 现有内容但 URL 没换的歧义）
    if (uploaded.cover) {
      updates.push('cover_url = ?');
      binds.push(coverUrl);
    }
    if (uploaded.video) {
      updates.push('video_url = ?');
      binds.push(videoUrl);
    }
    if (frontmatter.source_url !== undefined) {
      updates.push('source_url = ?');
      binds.push(frontmatter.source_url);
    }
    if (frontmatter.author !== undefined) {
      updates.push('author = ?');
      binds.push(frontmatter.author);
    }
    if (frontmatter.post_date !== undefined) {
      updates.push('prompt_date = ?');
      binds.push(frontmatter.post_date);
    }
    // is_draft 永远 0（这里的"草稿"在本地，不在 D1）
    updates.push('is_draft = 0');
    updates.push('updated_at = ?');
    binds.push(now);

    binds.push(promptId);
    await d1
      .prepare(`UPDATE prompts SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...binds)
      .run();
  }

  // 10) 处理 tags / models 关联（如果 frontmatter 提供了）
  if (frontmatter.tags !== undefined) {
    const tagIds = await upsertTags(d1, db, frontmatter.tags);
    if (frontmatter.models !== undefined) {
      const modelRecs = await upsertModels(d1, db, frontmatter.models);
      const modelIds = modelRecs.map((m) => m.id);
      await resetAssociations(d1, promptId, tagIds, modelIds);
    } else {
      await resetAssociations(d1, promptId, tagIds, []);
    }
  } else if (frontmatter.models !== undefined) {
    const modelRecs = await upsertModels(d1, db, frontmatter.models);
    const modelIds = modelRecs.map((m) => m.id);
    await resetAssociations(d1, promptId, [], modelIds);
  }

  // 11) revalidate
  const revalidated = revalidatePromptPaths(slug);

  // 12) 主动失效跨实例缓存（tags/models/最近列表，保证发布后立即可见）
  await Promise.allSettled([
    invalidateCache(CACHE_KEYS.allTags),
    invalidateCache(CACHE_KEYS.allModels),
    invalidateCache(`${CACHE_KEYS.recentPrompts}-48`),
  ]);

  const elapsed = Date.now() - startTime;
  console.log(
    `[admin/publish] ${operation} slug=${slug} promptId=${promptId} ` +
      `uploaded=${JSON.stringify(uploaded)} elapsed=${elapsed}ms`,
  );

  return NextResponse.json<PublishResult>({
    ok: true,
    slug,
    operation,
    uploaded,
    revalidated,
    promptId,
    ...(backup ? { backup } : {}),
  });
}

// 禁止 GET
export async function GET(): Promise<NextResponse<PublishError>> {
  return NextResponse.json({ error: 'Use POST' }, { status: 405 });
}
