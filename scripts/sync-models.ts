#!/usr/bin/env tsx
/**
 * sync-models.ts — 以 data/models.yaml 为准，校准线上 D1 models 表
 *
 * 背景：
 *   data/models.yaml 是模型字典的唯一真源（slug → name）。
 *   线上 D1 models 表（slug, name）可能因历史导入/手动改动与 data 不一致。
 *   本脚本在部署时执行，把线上 models 表校准到与 data/models.yaml 完全一致：
 *     - 新增：data 有、线上没有 → INSERT
 *     - 更新：两边都有但 name 不同 → UPDATE name
 *     - 删除：线上有、data 没有 → 先删 prompt_models 关联，再 DELETE
 *
 * 用法（从项目根）：
 *   # 试运行（只打印 diff，不写库）
 *   npx tsx scripts/sync-models.ts --dry-run
 *
 *   # 实际校准（需要 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / D1_DATABASE_ID）
 *   npx tsx scripts/sync-models.ts
 *
 * 说明：
 *   - 通过 D1 HTTP API 读写（与 import-md-to-d1.ts 一致）
 *   - 幂等：可重复执行，无 diff 时不做任何写操作
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const MODELS_YAML = path.join(ROOT, 'data', 'models.yaml');

const { values: args } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

const DRY_RUN = args['dry-run'] === true;

// ============================================================
// 解析 data/models.yaml（轻量解析，不引入 yaml 依赖）
// 格式：
//   slug:
//     name: 显示名
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
// Main
// ============================================================

interface Diff {
  toInsert: { slug: string; name: string }[];
  toUpdate: { slug: string; oldName: string; newName: string }[];
  toDelete: { slug: string; name: string }[];
}

function computeDiff(local: Map<string, string>, remote: Map<string, string>): Diff {
  const toInsert: Diff['toInsert'] = [];
  const toUpdate: Diff['toUpdate'] = [];
  const toDelete: Diff['toDelete'] = [];

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

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🔧 模型校准 (data/models.yaml → D1 models)');
  console.log('═══════════════════════════════════════════════════');

  const local = parseModelsYaml(MODELS_YAML);
  console.log(`📄 data/models.yaml: ${local.size} 个模型`);

  const remoteRows = await d1Query('SELECT slug, name FROM models');
  const remote = new Map<string, string>();
  for (const row of remoteRows) {
    remote.set(String(row.slug), String(row.name));
  }
  console.log(`🗄️  线上 D1 models: ${remote.size} 个模型`);

  const diff = computeDiff(local, remote);
  console.log(`\n📊 差异: 新增 ${diff.toInsert.length} · 更新 ${diff.toUpdate.length} · 删除 ${diff.toDelete.length}`);

  if (diff.toInsert.length === 0 && diff.toUpdate.length === 0 && diff.toDelete.length === 0) {
    console.log('\n✅ 线上 models 与 data/models.yaml 完全一致，无需校准');
    return;
  }

  for (const m of diff.toInsert) {
    console.log(`   ➕ 新增  ${m.slug} → ${m.name}`);
  }
  for (const m of diff.toUpdate) {
    console.log(`   ✏️  更新  ${m.slug}: ${m.oldName} → ${m.newName}`);
  }
  for (const m of diff.toDelete) {
    console.log(`   🗑️  删除  ${m.slug} (${m.name})`);
  }

  if (DRY_RUN) {
    console.log('\n🔍 DRY-RUN 模式，未写入任何数据');
    return;
  }

  // 执行校准
  const statements: { sql: string; params: unknown[] }[] = [];

  for (const m of diff.toInsert) {
    statements.push({ sql: 'INSERT INTO models (slug, name) VALUES (?, ?)', params: [m.slug, m.name] });
  }
  for (const m of diff.toUpdate) {
    statements.push({ sql: 'UPDATE models SET name = ? WHERE slug = ?', params: [m.newName, m.slug] });
  }
  for (const m of diff.toDelete) {
    // 先删关联，避免孤儿数据（D1 外键默认不强制）
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

  console.log(`\n✅ 校准完成，共执行 ${statements.length} 条 SQL`);
}

main().catch((err) => {
  console.error('\n❌ 模型校准失败:', err.message ?? err);
  process.exit(1);
});