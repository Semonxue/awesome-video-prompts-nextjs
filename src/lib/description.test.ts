import { describe, it, expect } from 'vitest';
import { clampDescription, isTruncatedSummary } from './description';
import { LIST_DESCRIPTION_LIMIT, DESCRIPTION_TRUNCATED_SUFFIX } from '@/components/types';

describe('clampDescription', () => {
  it('短于 limit 的原文原样返回（不截断、不加标记）', () => {
    expect(clampDescription('short prompt', 180)).toBe('short prompt');
  });

  it('超长时截断到 limit 且带省略标记', () => {
    const long = 'a'.repeat(500);
    const out = clampDescription(long, 180);
    // 180 字符 + 1 个省略号字符
    expect(out).toHaveLength(181);
    expect(out.endsWith(DESCRIPTION_TRUNCATED_SUFFIX)).toBe(true);
    expect(out.slice(0, 180)).toBe('a'.repeat(180));
  });

  it('恰好等于 limit 的不加标记（边界）', () => {
    const exact = 'b'.repeat(180);
    const out = clampDescription(exact, 180);
    expect(out).toBe(exact);
    expect(isTruncatedSummary(out)).toBe(false);
  });

  it('折叠连续空白，与 PromptCard.truncate 语义一致', () => {
    // 折叠后可能变短 → 不应被判定为截断
    const messy = `  hello\n\n   world \t tab  `;
    const out = clampDescription(messy, 180);
    expect(out).toBe('hello world tab');
    expect(isTruncatedSummary(out)).toBe(false);
  });

  it('原始超长但折叠空白后变短 → 不截断（先折叠再判长度）', () => {
    // 50 个 'a' + 200 个换行 = 原始 250 字符，但语义上只有 50 字符的内容
    const padded = 'a'.repeat(50) + '\n'.repeat(200);
    expect(padded.length).toBeGreaterThan(180);
    const out = clampDescription(padded, 180);
    expect(out).toBe('a'.repeat(50));
    expect(isTruncatedSummary(out)).toBe(false);
  });

  it('空值安全：null / undefined / 空串都返回空串', () => {
    expect(clampDescription(null, 180)).toBe('');
    expect(clampDescription(undefined, 180)).toBe('');
    expect(clampDescription('', 180)).toBe('');
  });

  it('列表页常量 180 与卡片渲染长度一致（改一处不能漏另一处）', () => {
    // PromptCard 渲染 truncate(description, 180)，数据层也必须传 180
    expect(LIST_DESCRIPTION_LIMIT).toBe(180);
  });
});

describe('isTruncatedSummary', () => {
  it('带标记的超长摘要 → true', () => {
    const out = clampDescription('c'.repeat(500), LIST_DESCRIPTION_LIMIT);
    expect(isTruncatedSummary(out)).toBe(true);
  });

  it('未截断的短文本 → false', () => {
    expect(isTruncatedSummary('plain text')).toBe(false);
  });

  it('空值 → false', () => {
    expect(isTruncatedSummary('')).toBe(false);
    expect(isTruncatedSummary(null)).toBe(false);
    expect(isTruncatedSummary(undefined)).toBe(false);
  });

  it('只有一个省略号 → false（避免误判）', () => {
    expect(isTruncatedSummary(DESCRIPTION_TRUNCATED_SUFFIX)).toBe(false);
  });

  it('详情页全文（即便以 … 结尾）也判 true → 会多发一次请求，但不会静默复制错内容', () => {
    // 误判代价不对称：假阴性会静默给用户腰斩内容，假阳性只是多一次 fetch
    const fullEndsWithEllipsis = `real full description${DESCRIPTION_TRUNCATED_SUFFIX}`;
    expect(isTruncatedSummary(fullEndsWithEllipsis)).toBe(true);
  });
});
