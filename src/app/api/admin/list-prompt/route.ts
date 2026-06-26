/**
 * /api/admin/list-prompt — md-editor "从线上加载"用
 *
 * 用途：md-editor 输入 slug → 拉线上 D1 这条 → 写到 _drafts/ 加载编辑
 *
 * 请求：
 *   GET /api/admin/list-prompt?slug=<slug>
 *   Authorization: Bearer <ADMIN_SECRET>
 *
 * 响应：
 *   200: { ok: true, prompt: { slug, title, description, ... } }
 *   401: { error: "Unauthorized" }
 *   404: { error: "Not found" }
 *
 * ⚠️ Secret 读取必须用 ctx.env，不能用 process.env（见 /api/revalidate 的说明）
 */
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getDb } from '@/db';
import { prompts, tags, models, promptTags, promptModels } from '@/db/schema';

/** 统一从 ctx.env 读 CF Secret，尝试多种命名变体（Dashboard 可能用 kebab-case 或 SNAKE_CASE） */
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

interface ListPromptResponse {
  ok: true;
  prompt: {
    slug: string;
    title: string;
    description: string;
    author: string | null;
    source_url: string | null;
    cover_url: string | null;
    video_url: string | null;
    prompt_date: string | null;
    created_at: string;
    updated_at: string;
    tags: string[];
    models: string[];
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // 1) 鉴权
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const adminSecretStr = await getSecret('admin-secret', 'ADMIN_SECRET', 'ADMIN_SECRET_DEV');
  if (!adminSecretStr || bearer !== adminSecretStr) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2) 拿 slug
  const slug = req.nextUrl.searchParams.get('slug')?.trim();
  if (!slug) {
    return NextResponse.json({ error: 'Missing slug query param' }, { status: 400 });
  }

  // 3) 查 D1
  const ctx = await getCloudflareContext({ async: true });
  const d1 = ctx.env.DB;
  if (!d1) return NextResponse.json({ error: 'D1 binding missing' }, { status: 500 });
  const db = getDb(d1);

  const rows = await db
    .select()
    .from(prompts)
    .where(eq(prompts.slug, slug))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const row = rows[0];

  // 4) 查 tags
  const tagRows = await db
    .select({ name: tags.name })
    .from(promptTags)
    .innerJoin(tags, eq(promptTags.tagId, tags.id))
    .where(eq(promptTags.promptId, row.id));
  const tagList = tagRows.map((t) => t.name);

  // 5) 查 models
  const modelRows = await db
    .select({ slug: models.slug })
    .from(promptModels)
    .innerJoin(models, eq(promptModels.modelId, models.id))
    .where(eq(promptModels.promptId, row.id));
  const modelList = modelRows.map((m) => m.slug);

  return NextResponse.json<ListPromptResponse>({
    ok: true,
    prompt: {
      slug: row.slug,
      title: row.title,
      description: row.description,
      author: row.author,
      source_url: row.sourceUrl,
      cover_url: row.coverUrl,
      video_url: row.videoUrl,
      prompt_date: row.promptDate,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      tags: tagList,
      models: modelList,
    },
  });
}
