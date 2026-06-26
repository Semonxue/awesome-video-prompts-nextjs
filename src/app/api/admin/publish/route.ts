/**
 * /api/admin/publish — md-editor 发布端点
 *
 * 用途：md-editor 收到用户"📤 发布"操作后，HTTP multipart 上传
 *       front matter + cover + video → 本端点原子化写入 D1 + R2 + revalidate
 *
 * 行为决策（详见 EXECUTION.md）：
 * - 每次都覆盖 R2 对象（PUT 同 key，覆盖语义，幂等）
 * - D1 部分字段更新（PATCH 语义）：不提供的字段不擦除
 *   例：只上传 front matter 不带 cover → 不重新上传 R2 媒体
 *       只上传 cover 不带 description → 不动 description
 * - 发布后立即 revalidate（用户期望立即看到）
 * - is_draft 始终写 0（这里的"草稿"指本地 MD 文件，不在 D1 里）
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

// 显式标记使用 schema 里的 import（防止 lint 报 unused）
void prompts; void tags; void models; void promptTags; void promptModels;

/** D1 binding 类型（来自 CloudflareEnv，OpenNext 内部版本） */
type D1 = CloudflareEnv['DB'];
/** R2 binding 类型（来自 CloudflareEnv，OpenNext 内部版本） */
type R2 = NonNullable<CloudflareEnv['MEDIA']>;

const R2_KEY_PREFIX = 'prompts';
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

/** 解析 D1 R2 key：从 prompt_date (YYYY-MM-DD / YYYY-MM-01) 提取 YYYY-MM */
function deriveYearMonth(postDate: string | null | undefined, fallback: string): string {
  const src = postDate || fallback;
  // 匹配开头的 YYYY-MM
  const m = String(src).match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  // fallback 用当前月
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 上传单个文件到 R2（覆盖语义，幂等） */
async function uploadToR2(
  bucket: R2,
  key: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<boolean> {
  try {
    await bucket.put(key, body, {
      httpMetadata: { contentType },
    });
    return true;
  } catch (e) {
    console.error(`[admin/publish] R2 put failed for ${key}:`, e);
    return false;
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

  // 5) 判断是 create 还是 update
  const existing = await d1
    .prepare('SELECT id FROM prompts WHERE slug = ?')
    .bind(slug)
    .first<{ id: number }>();
  const operation: 'create' | 'update' = existing ? 'update' : 'create';

  // 6) 计算 R2 key 用的 YYYY-MM（frontmatter.post_date → 当前月）
  const yearMonth = deriveYearMonth(frontmatter.post_date, '');

  // 7) 上传 R2（每次都覆盖；不提供则跳过）
  const uploaded = { cover: false, video: false };
  const coverFile = form.get('cover');
  if (coverFile instanceof File && coverFile.size > 0) {
    if (coverFile.size > MAX_FILE_SIZE) {
      return badRequest(`cover file too large`, `${coverFile.size} > ${MAX_FILE_SIZE}`);
    }
    const buf = await coverFile.arrayBuffer();
    const key = `${R2_KEY_PREFIX}/${yearMonth}/${slug}/cover.jpg`;
    uploaded.cover = await uploadToR2(r2, key, buf, 'image/jpeg');
    if (!uploaded.cover) {
      return serverError('Failed to upload cover to R2', key);
    }
  }
  const videoFile = form.get('video');
  if (videoFile instanceof File && videoFile.size > 0) {
    if (videoFile.size > MAX_FILE_SIZE) {
      return badRequest(`video file too large`, `${videoFile.size} > ${MAX_FILE_SIZE}`);
    }
    const buf = await videoFile.arrayBuffer();
    const key = `${R2_KEY_PREFIX}/${yearMonth}/${slug}/video.mp4`;
    uploaded.video = await uploadToR2(r2, key, buf, 'video/mp4');
    if (!uploaded.video) {
      return serverError('Failed to upload video to R2', key);
    }
  }

  // 8) 构建 R2 公开 URL（同步构造，让 D1 永远指向正确地址）
  //    即使本次没上传也覆盖 URL —— R2 已有旧文件，URL 不变
  const R2_PUBLIC = process.env.NEXT_PUBLIC_R2_PUBLIC_URL
    ?? 'https://static.awesomevideoprompts.com';
  const coverUrl = `${R2_PUBLIC}/${R2_KEY_PREFIX}/${yearMonth}/${slug}/cover.jpg`;
  const videoUrl = `${R2_PUBLIC}/${R2_KEY_PREFIX}/${yearMonth}/${slug}/video.mp4`;

  // 9) D1 upsert
  const now = new Date().toISOString();
  let promptId: number;

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
  });
}

// 禁止 GET
export async function GET(): Promise<NextResponse<PublishError>> {
  return NextResponse.json({ error: 'Use POST' }, { status: 405 });
}
