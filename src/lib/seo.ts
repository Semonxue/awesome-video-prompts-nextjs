/**
 * SEO locale 单一真源（2026-10-18）
 *
 * 决策：**只把 en 送去 SEO**（提交 sitemap + 允许被索引）。
 * zh / ja 仍然可访问、仍被全站内链指向（语言切换器 / Header / Footer），
 * 但输出 `noindex, follow` 且不进 sitemap、不进 hreflang。
 *
 * 依据（GSC 2026-10-18 实测，见 docs/SEO-STATUS-AND-COST-NEUTRAL-PLAN-2026-10-18.md）：
 *   - 全站仅 3 个 URL 被索引，且真正属于当前站点的只有 /en 与 /ja 两个首页
 *   - `Crawled - currently not indexed` 13,076 条，里面包含 `/zh` 首页与 tag 页
 *     —— 即 zh 页面被 Google **抓取后主动拒绝**
 *   - 三语正文相似度实测：en↔zh 87.8%、en↔ja 89.4%（prompt 原文是英文，
 *     只翻译了页面 chrome）→ 等于同一内容递了三次
 *
 * 为什么用 noindex 而不是 robots.txt 封禁：
 *   封禁会让 Google 看不到 noindex 指令，已收录的 URL 也不会因为"不可爬"而消失。
 *   `noindex, follow` 才是"请把它从索引里拿掉，但仍跟随页面内链接"的正确表达。
 *
 * ⚠️ hreflang 只有一个来源（2026-10-18 踩过的坑）：
 *   next-intl 中间件默认开启 `alternateLinks`，会给每个 HTML 响应**额外**追加一个
 *   `Link: rel="alternate"; hreflang=...` 响应头，按 `locales` 全量生成，
 *   与页面 metadata 的 `alternates.languages` 互相独立 —— 只改 metadata 是不够的，
 *   响应头里 zh/ja 会继续存在并形成冲突信号。
 *   已在 src/middleware.ts 设 `alternateLinks: false`。改 hreflang 时两处都要记得。
 *
 * 想恢复某语言：把它的 code 加进 SEO_INDEXABLE_LOCALES 即可 ——
 * sitemap 与 robots 都由这一个常量推导；hreflang 由 buildSeoAlternates() 推导。
 * （若届时希望恢复响应头形式的 hreflang，再打开 next-intl 的 alternateLinks。）
 */
import type { Metadata } from 'next';
import type { Locale } from '@/i18n/request';

/**
 * 参与 SEO 的 locale（默认只有 en）。
 * 顺序即优先级；SEO_PRIMARY_LOCALE 必须在其中。
 */
export const SEO_INDEXABLE_LOCALES: ReadonlyArray<Locale> = ['en'];

/** 主语言：x-default 指向它 */
export const SEO_PRIMARY_LOCALE: Locale = 'en';

/** 该 locale 是否允许被搜索引擎索引 */
export function isSeoIndexable(locale: string): boolean {
  return (SEO_INDEXABLE_LOCALES as ReadonlyArray<string>).includes(locale);
}

/**
 * 构建 `alternates.languages`（hreflang）。
 *
 * **只包含参与 SEO 的 locale。** 被 noindex 的页面不能出现在 hreflang 组里 ——
 * Google 明确要求 hreflang 的每个目标都必须可索引，否则整组信号会被忽略/不信任。
 *
 * @param localePath 把 locale 映射成该页面对应语言的绝对 URL
 */
export function buildSeoAlternates(
  localePath: (locale: Locale) => string,
): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const loc of SEO_INDEXABLE_LOCALES) {
    languages[loc] = localePath(loc);
  }
  languages['x-default'] = localePath(SEO_PRIMARY_LOCALE);
  return languages;
}

/**
 * 计算该页面应输出的 robots 指令。
 *
 * - 非 SEO locale → 恒为 `noindex, follow`
 * - 调用方额外判定为低价值页（分页 / 搜索 / 筛选等）→ 同样 noindex
 * - 其余 → `undefined`（不输出 robots 标签，即默认可索引）
 */
export function seoRobots(
  locale: string,
  opts: { noindex?: boolean } = {},
): Metadata['robots'] {
  if (opts.noindex || !isSeoIndexable(locale)) {
    return { index: false, follow: true };
  }
  return undefined;
}
