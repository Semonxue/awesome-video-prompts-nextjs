/**
 * PromptCard 数据契约（与 D1 schema 解耦，UI 层只关心展示）
 * Phase 2 会从 D1 JOIN 拼出这个结构传给 GridEngine
 */
export interface PromptCardData {
  /** URL slug（详情页路径用），如 "cinematic-shot-001" */
  slug: string;
  /** 卡片标题 */
  title: string;
  /** 提示词正文（详情页 + 复制用） */
  description: string;
  /** 封面图 URL（R2 自定义域） */
  coverUrl: string | null;
  /** 视频 URL（hover 自动播放） */
  videoUrl: string | null;
  /** 原始来源（Twitter / X URL） */
  sourceUrl: string | null;
  /** 作者名 */
  author: string | null;
  /** 发布日期 ISO 8601 YYYY-MM-DD */
  promptDate: string | null;
  /**
   * 建档时间（D1 存 `YYYY-MM-DD HH:MM:SS`，非 ISO 8601）
   * JSON-LD 的 datePublished / uploadDate 兜底要用，取值前必须过 toW3CDate
   */
  createdAt: string;
  /**
   * 最后修改时间（D1 存 `YYYY-MM-DD HH:MM:SS`，非 ISO 8601）
   * JSON-LD 的 dateModified 用，取值前必须过 toW3CDate
   */
  updatedAt: string;
  /** 模型 keys（slug 形式，如 "veo3" / "sora"） */
  models: ModelRef[];
  /** 标签 keys（slug 形式） */
  tags: TagRef[];
}

export interface ModelRef {
  /** 模型 slug（数据库主键） */
  slug: string;
  /** 显示名（按当前 locale 翻译） */
  name: string;
}

export interface TagRef {
  /** 标签 slug */
  slug: string;
  /** 显示名（按当前 locale 翻译） */
  name: string;
}

/**
 * Phase 1 占位数据 — Phase 2 接 D1 后删除
 * 用于空网格骨架展示
 */
export const EMPTY_PROMPTS: PromptCardData[] = [];

/**
 * 传给 Header 的 tag 上限（2026-08-07 CPU 优化）
 *
 * 背景：Header 是客户端组件，props 必须全量序列化进 RSC 载荷嵌入 HTML。
 *   之前各页面把全量 1486 个 tag 传进去，而 Header 默认只渲染 11 个
 *   （展开也只是本地 state）。实测首页 HTML 303KB 里有 235KB（77%）
 *   是这份载荷，含 1520 个 tag/model 对象 —— 页面上只渲染了 28 个 chip。
 *   这是每个请求都要付的序列化 CPU，是 Error 1102 的主因之一。
 *
 * 取 40：默认显示 11 个，展开后仍有富余；想看全部 tag 的用户走 /tags 页。
 * models 只有 49 个（约 4KB），无需限制。
 */
export const HEADER_TAG_LIMIT = 40;

/**
 * 列表页 description 截断长度（2026-10-15 Workers CPU 优化）
 *
 * 背景（实测 /en/tags/cinematic）：
 *   - PromptCard 是 `'use client'`，props 会全量序列化进 RSC flight payload 再嵌进 HTML。
 *   - 卡片 UI 只渲染 `truncate(description, 180)`，但服务端下发的是**完整正文**。
 *   - 实测一页 48 条：description 合计 188,871 B（中位 2,475 B，最大 17,846 B），
 *     占 flight payload 227,238 B 的绝大部分；单条最长 17.8 KB。
 *   - 也就是说 UI 只用掉 180 字符，其余全是每次请求都要付的序列化 CPU。
 *
 * 做法：列表页只下发摘要，复制全文时由客户端按 slug 懒加载
 *       （GET /api/prompt/[slug]，走既有 per-slug 缓存）。
 *
 * 为什么截断值与 UI 的 180 一致：
 *   - 卡片渲染正好只显示这么多，摘要 = 完整可见内容，不丢任何用户能看到的信息。
 *   - 单一常量，UI 与数据层不会各自漂移。
 *
 * ⚠️ 详情页**绝不能**截断：正文是 SEO 主体，且 JSON-LD 需要全文。
 *    详情页走 getPromptBySlug（不传 descriptionLimit），保持原样。
 */
export const LIST_DESCRIPTION_LIMIT = 180;

/**
 * 摘要被截断时的结尾标记
 *
 * PromptCard 靠它判断「本地这份是摘要，复制前要去拉全文」。
 * 用哨兵字符而非布尔字段：布尔字段会给每条 item 加约 20 字节 × 48 条 ≈ 1 KB，
 * 而哨兵只在真正被截断的条目上出现（绝大多数条目正文都 > 180 字符，等价）。
 *
 * 不加标记的失败模式很隐蔽：用户复制到的是被腰斩的提示词，却没有任何报错。
 */
export const DESCRIPTION_TRUNCATED_SUFFIX = '…';

