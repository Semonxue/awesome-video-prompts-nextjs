/**
 * 站点级常量 — 全站唯一真源
 *
 * 所有页面 / sitemap / robots 的 URL 都从这里读取，
 * 避免各文件 fallback 不一致导致 canonical / sitemap 指向错误域名。
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://awesomevideoprompts.com';

/** 站点品牌名（JSON-LD 的 Organization / publisher 用，避免各处硬编码不一致） */
export const SITE_BRAND = 'Awesome Video Prompts';

/** R2 公网域（图片/视频/默认 OG 图） */
export const R2_PUBLIC_URL =
  process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? 'https://static.awesomevideoprompts.com';

/**
 * 默认 OG image（首页 / 列表页 / 无封面的详情页）
 *
 * 2026-09-08 修复：原值指向 R2 的 `static.awesomevideoprompts.com/og/og-default.png`，
 * 实测该对象不存在（HTTP 404）→ 全站列表页与无封面详情页的 og:image /
 * twitter:image 全部指向 404。
 *
 * 现改为随代码走 git 部署的 `public/og/og-default.png`（1200×630），
 * 由 OpenNext assets binding 提供，不依赖手动上传 R2。
 */
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og/og-default.png`;