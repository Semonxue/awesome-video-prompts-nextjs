/**
 * 站点级常量 — 全站唯一真源
 *
 * 所有页面 / sitemap / robots 的 URL 都从这里读取，
 * 避免各文件 fallback 不一致导致 canonical / sitemap 指向错误域名。
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://awesomevideoprompts.com';

/** R2 公网域（图片/视频/默认 OG 图） */
export const R2_PUBLIC_URL =
  process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? 'https://static.awesomevideoprompts.com';

/** 默认 OG image（列表页/首页等无封面图时使用） */
export const DEFAULT_OG_IMAGE = `${R2_PUBLIC_URL}/og/og-default.png`;