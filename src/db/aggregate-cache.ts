/**
 * R2 聚合缓存工具 — 把全表聚合结果存成 R2 中间文件
 *
 * 背景（2026-08-07 CPU 超时优化）：
 *   - listAllTags / listAllModels / listModelTagDistribution / listPrompts 的 count
 *     都是全表 JOIN + GROUP BY 聚合（读 33M / 12M / 8M 行），是 CPU 超时主因
 *   - 这些聚合的输入只在发布时变化，而发布是人工低频操作
 *   - 方案：发布/删除/下架时全量重算一次，序列化 JSON 覆盖写 R2（_cache/ 前缀）
 *     查询端直接读 R2 对象（被 CF CDN 缓存，读几乎零成本），不再实时全表扫描
 *   - 相比 D1 物化表：不改 DB 结构、无增量维护边界、零新增资源（复用现有 MEDIA bucket）
 *
 * 本模块只提供 R2 读写工具，不依赖 queries.ts（避免循环依赖）。
 * 全量重算逻辑在 queries.ts 的 rebuildAllAggregateCaches()。
 */

import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getCachedData, invalidateCache } from './cache';

/** R2 聚合缓存 key（_cache/ 前缀，与媒体 prompts/ 前缀隔离） */
export const AGG_CACHE_KEYS = {
  /** listAllTags 结果 */
  tags: '_cache/tags.json',
  /** listAllModels 结果 */
  models: '_cache/models.json',
  /** 所有 model 的 tag 分布（一个文件全量） */
  modelTags: '_cache/model-tags.json',
  /** 各筛选维度 count（total / tags / models） */
  counts: '_cache/counts.json',
  /**
   * Related prompts 预计算（2026-08-18 D1 cost 静态化）
   * slug → 6 个 related slug（按共享 tag/model 打分，已排序）
   */
  relatedMap: '_cache/related-map.json',
  /**
   * Adjacent prompts 预计算（2026-08-18 D1 cost 静态化）
   * slug → { prev: {slug,title,coverUrl} | null, next: {slug,title,coverUrl} | null }
   */
  adjacentMap: '_cache/adjacent-map.json',
} as const;

/** counts.json 结构 */
export interface CountsCache {
  /** 总 published prompt 数 */
  total: number;
  /** tag name -> count */
  tags: Record<string, number>;
  /** model slug -> count */
  models: Record<string, number>;
}

/** adjacent-map.json 的 prev/next 条目（仅 3 个导航字段，不含完整 PromptCardData） */
export interface AdjacentEntry {
  slug: string;
  title: string;
  coverUrl: string | null;
}

/** adjacent-map.json 结构 */
export interface AdjacentMapCache {
  [slug: string]: { prev: AdjacentEntry | null; next: AdjacentEntry | null };
}

/** related-map.json 结构：slug → 6 个 related slug */
export interface RelatedMapCache {
  [slug: string]: string[];
}

/** R2 binding 类型（来自 CloudflareEnv，与 admin 路由一致，避免全局 R2Bucket 类型冲突） */
type R2 = NonNullable<CloudflareEnv['MEDIA']>;

/** 获取 R2 binding（OpenNext 注入 env.MEDIA） */
async function getR2(): Promise<R2> {
  const ctx = await getCloudflareContext({ async: true });
  const r2 = ctx.env.MEDIA;
  if (!r2) throw new Error('R2 binding (env.MEDIA) not found in Cloudflare context');
  return r2;
}

/**
 * 读聚合缓存。文件不存在或解析失败返回 null（调用方回退实时查询）。
 * 任何异常都降级为 null，不阻断主流程。
 *
 * 性能（2026-08-07 Error 1102 修复 Phase 2 / A2）：
 *   复用 cache.ts 的 L1 内存 + L2 Cache API + single-flight，免去同实例内重复 R2 读 + JSON.parse。
 *   - L1 命中：~0 开销（内存 Map）
 *   - L2 命中：~1ms（Cache API deserialize JSON 后回填 L1）
 *   - R2 miss：fallback 走兜底查询，写入后调用方须 invalidateCache 清掉这个 null，否则后续 5min 不读 R2
 *
 * 注意：R2 miss 会把 null 写入 L1+L2（避免读端反复打 R2 确认不存在）。
 *       列表页调用方（listAllTags/Models）的兑底 queryAll* 写 R2 后会 invalidateCache 清这个 null。
 */
export async function readAggregateCache<T>(key: string): Promise<T | null> {
  return getCachedData<T | null>(key, async () => {
    try {
      const r2 = await getR2();
      const obj = await r2.get(key);
      if (!obj) return null;
      const text = await obj.text();
      if (!text) return null;
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  });
}

/**
 * 主动失效某个聚合缓存的 L1 + L2（适用于：兜底查询后 R2 已有新值）
 *
 * 例如：listAllTags R2 miss → queryAllTags() → writeAggregateCache(...) → 
 *      invalidateAggregateCache(_cache/tags.json) → 下次 readAggregateCache 重新走 R2 拿真值。
 */
export async function invalidateAggregateCache(key: string): Promise<void> {
  await invalidateCache(key);
}

/**
 * 写聚合缓存（覆盖语义，幂等）。失败仅告警，不抛出（发布流程不应被缓存写失败阻断）。
 */
export async function writeAggregateCache(key: string, value: unknown): Promise<void> {
  try {
    const r2 = await getR2();
    await r2.put(key, JSON.stringify(value), {
      httpMetadata: { contentType: 'application/json' },
    });
  } catch (e) {
    console.warn(`[aggregate-cache] write failed for ${key}:`, e);
  }
}