/**
 * 模型页编辑性内容的数据完整性（2026-11-21）
 *
 * 内容是手工撰写的数据（data/model-content.json），这里锁住几条不变量：
 *   1. 每个条目结构完整（缺字段会让页面渲染出空段）
 *   2. summary ≤ 160 字符（meta description 截断线）
 *   3. 精选示例的 slug 形如站内真实 slug（tweetid-描述），且互不重复
 *   4. FAQ 合并去重逻辑正确（编辑性优先，数据派生补位）
 *   5. 未收录编辑内容的模型返回 null（页面行为不变）
 */
import { describe, it, expect } from 'vitest';
import { getModelEditorial, mergeEditorialFaq } from './model-editorial';
import contentData from '../../data/model-content.json';

const slugs = Object.keys(contentData);

describe('model-content.json 数据完整性', () => {
  it('收录了 5 个热门模型', () => {
    expect(slugs.sort()).toEqual(
      ['kling4flash', 'minimaxh3', 'pixverse', 'seedance2', 'seedance25'].sort(),
    );
  });

  it.each(slugs)('%s：结构完整', (slug) => {
    const e = getModelEditorial(slug)!;
    expect(e).not.toBeNull();
    expect(e.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.overview.length).toBeGreaterThanOrEqual(2);
    expect(e.facts.length).toBeGreaterThanOrEqual(4);
    expect(e.tips.length).toBeGreaterThanOrEqual(3);
    expect(e.examples.length).toBe(3);
    expect(e.faq.length).toBeGreaterThanOrEqual(3);
    expect(e.sources.length).toBeGreaterThanOrEqual(1);
    for (const s of e.sources) expect(s.url).toMatch(/^https:\/\//);
  });

  it.each(slugs)('%s：summary 不超过 160 字符（meta description）', (slug) => {
    expect(getModelEditorial(slug)!.summary.length).toBeLessThanOrEqual(160);
  });

  it.each(slugs)('%s：精选示例 slug 合法且互不重复', (slug) => {
    const examples = getModelEditorial(slug)!.examples;
    const seen = new Set<string>();
    for (const ex of examples) {
      expect(ex.slug).toMatch(/^\d{10,}-[a-z0-9-]+$/);
      expect(ex.title.length).toBeGreaterThan(0);
      expect(ex.comment.length).toBeGreaterThan(40);
      expect(seen.has(ex.slug), `重复示例: ${ex.slug}`).toBe(false);
      seen.add(ex.slug);
    }
  });

  it('未收录编辑内容的模型返回 null', () => {
    expect(getModelEditorial('veo3')).toBeNull();
    expect(getModelEditorial('nonexistent-model')).toBeNull();
  });
});

describe('mergeEditorialFaq', () => {
  const editorial = [
    { question: 'What is X?', answer: 'editorial answer' },
    { question: 'How long are clips?', answer: 'up to 30s' },
  ];
  const dataFaq = [
    { question: 'What is X?', answer: 'data answer (should be dropped)' },
    { question: 'How many X prompts are available?', answer: '123' },
  ];

  it('编辑性 FAQ 在前，数据派生补位，按问题去重', () => {
    const merged = mergeEditorialFaq(editorial, dataFaq);
    expect(merged.map((f) => f.question)).toEqual([
      'What is X?',
      'How long are clips?',
      'How many X prompts are available?',
    ]);
    expect(merged[0].answer).toBe('editorial answer');
  });

  it('空输入不产生多余条目', () => {
    expect(mergeEditorialFaq([], [])).toEqual([]);
    expect(mergeEditorialFaq(editorial, [])).toEqual(editorial);
  });
});