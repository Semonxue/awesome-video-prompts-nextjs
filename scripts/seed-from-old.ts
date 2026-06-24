/**
 * Seed from Old — Phase 3 占位
 *
 * 计划行为（Phase 3 实装）：
 * 1. 读 LEGACY_CONTENT_DIR（默认 ../awesome-video-prompts/content/）下所有 MD
 * 2. 随机抽 30 条种子（覆盖月份+模型+标签多样性）
 * 3. 解析 front matter（parse-md.ts）
 * 4. 写本地 D1（wrangler d1 execute --local --file=- 或 HTTP API）
 * 5. 幂等：INSERT OR REPLACE + UNIQUE(slug, locale)
 *
 * 当前状态：Phase 1 不实装 — D1 schema 还没在本地执行
 */

import { parsePromptMeta, detectLocale, extractSlug } from '../src/lib/parse-md';

interface SeedOptions {
  /** 老仓库 content 路径（默认 ../awesome-video-prompts/content） */
  legacyContentDir?: string;
  /** 种子条数 */
  count?: number;
}

export async function seedFromOld(options: SeedOptions = {}): Promise<void> {
  const legacyContentDir = options.legacyContentDir ?? '../awesome-video-prompts/content';
  const count = options.count ?? 30;

  console.log('[seed-from-old] Phase 3 占位 — 当前不执行实际导入');
  console.log(`[seed-from-old] 计划读取: ${legacyContentDir}`);
  console.log(`[seed-from-old] 计划抽取: ${count} 条种子`);
  console.log('[seed-from-old] 待 Phase 2 schema 实装后启用');

// 已引入以避免 unused import 报错
void parsePromptMeta;
void detectLocale;
void extractSlug;
}

// CLI entry — `npx tsx scripts/seed-from-old.ts`
if (require.main === module) {
  seedFromOld().catch((err) => {
    console.error('[seed-from-old] failed:', err);
    process.exit(1);
  });
}