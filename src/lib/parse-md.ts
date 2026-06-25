/**
 * MD 文件解析工具函数（可独立测试）
 * 被 scripts/import-md-to-d1.ts 和单元测试共同依赖
 */

/** 从路径判断语言 */
export function detectLocale(filePath: string): string {
  if (filePath.includes('/zh-cn/') || filePath.includes('\\zh-cn\\')) return 'zh';
  if (filePath.includes('/ja/') || filePath.includes('\\ja\\')) return 'ja';
  return 'en';
}

/** 从文件名提取 slug: 2025-12-001-fancy-title.md → fancy-title */
export function extractSlug(filename: string): string {
  // 跳过草稿
  if (filename.startsWith('_')) return '';
  // 格式: YYYY-MM-XXX-slug.md 或 YYYY-MM-DD-XXX-slug.md
  const match = filename.match(/^\d{4}-\d{2}(?:-\d{2})?-\d+-(.+)\.md$/);
  return match ? match[1] : filename.replace(/\.md$/, '');
}

/**
 * 解析日期，支持多种格式：
 *   - Date 对象（gray-matter 自动解析）→ toISOString().slice(0,10)
 *   - YYYY-MM-DD             → 原样
 *   - YYYY-MM                → 补 -01
 *   - YYYY-MM-DDTHH:MM:SSZ  → 截取日期部分（ISO 8601）
 *   - YYYY/MM/DD             → 转换分隔符
 * 返回值始终为 YYYY-MM-DD 或 null
 */
export function parseDate(dateStr: string | Date | undefined): string | null {
  if (!dateStr) return null;
  // gray-matter 会把 `date: 2025-02-03` 解析成 JS Date 对象
  if (dateStr instanceof Date) {
    if (isNaN(dateStr.getTime())) return null;
    return dateStr.toISOString().slice(0, 10);
  }
  if (typeof dateStr !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  if (/^\d{4}-\d{2}$/.test(dateStr)) return `${dateStr}-01`;
  if (/^\d{4}-\d{2}-\d{2}T/.test(dateStr)) return dateStr.slice(0, 10);
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(dateStr)) return dateStr.replace(/\//g, '-');
  return null;
}

/** front matter → 标准 PromptRow */
export interface ParsedPromptMeta {
  title: string;
  description: string;
  videoUrl: string | null;
  coverUrl: string | null;
  sourceUrl: string | null;
  author: string | null;
  promptDate: string | null;
  tags: string[];
  models: string[];
  isDraft: boolean;
}

export function parsePromptMeta(data: Record<string, unknown>, content: string): ParsedPromptMeta {
  const isDraft = data.draft === true;

  // models 字段兼容 model / models
  let models: string[] = [];
  if (data.models) {
    models = Array.isArray(data.models) ? (data.models as string[]).map(m => m.trim().toLowerCase()) : [String(data.models).trim().toLowerCase()];
  } else if (data.model) {
    models = Array.isArray(data.model) ? (data.model as string[]).map(m => m.trim().toLowerCase()) : [String(data.model).trim().toLowerCase()];
  }

  // tags 标准化
  let tags: string[] = [];
  if (data.tags) {
    if (typeof data.tags === 'string') {
      tags = data.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    } else if (Array.isArray(data.tags)) {
      tags = (data.tags as string[]).map(t => t.trim().toLowerCase()).filter(Boolean);
    }
  }

  return {
    title: String(data.title || ''),
    // description 优先用 front matter 字段（老 MD 用 `description: |` YAML block 写在 front matter），
    // fallback 到 markdown body（content.trim()）
    description: data.description
      ? String(data.description).trim()
      : content.trim(),
    videoUrl: data.video ? String(data.video) : null,
    coverUrl: data.image ? String(data.image) : (data.cover ? String(data.cover) : null),
    sourceUrl: data.source_url ? String(data.source_url) : null,
    author: data.author ? String(data.author) : null,
    promptDate: parseDate(data.date as string | Date | undefined),
    tags,
    models,
    isDraft,
  };
}
