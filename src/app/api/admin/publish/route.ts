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
import { type NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { prompts, tags, models, promptTags, promptModels } from '@/db/schema';
import { deriveYearMonth, keyFromMediaUrl, R2_KEY_PREFIX } from '@/lib/r2-keys';
import { invalidateCache, CACHE_KEYS, bumpNamespaceVersion } from '@/db/cache';
import { rebuildAllAggregateCaches } from '@/db/queries';
import {
  AGG_CACHE_KEYS,
  invalidateAggregateCache,
  markAggregatesDirty,
  clearAggregatesDirty,
} from '@/db/aggregate-cache';
import { syncAllDicts, type DictSyncCombined } from '@/lib/dict-sync';

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
  /** 发布时字典校准结果（data/yaml → D1 models/tags）。best-effort，失败不阻断发布 */
  dictSync?: DictSyncCombined;
  /** 本次请求是否推迟了聚合缓存重建（rebuild=0，由批量发布客户端稍后统一调用 rebuild-aggregates） */
  rebuildDeferred?: boolean;
  /** 各阶段耗时（毫秒），发布慢的时候直接看这里定位 */
  timings?: Record<string, number>;
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

/**
 * revalidate 三语言对应路径
 *
 * @param includeIndexes 是否同时刷首页 / 标签页 / 模型页 / sitemap。
 *   批量发布（rebuild=0）时传 false：这些索引页由批次结束后的
 *   /api/admin/rebuild-aggregates 统一刷，避免每条发布重复失效 9 个路径。
 */
function revalidatePromptPaths(slug: string, includeIndexes = true): string[] {
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
  if (includeIndexes) {
    for (const p of ['/en', '/zh', '/ja', '/en/tags', '/zh/tags', '/ja/tags', '/en/models', '/zh/models', '/ja/models', '/sitemap.xml']) {
      try {
        revalidatePath(p);
      } catch (e) {
        // 静默
      }
    }
  }
  return paths;
}

/**
 * upsert tags 表（去重 + 返回 ids）
 *
 * 2026-11-17：改成 2 次往返（多行 INSERT OR IGNORE + 一次 IN 查询）。
 * 旧实现每个 tag 2 次往返（INSERT + SELECT），5 个 tag 就是 10 次串行 D1，
 * 在"批量发布每条都要走一遍"的场景里是纯浪费；顺带删掉了那个 `where(eq(tags.name, tagSlugs[0]))`
 * 的占位查询（查出来直接丢掉，注释里也写着"占位"）。
 */
async function upsertTags(d1: D1, tagSlugs: string[]): Promise<number[]> {
  const names = [...new Set(tagSlugs.map((t) => String(t).trim()).filter(Boolean))];
  if (!names.length) return [];

  const placeholders = names.map(() => '(?)').join(', ');
  await d1
    .prepare(`INSERT OR IGNORE INTO tags (name) VALUES ${placeholders}`)
    .bind(...names)
    .run();

  const rows = await d1
    .prepare(`SELECT id, name FROM tags WHERE name IN (${names.map(() => '?').join(', ')})`)
    .bind(...names)
    .all<{ id: number; name: string }>();

  const idByName = new Map((rows.results ?? []).map((r) => [r.name, r.id]));
  return names.map((n) => idByName.get(n)).filter((v): v is number => typeof v === 'number');
}

/** upsert models 表（去重 + 返回 id/slug/name），同上：2 次往返代替 2×N 次 */
async function upsertModels(
  d1: D1,
  modelSlugs: string[],
): Promise<{ id: number; slug: string; name: string }[]> {
  const slugs = [...new Set(modelSlugs.map((m) => String(m).trim()).filter(Boolean))];
  if (!slugs.length) return [];

  // model 显示名就是 slug（schema 上没强制映射）
  const placeholders = slugs.map(() => '(?, ?)').join(', ');
  await d1
    .prepare(`INSERT OR IGNORE INTO models (slug, name) VALUES ${placeholders}`)
    .bind(...slugs.flatMap((slug) => [slug, slug]))
    .run();

  const rows = await d1
    .prepare(`SELECT id, slug, name FROM models WHERE slug IN (${slugs.map(() => '?').join(', ')})`)
    .bind(...slugs)
    .all<{ id: number; slug: string; name: string }>();
  return rows.results ?? [];
}

/**
 * 重置 prompt 的 tags/models 关联（先全删后插）
 *
 * 2026-11-17：用一个 D1 batch 提交（2 条 DELETE + N 条 INSERT 一次往返）。
 * 旧实现每条 INSERT 单独 await，5 tags + 1 model = 9 次串行往返。
 */
async function resetAssociations(
  d1: D1,
  promptId: number,
  tagIds: number[],
  modelIds: number[],
): Promise<void> {
  const stmts = [
    d1.prepare('DELETE FROM prompt_tags WHERE prompt_id = ?').bind(promptId),
    d1.prepare('DELETE FROM prompt_models WHERE prompt_id = ?').bind(promptId),
    ...tagIds.map((tagId) =>
      d1.prepare('INSERT INTO prompt_tags (prompt_id, tag_id) VALUES (?, ?)').bind(promptId, tagId),
    ),
    ...modelIds.map((modelId) =>
      d1.prepare('INSERT INTO prompt_models (prompt_id, model_id) VALUES (?, ?)').bind(promptId, modelId),
    ),
  ];
  await d1.batch(stmts);
}

export async function POST(req: NextRequest): Promise<NextResponse<PublishResult | PublishError>> {
  const startTime = Date.now();
  // 阶段计时（发布慢时直接看响应/log 里的 timings，不用再猜）
  const timings: Record<string, number> = {};
  let mark = startTime;
  const lap = (name: string) => {
    const now = Date.now();
    timings[name] = now - mark;
    mark = now;
  };

  // 1) 鉴权
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const adminSecretStr = await getSecret('admin-secret', 'ADMIN_SECRET', 'ADMIN_SECRET_DEV');
  if (!adminSecretStr || bearer !== adminSecretStr) {
    return unauthorized();
  }
  lap('auth');

  // 2) 解析 multipart
  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return badRequest('Failed to parse multipart body', (e as Error).message);
  }
  lap('parse');

  // 2.5) 是否在本次请求内重建聚合缓存
  //     默认 1（单条发布：强一致，立即生效）。
  //     md-editor 批量发布会传 0：每条只写 D1 + R2 媒体，批次结束再统一调一次
  //     /api/admin/rebuild-aggregates —— 避免 N 条发布做 N 次全站聚合重建。
  const rebuildRaw = String(form.get('rebuild') ?? '1').trim().toLowerCase();
  const shouldRebuild = !(rebuildRaw === '0' || rebuildRaw === 'false');

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
  try {
    d1 = await getD1();
    r2 = await getR2();
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
  lap('upload');

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

  lap('d1');

  // 10) 处理 tags / models 关联（如果 frontmatter 提供了）
  if (frontmatter.tags !== undefined) {
    const tagIds = await upsertTags(d1, frontmatter.tags);
    if (frontmatter.models !== undefined) {
      const modelRecs = await upsertModels(d1, frontmatter.models);
      const modelIds = modelRecs.map((m) => m.id);
      await resetAssociations(d1, promptId, tagIds, modelIds);
    } else {
      await resetAssociations(d1, promptId, tagIds, []);
    }
  } else if (frontmatter.models !== undefined) {
    const modelRecs = await upsertModels(d1, frontmatter.models);
    const modelIds = modelRecs.map((m) => m.id);
    await resetAssociations(d1, promptId, [], modelIds);
  }

  // 10.5) 字典校准（data/yaml → D1 models + tags）
  //       best-effort：校准失败只 warn 不阻断发布（yaml 真源是人工维护的，
  //       异步问题不该影响主发布流程；deploy.sh 还会跑一次保险）。
  //       位置：必须在 rebuildAllAggregateCaches() 之前，否则缓存会基于旧字典。
  let dictSync: DictSyncCombined | undefined;
  try {
    dictSync = await syncAllDicts(d1);
    const totalChanged =
      dictSync.models.summary.inserted +
      dictSync.models.summary.updated +
      dictSync.models.summary.deleted +
      dictSync.tags.summary.inserted +
      dictSync.tags.summary.deleted;
    if (totalChanged > 0) {
      console.log(
        `[admin/publish] dictSync: models +${dictSync.models.summary.inserted}/` +
          `~${dictSync.models.summary.updated}/-${dictSync.models.summary.deleted}, ` +
          `tags +${dictSync.tags.summary.inserted}/-${dictSync.tags.summary.deleted}`,
      );
    }
    if (!dictSync.models.ok) {
      console.warn(`[admin/publish] dictSync.models failed: ${dictSync.models.error}`);
    }
    if (!dictSync.tags.ok) {
      console.warn(`[admin/publish] dictSync.tags failed: ${dictSync.tags.error}`);
    }
  } catch (e) {
    console.warn(`[admin/publish] dictSync threw: ${(e as Error).message}`);
  }

  // 11) 重建 R2 聚合缓存 — 必须在 revalidate 之前！
  //     背景（2026-08-18 修复）：之前 revalidate 在前，ISR 触发详情页渲染时
  //     getRelatedPromptsFromMap → readAggregateCache(related-map) → R2 还没文件
  //     → 写 null 进 L1+L2（5min TTL）→ fallback D1。即使 rebuild 写了 R2，5min 内
  //     L1+L2 仍返回 null，导致静态化失效。
  //     修法：先写 R2 → invalidate 可能已有的 null → 再 revalidate。
  //
  // 2026-11-17 批量发布提速：md-editor 批量发布会传 rebuild=0，把这里延后到
  // 整批结束统一跑一次（见 /api/admin/rebuild-aggregates）。单条发布（默认）
  // 仍然同步重建，保证"点发布 → 立刻生效"。
  lap('assoc');
  let rebuildDeferred = false;
  if (shouldRebuild) {
    await rebuildAllAggregateCaches();
    await Promise.allSettled([
      invalidateAggregateCache(AGG_CACHE_KEYS.relatedMap),
      invalidateAggregateCache(AGG_CACHE_KEYS.adjacentMap),
    ]);
    // 这次已经同步重建过，之前批量发布留下的脏标记可以清掉
    await clearAggregatesDirty();
  } else {
    rebuildDeferred = true;
    // 留一个"脏标记"：批次客户端中途挂掉时，下次发布/人工 rebuild 能发现并补跑
    await markAggregatesDirty(`publish:${slug}`).catch(() => undefined);
  }
  lap('rebuild');

  // 12) revalidate（批量模式下只刷本详情页，索引页交给批次结束后的重建统一刷）
  const revalidated = revalidatePromptPaths(slug, shouldRebuild);
  lap('revalidate');

  // 13) 失效内存级缓存（recentPrompts / promptBySlug 仍走 cache.ts）
  await Promise.allSettled([
    invalidateCache(`${CACHE_KEYS.recentPrompts}-48`),
    invalidateCache(`${CACHE_KEYS.promptBySlug}-${slug}`),
    // 2026-08-15 D1 cost 优化：任何 publish 都可能让任意 slug 的相关/上下篇结果变化
    // (namespace version stamp：bump 后所有旧 key 不可达)
    bumpNamespaceVersion('related'),
    bumpNamespaceVersion('adjacent'),
  ]);

  lap('cache');
  const elapsed = Date.now() - startTime;
  timings.total = elapsed;
  console.log(
    `[admin/publish] ${operation} slug=${slug} promptId=${promptId} ` +
      `uploaded=${JSON.stringify(uploaded)} rebuildDeferred=${rebuildDeferred} ` +
      `elapsed=${elapsed}ms timings=${JSON.stringify(timings)}`,
  );

  return NextResponse.json<PublishResult>({
    ok: true,
    slug,
    operation,
    uploaded,
    revalidated,
    promptId,
    ...(backup ? { backup } : {}),
    ...(dictSync ? { dictSync } : {}),
    ...(rebuildDeferred ? { rebuildDeferred } : {}),
    timings,
  });
}

// 禁止 GET
export async function GET(): Promise<NextResponse<PublishError>> {
  return NextResponse.json({ error: 'Use POST' }, { status: 405 });
}
