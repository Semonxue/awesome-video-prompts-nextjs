/**
 * /api/revalidate — ISR 缓存手动刷新端点
 *
 * 用法：
 *   curl -X POST "https://.../api/revalidate?secret=<REVALIDATE_SECRET>"
 *
 * 参数：
 *   - secret（必填）：与 REVALIDATE_SECRET 环境变量匹配
 *   - path（可选）：要刷新的路径，默认为 /en；支持 glob 如 /en/prompts/*
 *
 * 成功后返回 { revalidated: true, paths: [...] }
 * 失败返回 401 或 500
 *
 * 注意：
 *   - OpenNext on Workers 的 revalidatePath() 作用于 Next.js ISR 缓存层
 *   - 配合 CF Cache Rules（边缘 1h TTL）实现完整缓存刷新链路
 */
import { revalidatePath } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';

const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET ?? '';

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  const path = req.nextUrl.searchParams.get('path') ?? '/en';

  if (!secret || secret !== REVALIDATE_SECRET) {
    return NextResponse.json({ error: 'Invalid or missing secret' }, { status: 401 });
  }

  try {
    // 刷新所有 locale 的首页 + 对应 path
    const paths = ['/en', '/zh', '/ja'];
    // 如果指定了具体路径，也刷新对应的 locale 版本
    if (path !== '/en') {
      const basePath = path.replace(/^\/(en|zh|ja)/, '');
      paths.push(`/en${basePath}`, `/zh${basePath}`, `/ja${basePath}`);
    }

    const revalidated: string[] = [];
    for (const p of [...new Set(paths)]) {
      revalidatePath(p);
      revalidated.push(p);
    }

    return NextResponse.json({ revalidated: true, paths: revalidated });
  } catch (err) {
    console.error('[revalidate] error:', err);
    return NextResponse.json({ error: 'Revalidation failed' }, { status: 500 });
  }
}

// 禁止 GET 请求
export async function GET() {
  return NextResponse.json({ error: 'Use POST' }, { status: 405 });
}
