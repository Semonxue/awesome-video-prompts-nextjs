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
 * 2026-10-08 SEO 审计（P0-1 / P0-2）：
 *   上一版只修了"目标不存在"那一半（GSC 4,265 条 404），**漏了"双 locale 前缀"这一半**。
 *   旧站自己会产出 `/ja/ja/prompts/...`、`/zh-cn/zh-cn/prompts/...` 这类重复前缀 URL，
 *   而 normalizeLocalePrefix 之前的实现里 for 循环只 break 一次：
 *     /zh-cn/zh-cn/prompts/... → /zh/zh-cn/prompts/... → LEGACY_PROMPT_RE 不匹配 → 落 step 6 → 404
 *   404 页面会跑一次完整 SSR（layout + Header，tag 序列化实测占 HTML 很大比重），
 *   等于每被重爬一次就烧一次 CPU —— 这正是 robots.ts 里记的 Error 1102 事故的同类开销。
 *
 *   修法：把 locale 段归一化改成「折叠到不动点」的循环，并补齐 locale 别名。
 *
 * P1-1（2026-10-08）：tag 分页从 `?page=N` 升级为真实路径 `/{locale}/tags/{tag}/p/{N}`。
 *   `?page=N` 继续被 robots.txt 封锁且页面自带 noindex（见 tags/[tag]/page.tsx），
 *   在这里 301 收敛到真实路径，避免同一批内容存在两套 URL。
 */
import { locales } from '@/i18n/request';
import { TAG_PAGE_MAX_DEPTH, MODEL_PAGE_MAX_DEPTH } from '@/lib/pagination';

export type LegacyAction =
  | { kind: 'redirect'; to: string }
  | { kind: 'legacyPrompt'; locale: string; slug: string };

/**
 * 旧 locale 段别名 → 规范 locale。
 * 键一律小写（比较时统一 toLowerCase），所以 `/zh-CN`、`/ZH-CN` 都能命中，
 * 不需要像旧版那样为大小写各写一条。
 */
const LEGACY_LOCALE_SEGMENTS: Record<string, string> = {
  'zh-cn': 'zh',
  'zh_cn': 'zh',
  'zh-hans': 'zh',
  'zh-hant': 'zh',
  'zh-sg': 'zh',
  'zh-tw': 'zh',
  'zh-hk': 'zh',
  'en-us': 'en',
  'en-gb': 'en',
  'ja-jp': 'ja',
  jp: 'ja',
};

/** /{locale}/prompts/YYYY-MM/<slug> —— 旧站详情页形态（locale 之后不允许再有段） */
const LEGACY_PROMPT_RE = /^\/(en|zh|ja)\/prompts\/(\d{4}-\d{2})\/(.+)$/;
/** /{locale}/prompts/page/N —— 旧站分页形态 */
const LEGACY_PAGE_RE = /^\/(en|zh|ja)\/prompts\/page\/(\d+)$/;
/** /{locale}/tags/<tag> —— tag 页本体（用于 ?page=N → /p/N 的收敛） */
const TAG_PAGE_RE = /^\/(en|zh|ja)\/tags\/([^/]+)$/;
/** /{locale}/models/<model> —— model 页本体 */
const MODEL_PAGE_RE = /^\/(en|zh|ja)\/models\/([^/]+)$/;

/**
 * tag 分页最大页码复用 src/lib/pagination.ts 的 TAG_PAGE_MAX_DEPTH（成本护栏 G1），
 * 单一事实来源在那里 —— 本文件只负责把旧 ?page=N 收敛到 /p/N。
 * 为什么不一致会导致 /p/N 路由 404，见 pagination.ts 的注释。
 */

// 显式标 Set<string>：locales 是 as const 字面量元组，直接 new Set(locales)
// 会被推成 Set<"en"|"zh"|"ja">，之后拿 toLowerCase() 的 string 去 has() 就编译不过
const CANONICAL_LOCALES: ReadonlySet<string> = new Set<string>(locales);

/**
 * 折叠开头的 locale 段，直到不动点。
 *
 * 覆盖：
 *   /zh-cn/zh-cn/zh-cn/... → /zh/...
 *   /ja/ja/...            → /ja/...
 *   /zh/zh-cn/...         → /zh/...
 *   /ZH-CN/...            → /zh/...（大小写不敏感）
 *   /tags/x               → /tags/x（无 locale 前缀，原样返回）
 *
 * 只动开头的 locale 段，后续段的原始大小写保持不变（tag/slug 大小写敏感）。
 */
function normalizeLocalePrefix(path: string): string {
  const segs = path.split('/').filter(Boolean);

  for (;;) {
    if (segs.length === 0) break;
    const low = segs[0].toLowerCase();

    // 别名 → 规范 locale（改完重新检查，因为下一步可能是折叠）
    if (LEGACY_LOCALE_SEGMENTS[low]) {
      segs[0] = LEGACY_LOCALE_SEGMENTS[low];
      continue;
    }

    // 没有 locale 前缀，收工
    if (!CANONICAL_LOCALES.has(low)) break;

    // 连续同名 locale 段：/ja/ja/... → /ja/...
    let j = 1;
    while (j < segs.length && segs[j].toLowerCase() === low) j++;
    if (j > 1) {
      segs.splice(1, j - 1);
      continue;
    }

    // 紧随规范 locale 之后的别名段：/zh/zh-cn/... → /zh/...
    if (segs.length > 1 && LEGACY_LOCALE_SEGMENTS[segs[1].toLowerCase()]) {
      segs.splice(1, 1);
      continue;
    }

    break;
  }

  return '/' + segs.join('/');
}

/** 从 query string 里取 page=N（N>0），取不到返回 null */
function parsePageParam(search: string): number | null {
  if (!search) return null;
  const m = /(?:^\?|&)page=(\d+)/.exec(search);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** query string 里是否存在某个非空参数 */
function hasQueryParam(search: string, key: string): boolean {
  if (!search) return false;
  return new RegExp(`(?:^\\?|&)${key}=[^&]+`).test(search);
}

export function resolveLegacyAction(pathname: string, search: string): LegacyAction | null {
  // 根路径交给 intlMiddleware（302 → /en），不在这里处理
  if (pathname === '/') return null;

  // 1. 去尾部斜杠（根路径除外）
  let path = pathname;
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  // 2. 折叠开头的 locale 段（别名 / 重复前缀）到不动点
  path = normalizeLocalePrefix(path);

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

  // 6. tag 页 ?page=N → 真实路径 /p/N（避免同一批内容两套 URL）
  const tagMatch = path.match(TAG_PAGE_RE);
  if (tagMatch) {
    const n = parsePageParam(search);
    if (n !== null) {
      // n===1 → 收敛到干净路径；n 超上限 → 夹到上限（不丢到 page 1）
      const to =
        n > 1
          ? `/${tagMatch[1]}/tags/${tagMatch[2]}/p/${Math.min(n, TAG_PAGE_MAX_DEPTH)}`
          : path;
      return { kind: 'redirect', to };
    }
  }

  // 6b. model 页 ?page=N → 真实路径 /p/N
  //     带 ?tag= 时**不收敛**：那是 faceted 交叉面，继续 robots 封锁 + noindex，
  //     刻意不并入 /p/N 体系（与 P2-3 收敛提交面的取向一致）。
  const modelMatch = path.match(MODEL_PAGE_RE);
  if (modelMatch && !hasQueryParam(search, 'tag')) {
    const n = parsePageParam(search);
    if (n !== null) {
      const to =
        n > 1
          ? `/${modelMatch[1]}/models/${modelMatch[2]}/p/${Math.min(n, MODEL_PAGE_MAX_DEPTH)}`
          : path;
      return { kind: 'redirect', to };
    }
  }

  // 7. 其他路径：若因去斜杠/补 locale 变化 → 重定向
  if (path !== pathname) {
    return { kind: 'redirect', to: path + search };
  }

  return null;
}
