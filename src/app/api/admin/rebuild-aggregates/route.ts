/**
 * /api/admin/rebuild-aggregates — 手动重建 R2 聚合缓存
 *
 * 为什么需要这个端点（2026-10-08 P1-4）：
 *   related-map.json / adjacent-map.json / counts.json 等聚合缓存是
 *   **在 publish / unpublish / delete 时**由 rebuildAllAggregateCaches() 重算的。
 *   P1-4 把 RELATED_PER_PROMPT 从 6 提到 12，改的是**预计算逻辑**，
 *   线上 R2 里的 related-map.json 仍然是旧的 6 条 —— 不重建就一直不生效。
 *   而这三个路由的触发条件都是"有 prompt 状态变更"，与本次改动无关。
 *
 *   所以给一个受 ADMIN_SECRET 保护的手动触发口，让预计算口径的调整能立刻验证，
 *   不必等下一次碰巧的 publish。
 *
 * 成本提示：
 *   rebuildAllAggregateCaches() 会一次性把 prompts / prompt_tags / prompt_models
 *   全表读进内存打分（computeRelatedMap 就是这么干的），属于**重操作**。
 *   不要挂到定时任务上高频调用；只在调整预计算口径后手动打一次。
 *
 * 请求：
 *   POST /api/admin/rebuild-aggregates
 *   Authorization: Bearer <ADMIN_SECRET>
 *
 * 响应：
 *   200: { ok: true, durationMs: number }
 *   401: { error: "Unauthorized" }
 *   500: { error: "..." }
 */
import { revalidatePath } from 'next/cache';
import { rebuildAllAggregateCaches } from '@/db/queries';
import { clearAggregatesDirty, readAggregatesDirty } from '@/db/aggregate-cache';
import { type NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

/** 统一从 ctx.env 读 CF Secret，尝试多种命名变体（与 publish/unpublish/delete 同一套） */
async function getSecret(...names: string[]): Promise<string> {
  const ctx = await getCloudflareContext({ async: true });
  const env = ctx.env as unknown as Record<string, unknown>;
  for (const name of names) {
    const v = env[name];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'function') {
      const s = String(v());
      if (!s.startsWith('[')) return s;
    }
  }
  return '';
}

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // 2026-11-17 修复：这里原来只查 ADMIN_SECRET / ADMIN_SCRET（还打错一个字母），
  // 而线上 secret 名是 kebab-case 的 admin-secret → 该端点在生产一直 401，
  // 相当于"手动重建"这条后路是断的。与 publish/unpublish/delete 统一。
  const secret = await getSecret('admin-secret', 'ADMIN_SECRET', 'ADMIN_SECRET_DEV');
  const auth = req.headers.get('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  const dirty = await readAggregatesDirty();
  try {
    await rebuildAllAggregateCaches();
    await clearAggregatesDirty();
    // 聚合缓存变了，列表页与 sitemap 需要跟着刷
    for (const p of ['/en', '/zh', '/ja', '/en/tags', '/zh/tags', '/ja/tags', '/en/models', '/zh/models', '/ja/models', '/sitemap.xml']) {
      try {
        revalidatePath(p);
      } catch (e) {
        console.warn(`[admin/rebuild-aggregates] revalidatePath failed for ${p}:`, e);
      }
    }
    console.log(
      `[admin/rebuild-aggregates] ok durationMs=${Date.now() - started} dirty=${dirty?.at ?? 'none'}`,
    );
    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - started,
      /** 本次重建前是否存在"发布已写 D1 但聚合未重建"的脏标记 */
      hadDirtyMarker: dirty !== null,
      dirtyAt: dirty?.at ?? null,
    });
  } catch (err) {
    console.error('[admin/rebuild-aggregates] rebuild failed:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
