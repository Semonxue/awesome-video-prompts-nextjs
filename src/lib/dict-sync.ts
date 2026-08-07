/**
 * dict-sync.ts — 把 src/lib/dict-yaml.ts 解析出的字典与 D1 校准
 *
 * 调用时机：
 *   - publish route 末尾（best-effort，失败 warn 不阻断 publish）
 *   - deploy.sh 通过 scripts/sync-models.ts（含 tags）做部署时二次保险
 *
 * 校准规则（与 scripts/sync-models.ts 完全一致，复用其算法）：
 *   - 新增：data/yaml 有、线上 D1 没有 → INSERT
 *   - 更新：两边都有但 name 不同 → UPDATE name
 *   - 删除：线上 D1 有、data/yaml 没有 → 先删 prompt_models / prompt_tags 关联，再 DELETE
 *
 * 失败策略：
 *   - 函数返回 SyncResult（含 inserted/updated/deleted/error）
 *   - 调用方根据 SyncResult.ok 决定是否 warn 上报
 *   - 内部 batch SQL 单批 100 条（同 sync-models.ts），超出自动分批
 *
 * 注意：
 *   - D1 外键默认不强制，所以删除 model/tag 前必须先清关联表
 *   - 这不是真正的级联删除；sync-models.ts 已经验证这条路径稳定
 */

import { MODELS_DICT, TAGS_DICT } from './dict-yaml';

/** D1 binding 类型（与 publish route 一致） */
type D1 = CloudflareEnv['DB'];
/** Drizzle D1 客户端类型（不强制调用方传入，但允许调用 drizzle 工具） */
type Db = ReturnType<typeof import('@/db').getDb>;

// ============================================================
// 类型
// ============================================================

export interface SyncSummary {
  inserted: number;
  updated: number;
  deleted: number;
}

export interface SyncResult {
  ok: boolean;
  /** 校准摘要（ok=false 时也可能非空，记录已完成的部分） */
  summary: SyncSummary;
  /** 失败时携带的错误 */
  error?: string;
  /** 详细 diff（debug 用） */
  details: Array<
    | { op: 'insert'; kind: 'model' | 'tag'; slug: string; name: string }
    | { op: 'update'; kind: 'model' | 'tag'; slug: string; oldName: string; newName: string }
    | { op: 'delete'; kind: 'model' | 'tag'; slug: string; name: string }
  >;
}

// ============================================================
// 通用：按顺序逐条执行 statements
// ============================================================
//
// 说明：D1PreparedStatement[] 类型与 {sql,params}[] 不兼容（@cloudflare/workers-types
//       的 batch 类型签名只声明了 D1PreparedStatement[]），这里逐条 prepare+bind+run
//       避免类型断言。数据量小（models ~30 / tags ~150），几十 ms 级开销可接受。

async function execStatements(
  d1: D1,
  statements: Array<{ sql: string; params: unknown[] }>,
): Promise<void> {
  for (const stmt of statements) {
    await d1
      .prepare(stmt.sql)
      .bind(...stmt.params)
      .run();
  }
}

// ============================================================
// 拉取线上当前状态（models / tags 各一次全表扫描，数据量小，开销可忽略）
// ============================================================

async function fetchRemoteModels(
  d1: D1,
): Promise<Map<string, string>> {
  const result = await d1
    .prepare('SELECT slug, name FROM models')
    .all<{ slug: string; name: string }>();
  const map = new Map<string, string>();
  for (const row of result.results ?? []) {
    map.set(row.slug, row.name);
  }
  return map;
}

async function fetchRemoteTags(d1: D1): Promise<Set<string>> {
  // tags 表 name 字段就是 slug（schema 设计如此，没有显式 name 翻译字段）
  const result = await d1.prepare('SELECT name FROM tags').all<{ name: string }>();
  const set = new Set<string>();
  for (const row of result.results ?? []) {
    set.add(row.name);
  }
  return set;
}

// ============================================================
// Models 同步
// ============================================================

export async function syncModelsDict(d1: D1, _db?: Db): Promise<SyncResult> {
  try {
    const localEntries = Object.entries(MODELS_DICT); // [slug, { name }]
    const local = new Map<string, string>(localEntries.map(([slug, v]) => [slug, v.name]));
    const remote = await fetchRemoteModels(d1);

    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const details: SyncResult['details'] = [];
    const summary: SyncSummary = { inserted: 0, updated: 0, deleted: 0 };

    // 1) 新增 / 更新（data 有，线上 D1 也有但内容不同）
    for (const [slug, name] of local) {
      const remoteName = remote.get(slug);
      if (remoteName === undefined) {
        statements.push({ sql: 'INSERT INTO models (slug, name) VALUES (?, ?)', params: [slug, name] });
        details.push({ op: 'insert', kind: 'model', slug, name });
        summary.inserted++;
      } else if (remoteName !== name) {
        statements.push({ sql: 'UPDATE models SET name = ? WHERE slug = ?', params: [name, slug] });
        details.push({ op: 'update', kind: 'model', slug, oldName: remoteName, newName: name });
        summary.updated++;
      }
    }

    // 2) 删除（线上有、data 没有）—— 先清 prompt_models 关联
    for (const [slug, name] of remote) {
      if (!local.has(slug)) {
        statements.push({
          sql: 'DELETE FROM prompt_models WHERE model_id IN (SELECT id FROM models WHERE slug = ?)',
          params: [slug],
        });
        statements.push({ sql: 'DELETE FROM models WHERE slug = ?', params: [slug] });
        details.push({ op: 'delete', kind: 'model', slug, name });
        summary.deleted++;
      }
    }

    await execStatements(d1, statements);

    return { ok: true, summary, details };
  } catch (e) {
    return {
      ok: false,
      summary: { inserted: 0, updated: 0, deleted: 0 },
      error: (e as Error).message,
      details: [],
    };
  }
}

// ============================================================
// Tags 同步
// ============================================================

/**
 * Tags 同步说明：
 *   - D1 tags 表的 name 字段 = slug（schema 没有独立显示名字段）
 *   - 所以这里只做"存在性"管理：INSERT OR IGNORE 新增 yaml 中的 slug，DELETE yaml 没有的
 *   - 标签的多语言翻译（en/zh/ja）由前端 src/lib/dict-yaml.ts 的 getTagDisplayName() 提供
 *     （编译期 import 字典，UI 层按 locale 取名；与本同步函数无关）
 */
export async function syncTagsDict(d1: D1, _db?: Db): Promise<SyncResult> {
  try {
    const localSlugs = Object.keys(TAGS_DICT);
    const remote = await fetchRemoteTags(d1);

    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const details: SyncResult['details'] = [];
    const summary: SyncSummary = { inserted: 0, updated: 0, deleted: 0 };

    // 1) 新增
    for (const slug of localSlugs) {
      if (!remote.has(slug)) {
        statements.push({ sql: 'INSERT OR IGNORE INTO tags (name) VALUES (?)', params: [slug] });
        details.push({ op: 'insert', kind: 'tag', slug, name: slug });
        summary.inserted++;
      }
    }

    // 2) 删除（先清 prompt_tags 关联）
    for (const slug of remote) {
      if (!localSlugs.includes(slug)) {
        statements.push({
          sql: 'DELETE FROM prompt_tags WHERE tag_id IN (SELECT id FROM tags WHERE name = ?)',
          params: [slug],
        });
        statements.push({ sql: 'DELETE FROM tags WHERE name = ?', params: [slug] });
        details.push({ op: 'delete', kind: 'tag', slug, name: slug });
        summary.deleted++;
      }
    }

    // tags 没有 update（name == slug，本身就是主键的一部分含义）
    // 如果未来 schema 加了显示名字段，update 分支可在此补
    await execStatements(d1, statements);

    return { ok: true, summary, details };
  } catch (e) {
    return {
      ok: false,
      summary: { inserted: 0, updated: 0, deleted: 0 },
      error: (e as Error).message,
      details: [],
    };
  }
}

// ============================================================
// 组合入口：一次跑完 models + tags
// ============================================================

export interface DictSyncCombined {
  models: SyncResult;
  tags: SyncResult;
}

export async function syncAllDicts(d1: D1, db?: Db): Promise<DictSyncCombined> {
  // 顺序执行（同一 D1 batch 串行更稳；数据量小，几十 ms 级）
  const models = await syncModelsDict(d1, db);
  const tags = await syncTagsDict(d1, db);
  return { models, tags };
}