/**
 * description 截断（2026-10-15 Workers CPU 优化）
 *
 * 纯函数，独立成文件是为了能脱离 D1 binding 直接单测。
 *
 * 背景：PromptCard 是 `'use client'` 组件，其 props 会被全量序列化进 RSC flight
 * payload 并再嵌进 SSR HTML。卡片 UI 只渲染 180 字符，但服务端原本下发完整正文：
 * 实测一页 48 条 description 合计 188,871 B（中位 2,475 B、最大 17,846 B），
 * 相对 flight payload 227,238 B 占了绝大部分。
 *
 * 列表页改传摘要后，复制全文由客户端懒加载 /api/prompt/[slug]。
 * 详情页不调用本函数（正文是 SEO 主体，必须完整）。
 */

import { DESCRIPTION_TRUNCATED_SUFFIX } from '@/components/types';

/**
 * 把 description 压到 limit 个字符以内，超长时以 … 结尾。
 *
 * 与 UI 层 PromptCard 的 truncate() 保持一致的空白折叠语义：
 * 列表页下发的摘要应当恰好等于用户看到的文本，避免复制到与显示不一致的内容。
 *
 * 返回值可判定是否被截断：`endsWith('…')` 即为摘要。
 */
export function clampDescription(text: string | null | undefined, limit: number): string {
  if (!text) return '';
  // 折叠连续空白，与 PromptCard.truncate 的 replace(/\s+/g, ' ') 一致
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  return flat.slice(0, limit) + DESCRIPTION_TRUNCATED_SUFFIX;
}

/**
 * 判断一份 description 是否是被截断的摘要（而非全文）。
 *
 * PromptCard 靠它在复制前决定要不要去拉全文。误判代价不对称：
 *   - 假阴性（把摘要当全文复制）→ 用户拿到腰斩的提示词，静默错误，最糟
 *   - 假阳性（把全文当摘要，多发一次请求）→ 只是多一次 fetch，可接受
 * 所以只在「确实超长」时才判 true，宁可多请求也不静默给错内容。
 */
export function isTruncatedSummary(text: string | null | undefined): boolean {
  if (!text) return false;
  return (
    text.length > 0 &&
    text.endsWith(DESCRIPTION_TRUNCATED_SUFFIX) &&
    // 排除本身就是完整正文、恰好以 … 结尾的条目（罕见但存在）
    text.trim().length > 1
  );
}
