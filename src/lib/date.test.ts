import { describe, it, expect } from 'vitest';
import { toW3CDate } from './date';

describe('toW3CDate', () => {
  // D1 实测格式（本地 sqlite 全量 4479 行）：updated_at / created_at 均为空格分隔
  it('把 D1 的空格分隔时间戳转成 W3C', () => {
    expect(toW3CDate('2026-06-26 09:22:28')).toBe('2026-06-26T09:22:28Z');
  });

  it('已经是 ISO 的原样返回（不重复处理）', () => {
    expect(toW3CDate('2026-06-26T09:22:28Z')).toBe('2026-06-26T09:22:28Z');
    expect(toW3CDate('2026-06-26T09:22:28.123Z')).toBe('2026-06-26T09:22:28.123Z');
    // 带时区偏移的也应原样保留
    expect(toW3CDate('2026-06-26T09:22:28+08:00')).toBe('2026-06-26T09:22:28+08:00');
  });

  // prompt_date 存的是纯日期，本身就是合法的 W3C
  it('纯日期原样返回', () => {
    expect(toW3CDate('2026-06-16')).toBe('2026-06-16');
  });

  it('T 分隔的时间戳也走同一条转换路径', () => {
    expect(toW3CDate('2026-06-26T09:22:28')).toBe('2026-06-26T09:22:28Z');
  });

  it('两侧空白先 trim 再处理', () => {
    expect(toW3CDate('  2026-06-26 09:22:28  ')).toBe('2026-06-26T09:22:28Z');
  });

  // 无法识别时必须返回 undefined，让调用方省略该字段，
  // 绝不能输出半合法的日期让 Google 判 Invalid date
  it('无法识别的值返回 undefined', () => {
    expect(toW3CDate('not a date')).toBeUndefined();
    expect(toW3CDate('2026-13-45')).toBeUndefined();
    expect(toW3CDate('2026/06/26')).toBeUndefined();
  });

  it('空值返回 undefined', () => {
    expect(toW3CDate(null)).toBeUndefined();
    expect(toW3CDate(undefined)).toBeUndefined();
    expect(toW3CDate('')).toBeUndefined();
    expect(toW3CDate('   ')).toBeUndefined();
  });

  // 关键不变量：输出绝不含空格（空格分隔是 D1 的原生格式，漏出去就是非法 ISO）
  it('输出永远不含空格', () => {
    const samples = [
      '2026-06-26 09:22:28',
      '2026-06-26 00:00:00',
      '2026-06-16',
      '2026-12-31 23:59:59',
    ];
    for (const s of samples) {
      expect(toW3CDate(s)).not.toMatch(/\s/);
    }
  });
});
