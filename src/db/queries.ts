/**
 * 数据查询层（Page → DB 边界）
 *
 * Phase 1 实现：所有函数返回空数据 / null，页面正常渲染空态
 * Phase 2 实现：在 Cloudflare Workers 运行时通过 context.cloudflare.env.DB 拿 D1 binding
 *   - Drizzle queries via getDb(d1).select().from(prompts)...
 *   - OpenNext 提供 getCloudflareContext() 辅助函数
 *   - ISR 1h 缓存已覆盖性能，不预生成任何 JSON
 *
 * 调用方：首页 (page.tsx) / 详情页 ([slug]/page.tsx) / 标签页 / 模型页
 * 部署目标：Cloudflare Workers via OpenNext
 */

import type { Locale } from '@/i18n/request';
import type { PromptCardData } from '@/components/types';

/**
 * 列表查询参数（首页/标签页/模型页共用）
 */
export interface ListPromptsArgs {
  locale: Locale;
  /** 标签筛选（slug，可选） */
  tag?: string;
  /** 模型筛选（slug，可选） */
  model?: string;
  /** 关键词搜索（LIKE 兜底，Phase 2 不上 FTS5） */
  q?: string;
  /** 分页 */
  limit?: number;
  offset?: number;
}

export interface ListPromptsResult {
  items: PromptCardData[];
  total: number;
  hasMore: boolean;
}

/**
 * 列表查询 — 首页 / 标签 / 模型 页面入口
 * Phase 2 实现后真实查 D1（带 ISR 1h 缓存）
 */
export async function listPrompts(args: ListPromptsArgs): Promise<ListPromptsResult> {
  // Phase 1 占位 — 数据层就绪后替换为真实查询
  return { items: [], total: 0, hasMore: false };
}

/**
 * 单条查询 — 详情页入口
 * Phase 2 实现后按 slug + locale 查 D1
 */
export async function getPromptBySlug(
  locale: Locale,
  slug: string,
): Promise<PromptCardData | null> {
  // Phase 1 占位
  return null;
}

/**
 * 全部 tags — 标签页/筛选器下拉用
 * Phase 2 实现后查 D1
 */
export async function listAllTags(locale: Locale): Promise<{ slug: string; name: string; count: number }[]> {
  return [];
}

/**
 * 全部 models — 模型页用
 * Phase 2 实现后查 D1
 */
export async function listAllModels(locale: Locale): Promise<{ slug: string; name: string; count: number }[]> {
  return [];
}