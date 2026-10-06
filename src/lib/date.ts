/**
 * 日期归一化 —— D1 存的不是 W3C/ISO 8601
 *
 * 实测（本地 sqlite 全量 4479 行）：
 *   prompts.updated_at / created_at = `2026-06-26 09:22:28`（空格分隔，长度 19）
 *   prompts.prompt_date            = `2026-06-16`（纯日期）
 *
 * 空格分隔**不是**合法的 ISO 8601。原样塞进 JSON-LD 的 dateModified 或 sitemap 的
 * lastmod，Google 会判 "Invalid date"（GSC 历史上就报过这类错）。
 *
 * 时区：import 脚本用 SQLite 的 `datetime('now')` 写入，那是 **UTC**；
 * publish 路由用 `new Date().toISOString()`（带 T/Z，原样放行）。
 * 所以对无时区后缀的值补 `Z` 是正确的。
 *
 * 用法：sitemap lastmod、JSON-LD datePublished / dateModified / uploadDate 都要过这里。
 * 无法识别或日历上不存在的值（如 2026-13-45）返回 undefined ——
 * 调用方据此省略该字段，绝不输出半合法的日期。
 */

/** 日历合法性：拒绝 2026-13-45 / 2026-02-30 这类形状对但值非法的串 */
function isRealDate(y: number, mo: number, d: number): boolean {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= daysInMonth;
}

export function toW3CDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  // `YYYY-MM-DD` —— W3C 允许纯日期，但要确认这天真实存在
  const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    return isRealDate(+y, +mo, +d) ? trimmed : undefined;
  }

  // `YYYY-MM-DD[ T]HH:MM:SS[.fff][Z|±HH:MM|±HHMM]`
  // 空格分隔是 D1 的原生形态；T 分隔且**没有**时区后缀时也补 Z，避免歧义。
  const full = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/
  );
  if (full) {
    const [, y, mo, d, hh, mm, ss, frac, tz] = full;
    if (!isRealDate(+y, +mo, +d)) return undefined;
    const hour = +hh;
    const minute = +mm;
    const second = +ss;
    // 允许 23:59:60（ISO 8601 的闰秒表示），不拒绝
    if (hour > 23 || minute > 59 || second > 60) return undefined;
    return `${y}-${mo}-${d}T${hh}:${mm}:${ss}${frac ?? ''}${tz ?? 'Z'}`;
  }

  return undefined;
}
