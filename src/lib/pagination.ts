/**
 * 分页常量（单一事实来源）
 *
 * 2026-10-08 SEO 审计（P1-3）新增：
 *
 *   之前 PAGE_SIZE = 24 被**硬编码在 5 个地方**：
 *     - app/[locale]/page.tsx:29            （首页）
 *     - app/[locale]/tags/[tag]/page.tsx:24
 *     - app/[locale]/models/[model]/page.tsx:24
 *     - app/api/prompts/route.ts:29         （无限滚动取数）
 *     - components/GridEngine.tsx:49        （DEFAULT_PAGE_SIZE）
 *
 *   这是一颗定时炸弹：SSR 页与 /api/prompts 算 offset 的基数必须一致，
 *   改了一处忘了另一处，GridEngine 的 infinite scroll 就会跳页 / 重复条目。
 *   现在统一从这里取。
 *
 *   为什么从 24 提到 48：
 *   313 个 tag 的规模分布是 median 19 / p75 80 / p90 188 / max 4,511，
 *   24 条/页对中位数 tag 是浪费，对头部 tag 又远远不够。提到 48 后
 *   p75 以下的 tag 一页装完，分页页的数量显著下降。
 *
 * 成本提示：PAGE_SIZE 直接等于每个列表页的 D1 rows read。
 * 24 → 48 意味着**单个列表页的行数翻倍**。分页深度另有上限
 * （见 legacy-url.ts 的 TAG_PAGE_MAX_DEPTH），两者相乘才是总成本。
 */
export const PAGE_SIZE = 48;

/**
 * tag 分页最大页码（成本护栏 G1）
 *
 * 注意：与 legacy-url.ts 的 TAG_PAGE_MAX_DEPTH 必须一致 ——
 * 那个值决定 ?page=N 被 301 收敛到哪一页，这里决定 /p/N 路由接受到哪一页。
 * 不一致会出现"旧 URL 被收敛到 /p/5，但 /p/5 自己 404"的链路。
 *
 * 取值 3（原计划 5，因成本基线未测到而下调一档）：
 *   PAGE_SIZE 48 × 深度 3 = 每 tag 最多 144 条。
 *   - median 19 / p75 80  → 一页装完，无分页
 *   - p90 188             → 两页装完
 *   - 头部（cinematic 4511 等约 40 个 tag）→ 截断，靠 /models/[model]
 *     与详情页 related 承接
 *
 * 改动这个值时，legacy-url.test.ts 里有依赖它的断言。
 */
export const TAG_PAGE_MAX_DEPTH = 3;

/**
 * model 分页最大页码（成本护栏 G1）
 *
 * 25 个 model，规模远小于 tag 维度（tag max 4,511），但同样存在
 * "page 2+ 无链接 + robots 封 + noindex" 的死区问题，
 * 所以与 tag 用同一套 /p/N 真实路径方案、同样深度上限 3。
 *
 * 刻意不做：`?tag=X` 的分页（faceted）。
 *   那是 model × tag 的交叉面，与 /[locale]/tags/[tag] 内容重复，
 *   继续 robots 封锁（`/*?tag=` 已在 robots.txt）+ 页面 noindex，
 *   不进 /p/N 体系，避免提交量按乘法膨胀。
 */
export const MODEL_PAGE_MAX_DEPTH = 3;

/** 计算总页数（至少 1） */
export function totalPages(total: number, pageSize: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * 生成 [1, …, current-1, current, current+1, …, last] 形式的页码序列，
 * 首尾恒显，中间用 '…'（省略号）折叠。
 * 避免头部 tag 生成上百个页码链接把 HTML 撑大（Error 1102 的同类开销）。
 */
export function pageWindow(
  current: number,
  last: number,
  span = 1,
): Array<number | 'gap'> {
  if (last <= 1) return [1];
  const out: Array<number | 'gap'> = [];
  const from = Math.max(2, current - span);
  const to = Math.min(last - 1, current + span);
  for (let p = 1; p <= last; p++) {
    if (p === 1 || p === last || (p >= from && p <= to)) {
      out.push(p);
    } else if (out[out.length - 1] !== 'gap') {
      out.push('gap');
    }
  }
  return out;
}
