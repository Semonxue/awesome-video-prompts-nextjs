/**
 * /api/prompts/check-duplicates — 批量查重接口（LLM 批量预处理前用）
 *
 * 输入（query string）：
 *   - ids: 逗号分隔的 twitter id 列表，如 `?ids=2063936575227175413,2084018642300141851`
 *
 * 输出（JSON）：
 *   {
 *     existing: string[],  // 已存在的 twitter id（线上已有对应 prompt）
 *     missing: string[],   // 不存在的 twitter id（可安全处理）
 *     total: number        // 请求的 id 总数
 *   }
 *
 * 匹配逻辑（双保险，见 queries.checkDuplicateTweetIds）：
 *   - source_url 包含 `/status/<id>`（最可靠）
 *   - slug 以 `<id>-` 开头（兼容 slug 前缀约定）
 *
 * 缓存：no-store（查重必须实时，不能命中 CDN 缓存）
 */
import { NextResponse, type NextRequest } from 'next/server';
import { checkDuplicateTweetIds } from '@/db/queries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const raw = sp.get('ids') ?? '';

  // 解析逗号分隔的 id，去空、去重
  const ids = Array.from(
    new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );

  if (ids.length === 0) {
    return NextResponse.json({ existing: [], missing: [], total: 0 });
  }

  const existing = await checkDuplicateTweetIds(ids);
  const missing = ids.filter((id) => !existing.has(id));

  return NextResponse.json({
    existing: Array.from(existing),
    missing,
    total: ids.length,
  });
}