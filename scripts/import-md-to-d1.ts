#!/usr/bin/env tsx
/**
 * MD 文件 → D1 导入脚本（Phase 2）
 *
 * 用法（从 nextjs 项目根）：
 *   # 本地 D1（dev）
 *   npx tsx scripts/import-md-to-d1.ts --local --limit 10
 *
 *   # 远程 D1（生产 / UAT）
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
 *     CLOUDFLARE_D1_DATABASE_ID=... \
 *     npx tsx scripts/import-md-to-d1.ts --remote
 *
 * 数据流：
 *   1. 读 ${LEGACY_CONTENT_DIR}/prompts 下所有 MD（默认 ../awesome-video-prompts/content）
 *   2. parse-md.ts 解析 front matter + content
 *   3. 本地：拼 SQL file → wrangler d1 execute --local --file=
 *      远程：D1 HTTP API batch（100/批）
 *   4. UNIQUE(slug, locale) + INSERT OR IGNORE，幂等可重跑
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
import { execSync } from 'child_process';
import matter from 'gray-matter';
import { detectLocale, extractSlug, parsePromptMeta } from '../src/lib/parse-md';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// 仅当直接执行时才解析参数
const _isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

// 默认 content dir 从 .dev.vars 的 LEGACY_CONTENT_DIR 读
const DEFAULT_CONTENT_DIR =
  process.env.LEGACY_CONTENT_DIR || path.join(ROOT, '..', 'awesome-video-prompts', 'content');
const DEFAULT_R2_URL = process.env.R2_PUBLIC_URL || 'https://static.awesomevideoprompts.com';

const { values: args } = _isDirectRun
  ? parseArgs({
      options: {
        local: { type: 'boolean', default: false },
        remote: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        'content-dir': { type: 'string', default: DEFAULT_CONTENT_DIR },
        'limit': { type: 'string' },
        'r2-public-url': { type: 'string', default: DEFAULT_R2_URL },
      },
      allowPositionals: false,
    })
  : {
      values: {
        local: false,
        remote: false,
        'dry-run': false,
        'content-dir': DEFAULT_CONTENT_DIR,
        limit: undefined,
        'r2-public-url': DEFAULT_R2_URL,
      },
    };

if (_isDirectRun && !args.local && !args.remote) {
  console.error('❌ 必须指定 --local 或 --remote');
  console.error('   npx tsx scripts/import-md-to-d1.ts --local --limit 10');
  process.exit(1);
}

const MODE = args.local ? 'local' : 'remote';
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity;
const R2_PUBLIC_URL = (args['r2-public-url'] as string).replace(/\/$/, '');

// ============================================================
// 解析
// ============================================================

interface ParsedPrompt {
  slug: string;
  locale: string;
  title: string;
  description: string;
  videoUrl: string | null;
  coverUrl: string | null;
  sourceUrl: string | null;
  author: string | null;
  promptDate: string | null;
  tags: string[];
  models: string[];
}

function findMdFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findMdFiles(full));
      } else if (entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
        results.push(full);
      }
    }
  } catch { /* ignore */ }
  return results;
}

function toR2Url(localPath: string | null): string | null {
  if (!localPath) return null;
  if (localPath.startsWith('http://') || localPath.startsWith('https://')) return localPath;
  if (!localPath.startsWith('/')) return localPath;
  return `${R2_PUBLIC_URL}${localPath}`;
}

function parseAll(mdFiles: string[]): ParsedPrompt[] {
  const out: ParsedPrompt[] = [];
  for (const filePath of mdFiles) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const { data, content } = matter(raw);
    const meta = parsePromptMeta(data as Record<string, unknown>, content);
    if (meta.isDraft) continue;

    const filename = path.basename(filePath);
    const slug = extractSlug(filename);
    if (!slug) continue;

    const locale = detectLocale(filePath);
    out.push({
      slug,
      locale,
      title: meta.title,
      description: meta.description,
      videoUrl: toR2Url(meta.videoUrl),
      coverUrl: toR2Url(meta.coverUrl),
      sourceUrl: meta.sourceUrl,
      author: meta.author,
      promptDate: meta.promptDate,
      tags: meta.tags,
      models: meta.models,
    });
  }
  return out;
}

// ============================================================
// SQL 生成
// ============================================================

function sqlEscape(s: string | null): string {
  if (s === null) return 'NULL';
  return `'${s.replace(/'/g, "''")}'`;
}

function buildBatchStatements(prompts: ParsedPrompt[]): { sql: string; params: unknown[] }[] {
  const stmts: { sql: string; params: unknown[] }[] = [];
  for (const p of prompts) {
    stmts.push({
      sql: `INSERT OR IGNORE INTO prompts
              (slug, locale, title, description, video_url, cover_url, source_url, author, prompt_date, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      params: [p.slug, p.locale, p.title, p.description, p.videoUrl, p.coverUrl, p.sourceUrl, p.author, p.promptDate],
    });

    for (const tag of p.tags) {
      stmts.push({
        sql: `INSERT OR IGNORE INTO tags (name) VALUES (?)`,
        params: [tag],
      });
      stmts.push({
        sql: `INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id)
              SELECT p.id, t.id FROM prompts p, tags t
              WHERE p.slug = ? AND p.locale = ? AND t.name = ?`,
        params: [p.slug, p.locale, tag],
      });
    }

    for (const model of p.models) {
      stmts.push({
        sql: `INSERT OR IGNORE INTO models (slug, name) VALUES (?, ?)`,
        params: [model, model],
      });
      stmts.push({
        sql: `INSERT OR IGNORE INTO prompt_models (prompt_id, model_id)
              SELECT p.id, m.id FROM prompts p, models m
              WHERE p.slug = ? AND p.locale = ? AND m.slug = ?`,
        params: [p.slug, p.locale, model],
      });
    }
  }
  return stmts;
}

function buildBatchSqlInline(prompts: ParsedPrompt[]): string {
  // D1 (SQLite) 每条 INSERT OR IGNORE 本身 atomic，不需要 BEGIN/COMMIT
  const lines: string[] = [];
  for (const p of prompts) {
    lines.push(`INSERT OR IGNORE INTO prompts
      (slug, locale, title, description, video_url, cover_url, source_url, author, prompt_date, created_at, updated_at)
      VALUES (${sqlEscape(p.slug)}, ${sqlEscape(p.locale)}, ${sqlEscape(p.title)},
              ${sqlEscape(p.description)}, ${sqlEscape(p.videoUrl)}, ${sqlEscape(p.coverUrl)},
              ${sqlEscape(p.sourceUrl)}, ${sqlEscape(p.author)}, ${sqlEscape(p.promptDate)},
              datetime('now'), datetime('now'));`);
    for (const tag of p.tags) {
      lines.push(`INSERT OR IGNORE INTO tags (name) VALUES (${sqlEscape(tag)});`);
      lines.push(`INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id)
        SELECT p.id, t.id FROM prompts p, tags t
        WHERE p.slug = ${sqlEscape(p.slug)} AND p.locale = ${sqlEscape(p.locale)} AND t.name = ${sqlEscape(tag)};`);
    }
    for (const model of p.models) {
      lines.push(`INSERT OR IGNORE INTO models (slug, name) VALUES (${sqlEscape(model)}, ${sqlEscape(model)});`);
      lines.push(`INSERT OR IGNORE INTO prompt_models (prompt_id, model_id)
        SELECT p.id, m.id FROM prompts p, models m
        WHERE p.slug = ${sqlEscape(p.slug)} AND p.locale = ${sqlEscape(p.locale)} AND m.slug = ${sqlEscape(model)};`);
    }
  }
  return lines.join('\n');
}

// ============================================================
// 写入：本地
// ============================================================

function importLocal(prompts: ParsedPrompt[]): void {
  const sql = buildBatchSqlInline(prompts);
  const tmpFile = path.join(os.tmpdir(), `import-md-${Date.now()}.sql`);
  fs.writeFileSync(tmpFile, sql, 'utf8');

  try {
    const out = execSync(
      `npx wrangler d1 execute prompts-db --local --file="${tmpFile}" --json`,
      { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, cwd: ROOT },
    );
    const lines = out.trim().split('\n');
    const lastJson = lines[lines.length - 1];
    try {
      const parsed = JSON.parse(lastJson);
      if (parsed.success) {
        console.log(`   ✅ 写入成功 (${parsed.meta?.duration ?? '?'}ms)`);
      }
    } catch { /* ignore parse error, exec succeeded */ }
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// ============================================================
// 写入：远程（D1 HTTP API batch）
// ============================================================

async function d1HttpBatch(statements: { sql: string; params: unknown[] }[]): Promise<void> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID || process.env.D1_DATABASE_ID;

  if (!accountId || !apiToken || !databaseId) {
    throw new Error(
      '远程模式需要环境变量: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_D1_DATABASE_ID (or D1_DATABASE_ID)',
    );
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const body = JSON.stringify({ batch: statements });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`D1 HTTP API ${res.status}: ${errText.slice(0, 500)}`);
  }

  const json = await res.json() as { success: boolean; errors?: { message: string }[]; result?: unknown[] };
  if (!json.success) {
    const msg = json.errors?.map((e) => e.message).join('; ') ?? 'unknown error';
    throw new Error(`D1 HTTP API returned success=false: ${msg}`);
  }
}

async function importRemote(prompts: ParsedPrompt[]): Promise<void> {
  const BATCH = 100;
  for (let i = 0; i < prompts.length; i += BATCH) {
    const chunk = prompts.slice(i, i + BATCH);
    const stmts = buildBatchStatements(chunk);
    await d1HttpBatch(stmts);
    console.log(`   ✅ Batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(prompts.length / BATCH)} (${chunk.length} prompts)`);
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('📦 MD → D1 导入脚本 (nextjs Phase 2)');
  console.log('═══════════════════════════════════════════════════');
  console.log(`📂 内容目录: ${args['content-dir']}`);
  console.log(`🎯 模式: ${MODE}${args['dry-run'] ? ' (DRY-RUN)' : ''}`);
  console.log(`📏 上限: ${LIMIT === Infinity ? '无' : LIMIT}`);
  console.log(`☁️  R2 公网 URL: ${R2_PUBLIC_URL}`);
  console.log('═══════════════════════════════════════════════════\n');

  const promptsDir = path.join(args['content-dir']!, 'prompts');
  if (!fs.existsSync(promptsDir)) {
    console.error(`❌ 目录不存在: ${promptsDir}`);
    console.error(`   （提示：用 --content-dir 指定，或设置 LEGACY_CONTENT_DIR 环境变量）`);
    process.exit(1);
  }

  const mdFiles = findMdFiles(promptsDir);
  console.log(`🔍 发现 ${mdFiles.length} 个 MD 文件`);

  let allParsed = parseAll(mdFiles);
  console.log(`✅ 解析完成，共 ${allParsed.length} 条有效记录`);

  if (allParsed.length > LIMIT) {
    console.log(`✂️  按 --limit ${LIMIT} 截断 → ${LIMIT} 条`);
    allParsed = allParsed.slice(0, LIMIT);
  }

  const localeStats = allParsed.reduce((a, p) => {
    a[p.locale] = (a[p.locale] ?? 0) + 1; return a;
  }, {} as Record<string, number>);
  console.log(`🌐 语言分布: ${JSON.stringify(localeStats)}\n`);

  if (args['dry-run']) {
    console.log('🔍 试运行预览（前 3 条）：\n');
    allParsed.slice(0, 3).forEach((p, i) => {
      console.log(`  [${i + 1}] ${p.locale} | ${p.slug}`);
      console.log(`       title: ${p.title.slice(0, 50)}${p.title.length > 50 ? '...' : ''}`);
      console.log(`       cover: ${p.coverUrl ?? '(无)'}`);
      console.log(`       tags: ${p.tags.slice(0, 6).join(', ')} | models: ${p.models.join(', ')}`);
      console.log();
    });
    console.log('✅ 试运行完成，未写入任何数据');
    return;
  }

  if (MODE === 'local') {
    importLocal(allParsed);
    console.log('\n🎉 本地导入完成！');
  } else {
    await importRemote(allParsed);
    console.log('\n🎉 远程导入完成！');
  }

  console.log(`   总计写入: ${allParsed.length} 条`);
  console.log(`   语言分布: ${JSON.stringify(localeStats)}`);
}

if (_isDirectRun) {
  main().catch((err) => {
    console.error('\n❌ 导入失败:', err.message ?? err);
    process.exit(1);
  });
}

export { findMdFiles, parseAll, buildBatchSqlInline, buildBatchStatements, toR2Url };
