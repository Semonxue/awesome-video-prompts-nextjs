/**
 * 旧站 URL → 新站 URL 的解析（纯函数，可单测）
 *
 * 2026-09-08 从 src/middleware.ts 抽出来，并改掉旧 prompt URL 的处理方式：
 *
 *   旧行为：/{locale}/prompts/YYYY-MM/<slug> 直接字符串改写成 /{locale}/prompts/<slug> 后 301。
 *   问题：迁移时丢了一批 prompt，改写后的目标在新站根本不存在 →
 *         301 落到 404。GSC（2026-09-08）「Not found (404)」5,284 条全是这类旧格式 URL，
 *         每次被重爬都是一次 SSR + D1，纯浪费抓取预算。
 *   新行为：旧 prompt URL 标记为 legacyPrompt，由 middleware 内部 rewrite 到
 *         /api/legacy-prompt 做一次存在性检查：
 *           存在 → 301 到新 URL（保住外链权重）
 *           不存在 → 410 Gone（比 404 更快让 Google 移出索引与爬取队列）
 *
 * 其余规则（去尾斜杠 / 旧 locale 前缀 / 补 locale / 旧分页）保持原样。
 */
import { locales } from '@/i18n/request';

export type LegacyAction =
  | { kind: 'redirect'; to: string }
  | { kind: 'legacyPrompt'; locale: string; slug: string };

/** 旧 locale 前缀映射（zh-cn / zh-CN / zh-tw → zh） */
const LEGACY_LOCALE_MAP: Record<string, string> = {
  '/zh-cn': '/zh',
  '/zh-CN': '/zh',
  '/zh-tw': '/zh',
};

/** /{locale}/prompts/YYYY-MM/<slug> —— 旧站详情页形态 */
const LEGACY_PROMPT_RE = /^\/(en|zh|ja)\/prompts\/(\d{4}-\d{2})\/(.+)$/;
/** /{locale}/prompts/page/N —— 旧站分页形态 */
const LEGACY_PAGE_RE = /^\/(en|zh|ja)\/prompts\/page\/(\d+)$/;

export function resolveLegacyAction(pathname: string, search: string): LegacyAction | null {
  // 根路径交给 intlMiddleware（302 → /en），不在这里处理
  if (pathname === '/') return null;

  // 1. 去尾部斜杠（根路径除外）
  let path = pathname;
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  // 2. 旧 locale 前缀映射：/zh-cn/... → /zh/...
  for (const [oldPrefix, newPrefix] of Object.entries(LEGACY_LOCALE_MAP)) {
    if (path === oldPrefix || path.startsWith(`${oldPrefix}/`)) {
      path = newPrefix + path.slice(oldPrefix.length);
      break;
    }
  }

  // 3. 无 locale 前缀 → 加 /en
  const hasLocale = locales.some((l) => path === `/${l}` || path.startsWith(`/${l}/`));
  if (!hasLocale) {
    path = `/en${path}`;
  }

  // 4. 旧 prompt 格式：/{locale}/prompts/YYYY-MM/<slug> → 交给存在性检查路由
  //    注意：旧 slug 形如 <twitter-id>-<中段数字>-<slug>，与新站 <twitter-id>-<slug> 不同，
  //    所以不能靠字符串改写猜目标，必须查库。
  const promptMatch = path.match(LEGACY_PROMPT_RE);
  if (promptMatch) {
    const [, locale, , slug] = promptMatch;
    return { kind: 'legacyPrompt', locale, slug };
  }

  // 5. 旧分页：/en/prompts/page/N → /en?page=N
  const pageMatch = path.match(LEGACY_PAGE_RE);
  if (pageMatch) {
    const [, locale, pageNum] = pageMatch;
    return { kind: 'redirect', to: `/${locale}?page=${pageNum}` };
  }

  // 6. 其他路径：若因去斜杠/加 locale 变化 → 重定向
  if (path !== pathname) {
    return { kind: 'redirect', to: path + search };
  }

  return null;
}
