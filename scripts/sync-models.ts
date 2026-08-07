#!/usr/bin/env tsx
/**
 * sync-models.ts — 部署时校准脚本（models + tags 双字典）
 *
 * 背景：
 *   data/models.yaml 和 data/tags.yaml 是字典的唯一真源。
 *   线上 D1 models/tags 表可能因历史导入/手动改动与 data 不一致。
 *   本脚本在 deploy 时（deploy.sh Step 5b）执行，把线上 D1 models/tags
 *   校准到与 data/*.yaml 完全一致：
 *     - 新增：data 有、线上没有 → INSERT
 *     - 更新（仅 models）：两边都有但 name 不同 → UPDATE name
 *     - 删除：线上有、data 没有 → 先删 prompt_models / prompt_tags 关联，再 DELETE
 *
 * 用法（从项目根）：
 *   # 试运行（只打印 diff，不写库）
 *   npx tsx scripts/sync-models.ts --dry-run
 *
 *   # 实际校准（需要 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / D1_DATABASE_ID）
 *   npx tsx scripts/sync-models.ts
 *
 *   # 只校 models 或 tags（调试用）
 *   npx tsx scripts/sync-models.ts --kind=models
 *   npx tsx scripts/sync-models.ts --kind=tags
 *
 * 说明：
 *   - 通过 D1 HTTP API 读写（与 import-md-to-d1.ts 一致）
 *   - 幂等：可重复执行，无 diff 时不做任何写操作
 *   - 与 src/lib/dict-sync.ts 是同一套算法（publish route 同步 + deploy 二次保险）
 *
 * 注：文件名保留 sync-models.ts 是为了不破坏 deploy.sh 调用；
 *     内容已扩展为 models + tags 双字典同步。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const MODELS_YAML = path.join(ROOT, 'data', 'models.yaml');
const TAGS_YAML = path.join(ROOT, 'data', 'tags.yaml');

const { values: args } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    kind: { type: 'string', default: 'all' }, // all | models | tags
  },
  allowPositionals: false,
});

const DRY_RUN = args['dry-run'] === true;
const KIND = (args.kind ?? 'all') as 'all' | 'models' | 'tags';
if (!['all', 'models', 'tags'].includes(KIND)) {
  throw new Error(`Invalid --kind: ${KIND}（期望 all | models | tags）`);
}

// ============================================================
// 解析 data/models.yaml（轻量解析，不引入 yaml 依赖）
// ============================================================

function parseModelsYaml(filePath: string): Map<string, string> {
  const raw = fs.readFileSync(filePath, 'utf8');
  const models = new Map<string, string>();
  let currentSlug: string | null = null;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // 顶层 slug（无缩进，以 ":" 结尾）
    const slugMatch = line.match(/^([a-zA-Z0-9._-]+):\s*$/);
    if (slugMatch) {
      currentSlug = slugMatch[1];
      continue;
    }

    // 缩进的 name 字段
    const nameMatch = line.match(/^\s+name:\s*(.+?)\s*$/);
    if (nameMatch && currentSlug) {
      models.set(currentSlug, nameMatch[1]);
      currentSlug = null; // 一个 slug 只取一个 name
    }
  }

  return models;
}

// ============================================================
// 解析 data/tags.yaml（顶层 slug，不需要 name 字段；多语言翻译是 UI 层的事）
// ============================================================

function parseTagsYaml(filePath: string): Set<string> {
  const raw = fs.readFileSync(filePath, 'utf8');
  const tags = new Set<string>();
  let currentSlug: string | null = null;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // 顶层 slug（无缩进，以 ":" 结尾）
    const slugMatch = line.match(/^([a-zA-Z0-9._-]+):\s*$/);
    if (slugMatch) {
      // tags.yaml 顶层可能是 slug 也可能是其他字段（如 en:）—— 简单按 slug 形态判
      const slug = slugMatch[1];
      // 排除明显是子属性的伪命中（如 en: zh-cn: description_en:）
      if (['en', 'zh-cn', 'ja', 'description_en', 'description_zh-cn'].includes(slug)) {
        currentSlug = null;
        continue;
      }
      currentSlug = slug;
      tags.add(slug);
      continue;
    }

    // 缩进的属性行（如 `  en: dreamy`）— 不影响 slug 集合，但需要清 currentSlug
    // 让下一次裸 slug 行被识别为新顶层
    if (line.match(/^\s+[a-zA-Z_-]+:\s*.+/)) {
      // 子属性行，currentSlug 保持不变（已经 add 进 Set）
    }
  }

  return tags;
}

// ============================================================
// D1 HTTP API
// ============================================================

function getEnv() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID || process.env.D1_DATABASE_ID;

  if (!accountId || !apiToken || !databaseId) {
    throw new Error(
      '需要环境变量: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_D1_DATABASE_ID (或 D1_DATABASE_ID)',
    );
  }
  return { accountId, apiToken, databaseId };
}

async function d1Query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const { accountId, apiToken, databaseId } = getEnv();
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`D1 HTTP API ${res.status}: ${errText.slice(0, 500)}`);
  }

  const json = await res.json() as {
    success: boolean;
    errors?: { message: string }[];
    result?: { results?: Record<string, unknown>[]; success?: boolean }[];
  };

  if (!json.success) {
    const msg = json.errors?.map((e) => e.message).join('; ') ?? 'unknown error';
    throw new Error(`D1 HTTP API returned success=false: ${msg}`);
  }

  return json.result?.[0]?.results ?? [];
}

async function d1Batch(statements: { sql: string; params: unknown[] }[]): Promise<void> {
  const { accountId, apiToken, databaseId } = getEnv();
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ batch: statements }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`D1 HTTP API ${res.status}: ${errText.slice(0, 500)}`);
  }

  const json = await res.json() as { success: boolean; errors?: { message: string }[] };
  if (!json.success) {
    const msg = json.errors?.map((e) => e.message).join('; ') ?? 'unknown error';
    throw new Error(`D1 HTTP API returned success=false: ${msg}`);
  }
}

// ============================================================
// Models 校准（与 scripts 原逻辑一致）
// ============================================================

interface ModelsDiff {
  toInsert: { slug: string; name: string }[];
  toUpdate: { slug: string; oldName: string; newName: string }[];
  toDelete: { slug: string; name: string }[];
}

function computeModelsDiff(local: Map<string, string>, remote: Map<string, string>): ModelsDiff {
  const toInsert: ModelsDiff['toInsert'] = [];
  const toUpdate: ModelsDiff['toUpdate'] = [];
  const toDelete: ModelsDiff['toDelete'] = [];

  for (const [slug, name] of local) {
    const remoteName = remote.get(slug);
    if (remoteName === undefined) {
      toInsert.push({ slug, name });
    } else if (remoteName !== name) {
      toUpdate.push({ slug, oldName: remoteName, newName: name });
    }
  }

  for (const [slug, name] of remote) {
    if (!local.has(slug)) {
      toDelete.push({ slug, name });
    }
  }

  return { toInsert, toUpdate, toDelete };
}

async function syncModels(): Promise<{ changed: number }> {
  const local = parseModelsYaml(MODELS_YAML);
  console.log(`📄 data/models.yaml: ${local.size} 个模型`);

  const remoteRows = await d1Query('SELECT slug, name FROM models');
  const remote = new Map<string, string>();
  for (const row of remoteRows) {
    remote.set(String(row.slug), String(row.name));
  }
  console.log(`🗄️  线上 D1 models: ${remote.size} 个模型`);

  const diff = computeModelsDiff(local, remote);
  console.log(
    `\n📊 models 差异: 新增 ${diff.toInsert.length} · 更新 ${diff.toUpdate.length} · 删除 ${diff.toDelete.length}`,
  );

  if (diff.toInsert.length === 0 && diff.toUpdate.length === 0 && diff.toDelete.length === 0) {
    console.log('✅ models 已与 data/models.yaml 一致');
    return { changed: 0 };
  }

  for (const m of diff.toInsert) console.log(`   ➕ 新增  ${m.slug} → ${m.name}`);
  for (const m of diff.toUpdate) console.log(`   ✏️  更新  ${m.slug}: ${m.oldName} → ${m.newName}`);
  for (const m of diff.toDelete) console.log(`   🗑️  删除  ${m.slug} (${m.name})`);

  if (DRY_RUN) {
    console.log('🔍 DRY-RUN，未写入');
    return { changed: diff.toInsert.length + diff.toUpdate.length + diff.toDelete.length };
  }

  const statements: { sql: string; params: unknown[] }[] = [];
  for (const m of diff.toInsert) {
    statements.push({ sql: 'INSERT INTO models (slug, name) VALUES (?, ?)', params: [m.slug, m.name] });
  }
  for (const m of diff.toUpdate) {
    statements.push({ sql: 'UPDATE models SET name = ? WHERE slug = ?', params: [m.newName, m.slug] });
  }
  for (const m of diff.toDelete) {
    statements.push({
      sql: 'DELETE FROM prompt_models WHERE model_id IN (SELECT id FROM models WHERE slug = ?)',
      params: [m.slug],
    });
    statements.push({ sql: 'DELETE FROM models WHERE slug = ?', params: [m.slug] });
  }

  // 分批执行（每批 100 条）
  const BATCH = 100;
  for (let i = 0; i < statements.length; i += BATCH) {
    const chunk = statements.slice(i, i + BATCH);
    await d1Batch(chunk);
  }

  console.log(`✅ models 校准完成，共执行 ${statements.length} 条 SQL`);
  return { changed: statements.length };
}

// ============================================================
// Tags 校准（与 src/lib/dict-sync.ts 一致）
// ============================================================

interface TagsDiff {
  toInsert: string[];
  toDelete: { slug: string }[];
}

function computeTagsDiff(local: Set<string>, remote: Set<string>): TagsDiff {
  const toInsert: string[] = [];
  const toDelete: TagsDiff['toDelete'] = [];

  for (const slug of local) {
    if (!remote.has(slug)) toInsert.push(slug);
  }
  for (const slug of remote) {
    if (!local.has(slug)) toDelete.push({ slug });
  }

  return { toInsert, toDelete };
}

async function syncTags(): Promise<{ changed: number }> {
  const local = parseTagsYaml(TAGS_YAML);
  console.log(`📄 data/tags.yaml: ${local.size} 个 tag slug`);

  const remoteRows = await d1Query('SELECT name FROM tags');
  const remote = new Set<string>();
  for (const row of remoteRows) {
    remote.add(String(row.name));
  }
  console.log(`🗄️  线上 D1 tags: ${remote.size} 个 tag`);

  const diff = computeTagsDiff(local, remote);
  console.log(`\n📊 tags 差异: 新增 ${diff.toInsert.length} · 删除 ${diff.toDelete.length}`);

  if (diff.toInsert.length === 0 && diff.toDelete.length === 0) {
    console.log('✅ tags 已与 data/tags.yaml 一致');
    return { changed: 0 };
  }

  for (const t of diff.toInsert) console.log(`   ➕ 新增  ${t}`);
  for (const t of diff.toDelete) console.log(`   🗑️  删除  ${t.slug}`);

  if (DRY_RUN) {
    console.log('🔍 DRY-RUN，未写入');
    return { changed: diff.toInsert.length + diff.toDelete.length };
  }

  const statements: { sql: string; params: unknown[] }[] = [];
  for (const slug of diff.toInsert) {
    statements.push({ sql: 'INSERT OR IGNORE INTO tags (name) VALUES (?)', params: [slug] });
  }
  for (const t of diff.toDelete) {
    statements.push({
      sql: 'DELETE FROM prompt_tags WHERE tag_id IN (SELECT id FROM tags WHERE name = ?)',
      params: [t.slug],
    });
    statements.push({ sql: 'DELETE FROM tags WHERE name = ?', params: [t.slug] });
  }

  const BATCH = 100;
  for (let i = 0; i < statements.length; i += BATCH) {
    const chunk = statements.slice(i, i + BATCH);
    await d1Batch(chunk);
  }

  console.log(`✅ tags 校准完成，共执行 ${statements.length} 条 SQL`);
  return { changed: statements.length };
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🔧 字典校准 (data/*.yaml → D1)');
  console.log(`   mode: kind=${KIND}  dry-run=${DRY_RUN}`);
  console.log('═══════════════════════════════════════════════════');

  let totalChanged = 0;

  if (KIND === 'all' || KIND === 'models') {
    const r = await syncModels();
    totalChanged += r.changed;
  }
  if (KIND === 'all' || KIND === 'tags') {
    const r = await syncTags();
    totalChanged += r.changed;
  }

  console.log(`\n${'='.repeat(47)}`);
  if (DRY_RUN) {
    console.log(`🔍 DRY-RUN 完成，预计会改 ${totalChanged} 条`);
  } else {
    console.log(`✅ 字典校准完成，共执行 ${totalChanged} 条 SQL`);
  }
}

main().catch((err) => {
  console.error('\n❌ 字典校准失败:', err.message ?? err);
  process.exit(1);
});