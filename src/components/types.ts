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