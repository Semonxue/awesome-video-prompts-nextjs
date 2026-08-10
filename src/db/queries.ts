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

import { eq, and, inArray, like, or, sql, desc, ne, lt, gt } from 'drizzle-orm';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { PromptCardData, ModelRef, TagRef } from '@/components/types';
import { getDb } from './index';
import { prompts, tags, models, promptTags, promptModels } from './schema';
import { getCachedData, CACHE_KEYS } from './cache';
import {
  AGG_CACHE_KEYS,
  readAggregateCache,
  writeAggregateCache,
  invalidateAggregateCache,
  type CountsCache,
} from './aggregate-cache';
import { MODELS_DICT, TAGS_DICT } from '@/lib/dict-yaml';

/** 拿 D1 binding（OpenNext 注入 env.DB） */
async function getD1(): Promise<D1Database> {
  const ctx = await getCloudflareContext({ async: true });
  const db = ctx.env.DB;
  if (!db) throw new Error('D1 binding (env.DB) not found in Cloudflare context');
  return db;
}

/**
 * 查单个 model 的显示名（model 详情页用）。
 *
 * D1 models.name = 渲染真源（dict-sync 跟 yaml 100% 对齐）。
 * fallback 链：D1 → yaml MODELS_DICT → slug。绝不用 formatModelName 杜撰逻辑。
 * 不走 INNER JOIN（listAllModels/queryAllModels 限制只返回有 prompt 关联的 model，
 * 全新 model 还没 prompt 时也必须能拿到 name）。
 */
export async function getModelName(slug: string): Promise<string> {
  const d1 = await getD1();
  const row = await d1
    .prepare('SELECT name FROM models WHERE slug = ?')
    .bind(slug)
    .first<{ name: string }>();
  return row?.name || MODELS_DICT[slug]?.name || slug;
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
export async function hydratePrompts(
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
  // name 直接用 D1 models.name（渲染真源）。D1 跟 yaml 100% 对齐由 dict-sync 保证
  // （publish route + deploy.sh 双保险）。早期 import 残条（无 yaml slug）兜底到 yaml，
  // 仍找不到才回退 slug —— 绝不再走 formatModelName 这种杜撰逻辑。
  const tagsByPromptId = new Map<number, TagRef[]>();
  for (const t of tagRows) {
    const arr = tagsByPromptId.get(t.promptId) ?? [];
    arr.push({ slug: t.slug, name: TAGS_DICT[t.slug]?.en ?? t.slug });
    tagsByPromptId.set(t.promptId, arr);
  }
  const modelsByPromptId = new Map<number, ModelRef[]>();
  for (const m of modelRows) {
    const arr = modelsByPromptId.get(m.promptId) ?? [];
    arr.push({ slug: m.slug, name: m.name || MODELS_DICT[m.slug]?.name || m.slug });
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

/** 实时 count（R2 counts 缓存 miss 或带关键词搜索时兜底） */
async function countPrompts(whereClause: ReturnType<typeof and> | undefined): Promise<number> {
  const d1 = await getD1();
  const db = getDb(d1);
  const totalRows = await db
    .select({ c: sql<number>`count(*)` })
    .from(prompts)
    .where(whereClause);
  return Number(totalRows[0]?.c ?? 0);
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
      or(
        like(sql`lower(${prompts.title})`, kw),
        like(sql`lower(${prompts.description})`, kw),
        like(prompts.slug, kw),
        like(sql`lower(${prompts.author})`, kw),
      )!,
    );
  }

  const whereClause = and(...conditions);

  // 1) 总数 — 优先从 R2 counts 缓存取（发布时全量重算覆盖写，读时零 D1 扫描）
  //    仅当无关键词搜索时可用（q 是 LIKE 全表扫描，无法预聚合）
  let total: number;
  if (!q || !q.trim()) {
    const counts = await readAggregateCache<CountsCache>(AGG_CACHE_KEYS.counts);
    if (counts) {
      if (tag) total = counts.tags[tag] ?? 0;
      else if (model) total = counts.models[model] ?? 0;
      else total = counts.total;
    } else {
      total = await countPrompts(whereClause);
    }
  } else {
    total = await countPrompts(whereClause);
  }

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
 * 批量查重 — 按 twitter id 检查线上是否已存在对应 prompt
 *
 * 匹配逻辑（双保险）：
 *   - source_url 包含 `/status/<id>`（最可靠，不依赖 slug 约定）
 *   - slug 以 `<id>-` 开头（兼容 slug 前缀约定）
 *
 * 返回：已存在的 twitter id 集合
 * 调用方：/api/prompts/check-duplicates（LLM 批量预处理前查重）
 */
export async function checkDuplicateTweetIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const d1 = await getD1();
  const db = getDb(d1);

  const existing = new Set<string>();
  // D1 单 query 变量上限 ~461：每批 50 个 id × 2 条件 = 100 变量，安全
  const CHUNK = 50;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const conds = chunk.flatMap((id) => [
      like(prompts.sourceUrl, `%/status/${id}%`),
      like(prompts.slug, `${id}-%`),
    ]);
    const rows = await db
      .select({ sourceUrl: prompts.sourceUrl, slug: prompts.slug })
      .from(prompts)
      .where(or(...conds));
    for (const r of rows) {
      for (const id of chunk) {
        if (r.sourceUrl?.includes(`/status/${id}`) || r.slug?.startsWith(`${id}-`)) {
          existing.add(id);
        }
      }
    }
  }
  return existing;
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
 * 最近 N 条 prompts（详情页相关推荐用）— 跨实例缓存
 *
 * 背景（2026-08-07 优化）：
 *   - 详情页每次渲染都调 listPrompts({ limit: 48 }) 拉全量列表做相关推荐
 *   - 该数据只在发布新 prompt 时变化，缓存 5 分钟完全合理
 *   - publish 时主动失效，保证发布后立即可见
 */
export async function listRecentPromptsCached(limit = 48): Promise<ListPromptsResult> {
  return getCachedData(`${CACHE_KEYS.recentPrompts}-${limit}`, async () => {
    return listPrompts({ limit });
  });
}

/**
 * 全部 tags — 标签页/筛选器下拉用（全局唯一，不分 locale）
 * 按 count DESC 排序；只统计有 prompt 关联的 tag（避免孤儿）
 *
 * 缓存（2026-08-07 优化）：
 *   - 原实现只有模块级缓存，但 Worker 实例频繁回收导致缓存形同虚设
 *   - 现用跨实例缓存（L1 内存 + L2 Cache API），TTL 5 分钟
 *   - publish 时主动失效，保证发布后立即可见
 */
/** 实时查询全部 tags（R2 缓存 miss 或重建时用，不走缓存） */
async function queryAllTags(): Promise<{ slug: string; name: string; count: number; updatedAt: string }[]> {
  const d1 = await getD1();
  const db = getDb(d1);

  const rows = await db
    .select({
      slug: tags.name,
      count: sql<number>`count(${promptTags.promptId})`,
      updatedAt: sql<string>`max(${prompts.updatedAt})`,
    })
    .from(tags)
    .innerJoin(promptTags, eq(promptTags.tagId, tags.id))
    .innerJoin(prompts, and(eq(prompts.id, promptTags.promptId), eq(prompts.isDraft, 0)))
    .groupBy(tags.name)
    .orderBy(desc(sql`count(${promptTags.promptId})`), tags.name);

  // name 取 yaml 真源（data/tags.yaml 默认英文）；yaml 未收录时回退到 slug
  return rows.map((r) => ({ slug: r.slug, name: TAGS_DICT[r.slug]?.en ?? r.slug, count: Number(r.count), updatedAt: r.updatedAt ?? '' }));
}

export async function listAllTags(): Promise<{ slug: string; name: string; count: number; updatedAt: string }[]> {
  // R2 聚合缓存：发布时全量重算覆盖写，读时直接取（CDN 缓存，零 D1 扫描）
  // L1+L2 由 aggregate-cache.ts 内部提供（复用 cache.ts 的 getCachedData）
  const cached = await readAggregateCache<{ slug: string; name: string; count: number; updatedAt: string }[]>(
    AGG_CACHE_KEYS.tags,
  );
  if (cached) return cached;

  // 兜底：缓存不存在（首次部署）→ 实时查询 + 写 R2
  // 注意：readAggregateCache 会把 null 写入 L1+L2，写完 R2 后必须 invalidateAggregateCache
  //       清掉这个 null，否则后续 5min 内的读仍返回 null → 反复触发兜底 queryAll
  const result = await queryAllTags();
  await writeAggregateCache(AGG_CACHE_KEYS.tags, result);
  await invalidateAggregateCache(AGG_CACHE_KEYS.tags);
  return result;
}

/**
 * 全部 models — 模型页用（全局唯一，不分 locale）
 * 跨实例缓存 5 分钟（同 listAllTags）
 */
/** 实时查询全部 models（R2 缓存 miss 或重建时用，不走缓存） */
async function queryAllModels(): Promise<{ slug: string; name: string; count: number; updatedAt: string }[]> {
  const d1 = await getD1();
  const db = getDb(d1);

  const rows = await db
    .select({
      slug: models.slug,
      name: models.name,
      count: sql<number>`count(${promptModels.promptId})`,
      updatedAt: sql<string>`max(${prompts.updatedAt})`,
    })
    .from(models)
    .innerJoin(promptModels, eq(promptModels.modelId, models.id))
    .innerJoin(prompts, and(eq(prompts.id, promptModels.promptId), eq(prompts.isDraft, 0)))
    .groupBy(models.slug, models.name)
    .orderBy(desc(sql`count(${promptModels.promptId})`), models.name);

  // name 直接用 D1 models.name（渲染真源）。yaml 兜底仅针对早期 import 残条（无 yaml slug），
  // 仍找不到才回退 slug —— 绝不再走 formatModelName 这种杜撰逻辑。
  return rows.map((r) => ({ slug: r.slug, name: r.name || MODELS_DICT[r.slug]?.name || r.slug, count: Number(r.count), updatedAt: r.updatedAt ?? '' }));
}

export async function listAllModels(): Promise<{ slug: string; name: string; count: number; updatedAt: string }[]> {
  // R2 聚合缓存：发布时全量重算覆盖写，读时直接取（CDN 缓存，零 D1 扫描）
  // L1+L2 由 aggregate-cache.ts 内部提供（复用 cache.ts 的 getCachedData）
  const cached = await readAggregateCache<{ slug: string; name: string; count: number; updatedAt: string }[]>(
    AGG_CACHE_KEYS.models,
  );
  if (cached) return cached;

  // 兜底：缓存不存在（首次部署）→ 实时查询 + 写 R2
  // 注意：readAggregateCache 会把 null 写入 L1+L2，写完 R2 后必须 invalidateAggregateCache
  //       清掉这个 null，否则后续 5min 内的读仍返回 null → 反复触发兜底 queryAll
  const result = await queryAllModels();
  await writeAggregateCache(AGG_CACHE_KEYS.models, result);
  await invalidateAggregateCache(AGG_CACHE_KEYS.models);
  return result;
}
/**
 * 单个 model 的 tag 分布 — 模型页用
 *
 * 背景（2026-08-07 Error 1102 修复）：
 *   - 之前模型页调 listPrompts({ model }) 默认 limit=24 拿 tag 分布，逻辑 bug（不全）
 *   - 而且 listPrompts 内部走 3 次 D1 round-trip + 完整 hydrate，CPU 成本高
 *   - 现改为专用 SQL：1 次 JOIN 直接 GROUP BY tag，1 次 D1 round-trip 完成
 *   - 加跨实例缓存 5 分钟（同 listAllTags 模式）
 *   - publish/unpublish/delete 时通过 listAllModels() 遍历失效对应 key
 */
/** 实时查询单个 model 的 tag 分布（R2 缓存 miss 或重建时用，不走缓存） */
async function queryModelTagDistribution(
  modelSlug: string,
): Promise<{ slug: string; name: string; count: number }[]> {
  const d1 = await getD1();
  const db = getDb(d1);
  const rows = await db
    .select({
      slug: tags.name,
      count: sql<number>`count(${promptTags.promptId})`,
    })
    .from(promptModels)
    .innerJoin(models, eq(promptModels.modelId, models.id))
    .innerJoin(promptTags, eq(promptTags.promptId, promptModels.promptId))
    .innerJoin(tags, eq(promptTags.tagId, tags.id))
    .innerJoin(prompts, and(eq(prompts.id, promptModels.promptId), eq(prompts.isDraft, 0)))
    .where(eq(models.slug, modelSlug))
    .groupBy(tags.name)
    .orderBy(desc(sql`count(${promptTags.promptId})`), tags.name);

  // name 取 yaml 真源（data/tags.yaml 默认英文）
  return rows.map((r) => ({ slug: r.slug, name: TAGS_DICT[r.slug]?.en ?? r.slug, count: Number(r.count) }));
}

export async function listModelTagDistribution(
  modelSlug: string,
): Promise<{ slug: string; name: string; count: number }[]> {
  // R2 聚合缓存：model-tags.json 存所有 model 的 tag 分布（发布时全量重算覆盖写）
  const cached = await readAggregateCache<Record<string, { slug: string; name: string; count: number }[]>>(
    AGG_CACHE_KEYS.modelTags,
  );
  if (cached && cached[modelSlug]) return cached[modelSlug];

  // 兜底：缓存不存在（首次部署）→ 实时查询
  return queryModelTagDistribution(modelSlug);
}

/**
 * 单条 prompt 查询（按 slug）— 跨实例缓存版本
 *
 * 背景（2026-08-07 Error 1102 修复）：
 *   - 详情页 ISR 渲染时，generateMetadata 调一次 getPromptBySlug，
 *     default handler 再调一次（拉相关推荐前需要 prompt 详情），共 2 次 D1 round-trip
 *   - 加 slug 维度跨实例缓存后，两次调用只查 1 次 D1
 *   - publish/unpublish/delete 时主动失效对应 slug 的缓存
 *
 * 注意：cache key 包含 slug，按 slug 失效；同一个 prompt 在不同 ISR 渲染间复用缓存
 */
export async function getPromptBySlugCached(slug: string): Promise<PromptCardData | null> {
  return getCachedData(`${CACHE_KEYS.promptBySlug}-${slug}`, async () => {
    return getPromptBySlug(slug);
  });
}

/**
 * 全量重建 R2 聚合缓存 — 发布/删除/下架后调用
 *
 * 背景（2026-08-07 CPU 超时优化）：
 *   - listAllTags / listAllModels / listModelTagDistribution / listPrompts 的 count
 *     改为读 R2 中间文件（_cache/*.json），不再实时全表扫描
 *   - 这些聚合的输入只在发布时变化，而发布是人工低频操作
 *   - 本函数在发布/删除/下架时全量重算一次，覆盖写 R2，保证读端永远新鲜
 *
 * 注意：本函数会执行全表聚合（读 33M / 12M 行），但只在低频写操作时调用，
 *       慢几百 ms 完全无感。读端（listAllTags 等）不再触发全表扫描。
 */
export async function rebuildAllAggregateCaches(): Promise<void> {
  // 必须走实时查询（query* 内部函数），不能走 listAll*（会读 R2 旧缓存）
  // counts.total 必须直接从 prompts 表 count 真实行数，不能用 sum(tag counts)：
  //   - 一个 prompt 通常挂多个 tag，tag counts 加总会把同一个 prompt 算 N 次
  //   - 历史上用 sum 算出的 total 比真实值大 N 倍（典型 ~4-5×），参见
  //     2026-08-07 Header "Collected N prompts" 统计口径 bug
  const [tags, models, totalRow] = await Promise.all([
    queryAllTags(),
    queryAllModels(),
    (async () => {
      const d1 = await getD1();
      const db = getDb(d1);
      const r = await db
        .select({ c: sql<number>`count(*)` })
        .from(prompts)
        .where(eq(prompts.isDraft, 0));
      return Number(r[0]?.c ?? 0);
    })(),
  ]);

  // counts.json：total（真实 published prompt 数） + 各 tag/model 的 count
  const counts: CountsCache = {
    total: totalRow,
    tags: Object.fromEntries(tags.map((t) => [t.slug, t.count])),
    models: Object.fromEntries(models.map((m) => [m.slug, m.count])),
  };
  await writeAggregateCache(AGG_CACHE_KEYS.counts, counts);

  // model-tags.json：所有 model 的 tag 分布（一个文件全量）
  const modelTags: Record<string, { slug: string; name: string; count: number }[]> = {};
  for (const m of models) {
    modelTags[m.slug] = await queryModelTagDistribution(m.slug);
  }
  await writeAggregateCache(AGG_CACHE_KEYS.modelTags, modelTags);
}

/**
 * 详情页上下篇 — 按 id 单调排序，仅取 3 个导航字段
 *
 * 背景（2026-08-07 Error 1102 修复 Phase 2）：
 *   - 之前：listRecentPromptsCached(48) → in-memory findIndex by promptDate
 *     → 每次详情页 SSR 拉 48 行 + hydrate 48 份 tags/models（最大头）
 *   - 现在：3 次轻量 D1 查询（id + prev + next），不 hydrate，仅 3 个字段
 *   - id 是 auto-increment 单调，与 promptDate 同向；用 id 排序更稳定（不依赖 ISO 8601 字符串比较）
 *
 * 返回：prev/next 可能为 null（详情页已是最新/最旧时）
 */
export interface AdjacentPrompt {
  slug: string;
  title: string;
  coverUrl: string | null;
}

export async function getAdjacentPrompts(
  slug: string,
): Promise<{ prev: AdjacentPrompt | null; next: AdjacentPrompt | null }> {
  const d1 = await getD1();
  const db = getDb(d1);

  // 1) 查 target id（只 select id，极轻量）
  const targetRows = await db
    .select({ id: prompts.id })
    .from(prompts)
    .where(and(eq(prompts.slug, slug), eq(prompts.isDraft, 0)))
    .limit(1);

  if (targetRows.length === 0) return { prev: null, next: null };
  const targetId = targetRows[0].id;

  // 2) 并发查 prev/next，各 1 行，仅 select 导航字段
  const [prevRows, nextRows] = await Promise.all([
    db
      .select({ slug: prompts.slug, title: prompts.title, coverUrl: prompts.coverUrl })
      .from(prompts)
      .where(and(ne(prompts.id, targetId), eq(prompts.isDraft, 0), lt(prompts.id, targetId)))
      .orderBy(desc(prompts.id))
      .limit(1),
    db
      .select({ slug: prompts.slug, title: prompts.title, coverUrl: prompts.coverUrl })
      .from(prompts)
      .where(and(ne(prompts.id, targetId), eq(prompts.isDraft, 0), gt(prompts.id, targetId)))
      .orderBy(prompts.id)
      .limit(1),
  ]);

  return {
    prev: prevRows[0] ?? null,
    next: nextRows[0] ?? null,
  };
}

/**
 * 详情页相关推荐 — 按共享 tag/model 打分取 top N
 *
 * 背景（2026-08-07 Error 1102 修复 Phase 2）：
 *   - 之前：listRecentPromptsCached(48) → in-memory 全量 hydrate + 过滤打分
 *     → 每次详情页 SSR hydrate 48 份 tags/models（最大头）
 *   - 现在：只取共享 tag/model 的候选集合（远 < 48）→ hydrate 候选 → JS 打分取 6
 *   - 极端情况（共享 tag/model 很少）：返回空数组，UI 只隐藏 "You Might Also Like"
 *
 * 打分规则（同原实现）：
 *   - 共享 model：+10/个
 *   - 共享 tag：+2/个
 *   - 排序：分数 DESC，再 promptDate DESC
 */
export async function getRelatedPrompts(
  sourcePrompt: PromptCardData,
  limit: number = 6,
): Promise<PromptCardData[]> {
  const tagNames = sourcePrompt.tags.map((t) => t.slug);
  const modelSlugs = sourcePrompt.models.map((m) => m.slug);
  if (tagNames.length === 0 && modelSlugs.length === 0) return [];

  const d1 = await getD1();
  const db = getDb(d1);

  // 1) 找共享 tag / model 的 promptId 集合（去重）
  //    两个独立 query 并发；为空时跳过对应 query
  const tagIdsPromise: Promise<Array<{ id: number }>> = tagNames.length > 0
    ? db
        .select({ id: promptTags.promptId })
        .from(promptTags)
        .innerJoin(tags, eq(promptTags.tagId, tags.id))
        .where(inArray(tags.name, tagNames))
    : Promise.resolve([]);

  const modelIdsPromise: Promise<Array<{ id: number }>> = modelSlugs.length > 0
    ? db
        .select({ id: promptModels.promptId })
        .from(promptModels)
        .innerJoin(models, eq(promptModels.modelId, models.id))
        .where(inArray(models.slug, modelSlugs))
    : Promise.resolve([]);

  const [tagRows, modelRows] = await Promise.all([tagIdsPromise, modelIdsPromise]);
  const candidateIds = new Set<number>();
  for (const r of tagRows) candidateIds.add(r.id);
  for (const r of modelRows) candidateIds.add(r.id);
  if (candidateIds.size === 0) return [];

  // 2) 取候选的卡片字段（排除自己，限制 30 避免 hydrate 过量）
  const CANDIDATE_CAP = 30;
  const candidateIdArr = Array.from(candidateIds);

  // D1 单 query 的 SQL variables 上限实测 ~461。
  // 热门 tag/model（cinematic/realistic/multi-shot/drama/happyhorse 等）单条 prompt
  // 共享的候选集实测 3000+（如 2085641595437912197-maya-award-press-wall-confrontation = 3354），
  // 单条 inArray 直塞会爆 → 必须分批。
  // 修法（2026-08-08 修复）：CHUNK=50 保守值（实测 100 也炸，故减半），不分批 LIMIT，
  // 全部取回后在 JS 端 dedupe + 排序裁剪到 CANDIDATE_CAP。
  // 并发：CONCURRENCY=6 控制 D1 连接池（与 getAdjacentPrompts 并行的 3 query 一起也在同一池里）。
  const CHUNK = 50;
  const CONCURRENCY = 6;
  const chunks: number[][] = [];
  for (let i = 0; i < candidateIdArr.length; i += CHUNK) {
    chunks.push(candidateIdArr.slice(i, i + CHUNK));
  }
  const candidateRows: Array<typeof prompts.$inferSelect> = [];
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((idChunk) =>
        db
          .select()
          .from(prompts)
          .where(
            and(
              inArray(prompts.id, idChunk),
              eq(prompts.isDraft, 0),
              ne(prompts.slug, sourcePrompt.slug),
            ),
          )
          .orderBy(desc(prompts.promptDate), desc(prompts.id)),
      ),
    );
    for (const r of batchResults) candidateRows.push(...r);
  }

  if (candidateRows.length === 0) return [];

  // dedupe by id（一个 prompt 可能因多 tag 重复进候选）+ 按 prompt_date DESC 裁剪
  // 3354 候选 → 1.6MB JSON，D1 完全能扛；JS 端 sort 3354 项也是 ms 级
  const rows = Array.from(new Map(candidateRows.map((r) => [r.id, r])).values())
    .sort(
      (a, b) =>
        (b.promptDate ?? '').localeCompare(a.promptDate ?? '') || b.id - a.id,
    )
    .slice(0, CANDIDATE_CAP);

  // 3) hydrate 候选（行数 ≤ 30，最多 1 chunk，2 次 D1 round-trip）
  const hydrated = await hydratePrompts(rows);

  // 4) JS 端按相关性打分
  const sourceTagSlugs = new Set(tagNames);
  const sourceModelSlugs = new Set(modelSlugs);
  const scored = hydrated
    .map((p) => {
      let score = 0;
      if (p.models.some((m) => sourceModelSlugs.has(m.slug))) score += 10;
      const overlap = p.tags.reduce(
        (n, t) => (sourceTagSlugs.has(t.slug) ? n + 1 : n),
        0,
      );
      score += overlap * 2;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.p.promptDate ?? '').localeCompare(a.p.promptDate ?? ''),
    )
    .slice(0, limit)
    .map((x) => x.p);

  return scored;
}
