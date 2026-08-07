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

