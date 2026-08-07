/**
 * 格式化工具函数
 */

/**
 * 把 model slug 转成显示名
 *   "grok" -> "Grok"
 *   "seedance2" -> "Seedance 2"
 *   "kling26" -> "Kling 2.6"
 *   "klingo1" -> "Kling O1"
 */
export function formatModelName(slug: string): string {
  if (!slug) return '';

  // Seedance 系列: seedance + 数字 + 可选 pro
  //   seedance1.5pro -> "Seedance 1.5 Pro"
  //   seedance2      -> "Seedance 2.0"
  const seedance = slug.match(/^seedance(\d+(?:\.\d+)?)(pro)?$/i);
  if (seedance) {
    const [, ver, pro] = seedance;
    // 如果 ver 没有小数点，补 .0
    const verFmt = ver.includes('.') ? ver : `${ver}.0`;
    return `Seedance ${verFmt}${pro ? ' Pro' : ''}`;
  }

  // Kling 系列: kling + 1-2位数字 (e.g. kling26=Kling 2.6, kling3=Kling 3.0, klingo1=Kling O1)
  const kling = slug.match(/^kling(\d{1,2})(o\d+)?$/i);
  if (kling) {
    const [, num, oVer] = kling;
    let formatted: string;
    if (num.length === 2) {
      formatted = `${num[0]}.${num[1]}`;
    } else {
      formatted = `${num}.0`;
    }
    return `Kling ${formatted}${oVer ? ' ' + oVer.toUpperCase() : ''}`;
  }

  // 通用: 前缀字母 + 数字
  const m = slug.match(/^([a-z]+)(\d+(?:\.\d+)?)$/i);
  if (m) {
    const [, name, ver] = m;
    return name.charAt(0).toUpperCase() + name.slice(1) + ' ' + ver;
  }

  // 默认: 首字母大写
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

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
 */
export function tagHref(locale: string, tagSlug: string): string {
  return `/${locale}/tags/${encodeURIComponent(tagSlug)}`;
}

export function modelHref(locale: string, modelSlug: string): string {
  return `/${locale}/models/${encodeURIComponent(modelSlug)}`;
}

