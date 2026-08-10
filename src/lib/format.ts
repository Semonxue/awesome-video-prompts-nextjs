/**
 * tag / model 的 canonical 链接
 *
 * 背景（2026-08-07 爬取面收敛）：
 *   - 之前全站用 `/{locale}?tag=x` / `/{locale}?model=x` 指向首页的查询串变体
 *   - 这些变体是 noindex 但 follow:true，robots 也没屏蔽，爬虫照抓；
 *     内容又与 /tags/[tag]、/models/[model] 完全重复
 *   - PromptCard 每页 24 张 × 最多 5 个此类链接 ≈ 每个列表页暴露 120 个动态 URL
 *   - 现统一指向 canonical 页面，既去重又让首页不再依赖 searchParams
 *
 * 编码：29 个 tag（如 "martial arts"、"café"）和 4 个 model slug 含空格或非 ASCII，
 *       作为路径段必须 encodeURIComponent；Next.js 会在 params 里自动解码。
 *
 * 旧 formatModelName 已删除（2026-08-09）：model 显示名完全由 D1 models.name 真源化
 * （dict-sync 跟 yaml 100% 对齐保证），不再用启发式从 slug 杜撰。详见 db/queries.ts getModelName。
 */
export function tagHref(locale: string, tagSlug: string): string {
  return `/${locale}/tags/${encodeURIComponent(tagSlug)}`;
}

export function modelHref(locale: string, modelSlug: string): string {
  return `/${locale}/models/${encodeURIComponent(modelSlug)}`;
}

