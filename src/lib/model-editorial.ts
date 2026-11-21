/**
 * 模型页编辑性内容（2026-11-21）
 *
 * 背景：2026-10-22 的内容页化（content-pages.ts）是「数据槽位 + 固定句式」，
 * 同类页面文案骨架重复度高，Google 可能按 scaled content 处理。
 * 本层给**少数热门模型**补充逐页撰写的独特内容：核实过的模型事实、
 * 基于站内真实 prompt 观察的写作技巧、精选示例点评、独特 FAQ。
 *
 * 铁律：
 * 1. **零运行时成本** —— 内容来自 data/model-content.json 的静态 import，
 *    构建时打进 bundle，不新增任何 D1 / R2 / 网络查询。
 * 2. **零虚构** —— facts 只写多来源核实过的事实（sources 列出出处），
 *    数字类库内统计仍由 content-pages.ts 从全量聚合派生，两层不混用。
 * 3. **数据不是脚本** —— 内容维护只改 JSON；挑选新模型时按
 *    「近30天站内新增 + 全网热度/发布事件 + 站内库存」三个维度选。
 * 4. **纯函数、可单测**（model-editorial.test.ts 锁数据完整性）。
 */
import contentData from '../../data/model-content.json';
import type { FaqItem } from '@/lib/content-pages';

export interface EditorialFact {
  label: string;
  value: string;
}

export interface EditorialTip {
  title: string;
  body: string;
}

export interface EditorialExample {
  /** 站内详情页 slug（撰写时已核实存在） */
  slug: string;
  title: string;
  comment: string;
}

export interface EditorialSource {
  label: string;
  url: string;
}

export interface ModelEditorial {
  /** 内容核实日期（YYYY-MM-DD），展示给读者，也是维护提醒 */
  reviewedAt: string;
  /** meta description 用（≤160 字符） */
  summary: string;
  overview: string[];
  facts: EditorialFact[];
  tips: EditorialTip[];
  examples: EditorialExample[];
  faq: FaqItem[];
  sources: EditorialSource[];
}

const editorials = contentData as Record<string, ModelEditorial>;

/** 该模型是否有编辑性内容（没有 → 页面维持原数据派生内容，行为不变） */
export function getModelEditorial(modelSlug: string): ModelEditorial | null {
  return editorials[modelSlug] ?? null;
}

/**
 * 合并 FAQ：编辑性 FAQ 在前（独特内容优先），数据派生 FAQ 在后（带实时库内数字），
 * 按问题文本去重。FAQPage 结构化数据与页面正文共用这一份结果。
 */
export function mergeEditorialFaq(editorial: FaqItem[], dataFaq: FaqItem[]): FaqItem[] {
  const seen = new Set(editorial.map((f) => f.question));
  return [...editorial, ...dataFaq.filter((f) => !seen.has(f.question))];
}