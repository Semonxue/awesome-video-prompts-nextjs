/**
 * 轻量查询：仅取 slug + updatedAt（sitemap 等场景用，不 hydrate tags/models）
 */
export async function listAllSlugsForSitemap(): Promise<Array<{ slug: string; updatedAt: string }>> {
  const d1 = await getD1();
  const db = getDb(d1);
  const rows = await db
    .select({ slug: prompts.slug, updatedAt: prompts.updatedAt })
    .from(prompts)
    .where(eq(prompts.isDraft, 0))
    .orderBy(desc(prompts.promptDate));
  return rows;
}

/**
 * 数据查询层（Page → DB 边界）
 *
 * 实现：在 Cloudflare Workers 运行时通过 getCloudflareContext() 拿 D1 binding
 *   - Drizzle queries via getDb(d1).select()...leftJoin()...
 *   - 两步法：先查主表（分页），再按 promptIds 批量查 tags/models 拼成 PromptCardData
 *   - ISR 1h 缓存已覆盖性能
 *
 * 内容不分 locale：UI 多语言由 next-intl 处理，prompt 内容是全局一份
 * 调用方：首页 (page.tsx) / 详情页 ([slug]/page.tsx) / 标签页 / 模型页
 * 部署目标：Cloudflare Workers via OpenNext
 */

import { eq, and, inArray, like, or, sql, desc } from 'drizzle-orm';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { PromptCardData, ModelRef, TagRef } from '@/components/types';
import { getDb } from './index';
import { prompts, tags, models, promptTags, promptModels } from './schema';
import { formatModelName } from '@/lib/format';

/** 拿 D1 binding（OpenNext 注入 env.DB） */
async function getD1(): Promise<D1Database> {
  const ctx = await getCloudflareContext({ async: true });
  const db = ctx.env.DB;
  if (!db) throw new Error('D1 binding (env.DB) not found in Cloudflare context');
  return db;
}

/**
 * 列表查询参数（首页/标签页/模型页共用）
 * 内容不分 locale；locale 仅用于 UI（next-intl）
 */
export interface ListPromptsArgs {
  /** 标签筛选（slug，可选） */
  tag?: string;
  /** 模型筛选（slug，可选） */
  model?: string;
  /** 关键词搜索（LIKE 兜底） */
  q?: string;
  /** 分页 */
  limit?: number;
  offset?: number;
}

export interface ListPromptsResult {
  items: PromptCardData[];
  total: number;
  hasMore: boolean;
}

/**
 * 内部：从 DB 行组装成 PromptCardData（批量预查 tags/models 后拼装）
 *
 * 实现：D1 单 query 的 SQL variables 上限实测 ~461（不是 SQL 默认的 999）
 *       详情页 listPrompts({ limit: 200 }) + Drizzle inArray 会展开成 ~461 个变量 → 500
 * 修法：对 ids 分批 chunk，每批独立 query 后合并
 *       - chunk = 100：实测安全（< 200 变量 + 关联列引用 < 461 阈值）
 *       - round-trip 数 = ceil(N / 100)；100 条 prompt = 1 次；200 条 = 2 次
 *       - 4479 条 tag/model 关联进单 prompt 的 hydrate 不触发（单条走单 query）
 */
async function hydratePrompts(
  rows: Array<typeof prompts.$inferSelect>,
): Promise<PromptCardData[]> {
  if (rows.length === 0) return [];

  const d1 = await getD1();
  const db = getDb(d1);
  const ids = rows.map((r) => r.id);

  const CHUNK = 100;
  const tagRows: Array<{ promptId: number; slug: string }> = [];
  const modelRows: Array<{ promptId: number; slug: string; name: string }> = [];

  for (let i = 0; i < ids.length; i += CHUNK) {
    const idChunk = ids.slice(i, i + CHUNK);

    const tagChunk = await db
      .select({
        promptId: promptTags.promptId,
        slug: tags.name,
      })
      .from(promptTags)
      .innerJoin(tags, eq(promptTags.tagId, tags.id))
      .where(inArray(promptTags.promptId, idChunk));
    tagRows.push(...tagChunk);

    const modelChunk = await db
      .select({
        promptId: promptModels.promptId,
        slug: models.slug,
        name: models.name,
      })
      .from(promptModels)
      .innerJoin(models, eq(promptModels.modelId, models.id))
      .where(inArray(promptModels.promptId, idChunk));
    modelRows.push(...modelChunk);
  }

  // 按 promptId 索引
  const tagsByPromptId = new Map<number, TagRef[]>();
  for (const t of tagRows) {
    const arr = tagsByPromptId.get(t.promptId) ?? [];
    arr.push({ slug: t.slug, name: t.slug });
    tagsByPromptId.set(t.promptId, arr);
  }
  const modelsByPromptId = new Map<number, ModelRef[]>();
  for (const m of modelRows) {
    const arr = modelsByPromptId.get(m.promptId) ?? [];
    arr.push({ slug: m.slug, name: formatModelName(m.slug) });
    modelsByPromptId.set(m.promptId, arr);
  }

  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    description: r.description,
    coverUrl: r.coverUrl,
    videoUrl: r.videoUrl,
    sourceUrl: r.sourceUrl,
    author: r.author,
    promptDate: r.promptDate,
    models: modelsByPromptId.get(r.id) ?? [],
    tags: tagsByPromptId.get(r.id) ?? [],
  }));
}

/**
 * 列表查询 — 首页 / 标签 / 模型 页面入口
 */
export async function listPrompts(args: ListPromptsArgs): Promise<ListPromptsResult> {
  const { tag, model, q, limit = 24, offset = 0 } = args;

  const d1 = await getD1();
  const db = getDb(d1);

  // WHERE 条件
  const conditions = [eq(prompts.isDraft, 0)];

  // 关联筛选：tag / model 通过子查询过滤 promptId
  if (tag) {
    const tagPromptIds = db
      .select({ id: promptTags.promptId })
      .from(promptTags)
      .innerJoin(tags, eq(promptTags.tagId, tags.id))
      .where(eq(tags.name, tag));
    conditions.push(inArray(prompts.id, tagPromptIds));
  }
  if (model) {
    const modelPromptIds = db
      .select({ id: promptModels.promptId })
      .from(promptModels)
      .innerJoin(models, eq(promptModels.modelId, models.id))
      .where(eq(models.slug, model));
    conditions.push(inArray(prompts.id, modelPromptIds));
  }
  if (q && q.trim()) {
    const kw = `%${q.trim().toLowerCase()}%`;
    conditions.push(
      or(like(sql`lower(${prompts.title})`, kw), like(sql`lower(${prompts.description})`, kw))!,
    );
  }

  const whereClause = and(...conditions);

  // 1) 总数
  const totalRows = await db
    .select({ c: sql<number>`count(*)` })
    .from(prompts)
    .where(whereClause);
  const total = Number(totalRows[0]?.c ?? 0);

  // 2) 主表分页
  const rows = await db
    .select()
    .from(prompts)
    .where(whereClause)
    .orderBy(desc(prompts.promptDate), desc(prompts.id))
    .limit(limit)
    .offset(offset);

  // 3) hydrate（批量查 tags/models）
  const items = await hydratePrompts(rows);

  return { items, total, hasMore: offset + rows.length < total };
}

/**
 * 单条查询 — 详情页入口（不分 locale）
 */
export async function getPromptBySlug(slug: string): Promise<PromptCardData | null> {
  const d1 = await getD1();
  const db = getDb(d1);

  const rows = await db
    .select()
    .from(prompts)
    .where(and(eq(prompts.slug, slug), eq(prompts.isDraft, 0)))
    .limit(1);

  if (rows.length === 0) return null;
  const [hydrated] = await hydratePrompts(rows);
  return hydrated;
}

/**
 * 全部 tags — 标签页/筛选器下拉用（全局唯一，不分 locale）
 * 按 count DESC 排序；只统计有 prompt 关联的 tag（避免孤儿）
 */
export async function listAllTags(): Promise<{ slug: string; name: string; count: number }[]> {
  const d1 = await getD1();
  const db = getDb(d1);

  const rows = await db
    .select({
      slug: tags.name,
      count: sql<number>`count(${promptTags.promptId})`,
    })
    .from(tags)
    .innerJoin(promptTags, eq(promptTags.tagId, tags.id))
    .innerJoin(prompts, and(eq(prompts.id, promptTags.promptId), eq(prompts.isDraft, 0)))
    .groupBy(tags.name)
    .orderBy(desc(sql`count(${promptTags.promptId})`), tags.name);

  return rows.map((r) => ({ slug: r.slug, name: r.slug, count: Number(r.count) }));
}

/**
 * 全部 models — 模型页用（全局唯一，不分 locale）
 */
export async function listAllModels(): Promise<{ slug: string; name: string; count: number }[]> {
  const d1 = await getD1();
  const db = getDb(d1);

  const rows = await db
    .select({
      slug: models.slug,
      name: models.name,
      count: sql<number>`count(${promptModels.promptId})`,
    })
    .from(models)
    .innerJoin(promptModels, eq(promptModels.modelId, models.id))
    .innerJoin(prompts, and(eq(prompts.id, promptModels.promptId), eq(prompts.isDraft, 0)))
    .groupBy(models.slug, models.name)
    .orderBy(desc(sql`count(${promptModels.promptId})`), models.name);

  return rows.map((r) => ({ slug: r.slug, name: formatModelName(r.slug), count: Number(r.count) }));
}
