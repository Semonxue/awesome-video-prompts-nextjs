/**
 * R2 媒体 key 工具（/api/admin/publish 与 /api/admin/delete 共用）
 *
 * 背景（docs/MD-EDITOR-OPTIMIZATION.md P0-2.1）：
 * R2 key 形如 prompts/<YYYY-MM>/<slug>/<file>，YYYY-MM 历史上由 post_date 推导。
 * post_date 被编辑后重传媒体会写到新路径，旧 R2 对象孤儿化；delete 也按
 * post_date 推 key 导致删不掉旧对象、永久泄漏。因此 key 与 post_date 去耦：
 * - publish：slug 已存在且 D1 已有媒体 URL → 从 URL 反解 key（覆盖同一路径）
 * - delete：优先从 D1 的 cover_url/video_url 反解 key，再扫尾 post_date 旧路径
 */

export const R2_KEY_PREFIX = 'prompts';

/** 从 prompt_date (YYYY-MM-DD / YYYY-MM-01) 提取 YYYY-MM；无法解析时回退到当前月 */
export function deriveYearMonth(postDate: string | null | undefined): string {
  const m = String(postDate ?? '').match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * 从 D1 存储的媒体公开 URL 反解 R2 key。
 * 仅当路径合法（prompts/ 前缀且包含 /<slug>/ 目录）时返回 key，否则返回 null ——
 * 防止用被污染/拼错的 URL 覆盖或删除任意 R2 对象。
 */
export function keyFromMediaUrl(url: string | null | undefined, slug: string): string | null {
  if (!url) return null;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url; // 兼容相对路径形式（如 /prompts/2026-06/<slug>/cover.jpg）
  }
  const key = path.replace(/^\/+/, '');
  if (!key.startsWith(`${R2_KEY_PREFIX}/`)) return null;
  if (!key.includes(`/${slug}/`)) return null;
  return key;
}