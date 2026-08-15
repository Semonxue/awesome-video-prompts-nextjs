/**
 * 跨实例缓存工具 — 解决 Worker 实例频繁回收导致模块级缓存失效的问题
 *
 * 背景（2026-08-07 线上慢查询优化）：
 *   - listAllTags / listAllModels 是全表 JOIN + GROUP BY 聚合（读 1B / 250M 行）
 *   - 原实现只有模块级缓存（Worker 实例内），但线上 13492 次调用说明
 *     Worker 实例被频繁回收，模块级缓存形同虚设，每次新实例都重算全表聚合
 *   - 本模块提供两层缓存：
 *       L1: 模块级内存（最快，同实例内命中）
 *       L2: Cloudflare Cache API（跨实例共享，Worker 回收后仍命中）
 *   - tags/models 数据只在发布 prompt 时变化，TTL 5 分钟完全合理
 *   - publish 时调用 invalidateCache() 主动失效，保证发布后立即可见
 *
 * 兼容性：
 *   - 本地 dev（非 Workers 环境）无 caches API → 自动降级为纯模块级缓存
 *   - Cache API 的 key 是 Request 对象，这里用固定 URL 构造
 */

const L1_TTL_MS = 5 * 60 * 1000; // 模块级内存 TTL
const L2_TTL_S = 300; // Cache API TTL（秒），与 L1 一致

interface L1Entry<T> {
  value: T;
  expiresAt: number;
}

// L1 内存缓存（按 key 存）
const l1Cache = new Map<string, L1Entry<unknown>>();

/** 构造 Cache API 的 Request key（固定 URL，不实际请求） */
function cacheKey(key: string): Request {
  return new Request(`https://internal-cache.local/${key}`);
}

/** 尝试拿 Cache API（非 Workers 环境返回 null） */
function getCacheApi(): Cache | null {
  try {
    // caches 是 Workers 全局；本地 Node 环境不存在
    // Workers 运行时 caches.default 存在，但 TS 类型 CacheStorage 未声明 default，需断言
    if (typeof caches === 'undefined') return null;
    return (caches as unknown as { default: Cache }).default;
  } catch {
    return null;
  }
}

/**
 * 读取缓存：L1 内存 → L2 Cache API → 未命中返回 null
 */
async function readCache<T>(key: string): Promise<T | null> {
  // L1 内存
  const l1 = l1Cache.get(key);
  if (l1 && l1.expiresAt > Date.now()) {
    return l1.value as T;
  }
  if (l1) l1Cache.delete(key); // 过期清理

  // L2 Cache API
  const cache = getCacheApi();
  if (cache) {
    try {
      const res = await cache.match(cacheKey(key));
      if (res && res.ok) {
        const value = (await res.json()) as T;
        // 回填 L1
        l1Cache.set(key, { value, expiresAt: Date.now() + L1_TTL_MS });
        return value;
      }
    } catch {
      // Cache API 异常降级，忽略
    }
  }
  return null;
}

/**
 * 写入缓存：L2 Cache API + L1 内存
 */
async function writeCache<T>(key: string, value: T): Promise<void> {
  // L1
  l1Cache.set(key, { value, expiresAt: Date.now() + L1_TTL_MS });

  // L2
  const cache = getCacheApi();
  if (cache) {
    try {
      const res = new Response(JSON.stringify(value), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${L2_TTL_S}`,
        },
      });
      await cache.put(cacheKey(key), res);
    } catch {
      // 忽略
    }
  }
}

/**
 * 主动失效缓存（publish 后调用，保证立即可见）
 */
export async function invalidateCache(key: string): Promise<void> {
  l1Cache.delete(key);
  const cache = getCacheApi();
  if (cache) {
    try {
      await cache.delete(cacheKey(key));
    } catch {
      // 忽略
    }
  }
}

// Single-flight 表：同一 key 的并发请求共享同一个 Promise
// 背景（2026-08-07 Error 1102 修复）：ISR 失效瞬间可能 N 个并发 cache miss，
// 之前每个并发都各自 fetch → N 倍 D1 查询 → CPU 超限。single-flight 后 N 个并发
// 只触发 1 次 fetcher，其他等待同一个 Promise。
const inflightPromises = new Map<string, Promise<unknown>>();

/**
 * 通用缓存读取：命中返回缓存值，未命中调用 fetcher 并写入缓存
 * 包含 single-flight：同 key 并发请求共享同一个 in-flight Promise
 */
export async function getCachedData<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = await readCache<T>(key);
  if (cached !== null) return cached;

  // 检查是否已有同 key 的 in-flight 请求
  const existing = inflightPromises.get(key);
  if (existing) return existing as Promise<T>;

  // 创建新的 in-flight Promise
  const promise = (async () => {
    try {
      const value = await fetcher();
      await writeCache(key, value);
      return value;
    } finally {
      inflightPromises.delete(key);
    }
  })();

  inflightPromises.set(key, promise);
  return promise;
}

/** 缓存 key 常量 */
export const CACHE_KEYS = {
  recentPrompts: 'recent-prompts-48',
  /** 单条 prompt（key 后缀接 slug） */
  promptBySlug: 'prompt-by-slug',
  /** 整个 sitemap 输出（避免每次请求都重新构造 18000+ 对象） */
  sitemapOutput: 'sitemap-output',
} as const;

// ============================================================
// 命名空间版本（namespace version stamp）
// ============================================================
// 背景：getRelatedPrompts / getAdjacentPrompts 的结果依赖"全表 prompts 当前状态"，
//       任何一次 publish/unpublish/delete 都可能让任意 slug 的相关/上下篇结果变化。
//       但 Cache API 没有"按前缀批量失效"能力，逐个失效 O(N) 不可能（N = 全部 slug）。
//
// 方案：用 namespace version stamp 把"全表当前状态"编码进 cache key：
//       key = `related-prompts-v${VERSION}-${slug}-${limit}`
//       - VERSION 是个独立 L1+L2 缓存的计数器
//       - 任何 publish/unpublish/delete 调用 bumpNamespaceVersion() 把 VERSION 写为 +1
//       - 旧 VERSION 下的所有 cache entry 自动变成不可达 → 5min TTL 后 GC
//       - 新读请求用新 VERSION 走 getCachedData 重新计算
//
// 与 invalidateCache(单 key) 的区别：本机制用 key 变化实现"全清"，无需遍历
// ============================================================

/** namespace version 的 L1/L2 key */
const NAMESPACE_VERSION_KEYS = {
  related: 'ns-version:related-prompts',
  adjacent: 'ns-version:adjacent-prompts',
} as const;

export type CacheNamespace = keyof typeof NAMESPACE_VERSION_KEYS;

/** 读当前 namespace version（缺省返回 1） */
async function readNamespaceVersion(ns: CacheNamespace): Promise<number> {
  const v = await getCachedData<number>(NAMESPACE_VERSION_KEYS[ns], async () => 1);
  return v ?? 1;
}

/**
 * 写一个比当前大 1 的新 version（直接覆盖 L1 + L2，不走 read-modify-write）
 *
 * 注意：必须用直接 writeCache，不能用 invalidateCache —— 后者会让读端回到 1，
 *       无法表达"已 bump"。
 */
async function writeNamespaceVersion(ns: CacheNamespace, newVersion: number): Promise<void> {
  l1Cache.set(NAMESPACE_VERSION_KEYS[ns], { value: newVersion, expiresAt: Date.now() + L1_TTL_MS });
  const cache = getCacheApi();
  if (cache) {
    try {
      const res = new Response(JSON.stringify(newVersion), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${L2_TTL_S}`,
        },
      });
      await cache.put(cacheKey(NAMESPACE_VERSION_KEYS[ns]), res);
    } catch {
      // 忽略
    }
  }
}

/**
 * 发布/删除/下架时调用：让所有 related/adjacent cache 立刻失效（语义上）。
 *
 * 实现：把 namespace version +1 → 所有旧 cache key 不可达 → 下次读走新 version 重新计算。
 * 旧 key 保留在 L2 但 5min TTL 后自然 GC，无需遍历清理。
 */
export async function bumpNamespaceVersion(ns: CacheNamespace): Promise<void> {
  const current = await readNamespaceVersion(ns);
  await writeNamespaceVersion(ns, current + 1);
}

/**
 * 通用：读 namespace 下的 cache data（自动嵌入当前 version）
 *
 * 与 getCachedData 的区别：key 嵌入了 namespace version，
 *       publish/unpublish/delete 后版本变化 → 自动 miss 旧 entry
 */
export async function getNamespacedCachedData<T>(
  ns: CacheNamespace,
  suffixKey: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const version = await readNamespaceVersion(ns);
  return getCachedData<T>(`${ns}-v${version}-${suffixKey}`, fetcher);
}
