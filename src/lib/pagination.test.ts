import { describe, it, expect } from 'vitest';
import {
  PAGE_SIZE,
  TAG_PAGE_MAX_DEPTH,
  MODEL_PAGE_MAX_DEPTH,
  totalPages,
  pageWindow,
} from './pagination';

describe('pagination', () => {
  it('PAGE_SIZE 与 /api/prompts 共用同一个常量（改一处不能漏另一处）', () => {
    expect(PAGE_SIZE).toBe(48);
  });

  it('tag / model 分页深度上限都是 3（成本护栏 G1）', () => {
    expect(TAG_PAGE_MAX_DEPTH).toBe(3);
    expect(MODEL_PAGE_MAX_DEPTH).toBe(3);
  });

  it('每维度暴露上限一致：48 × 3 = 144 条', () => {
    expect(PAGE_SIZE * TAG_PAGE_MAX_DEPTH).toBe(144);
    expect(PAGE_SIZE * MODEL_PAGE_MAX_DEPTH).toBe(144);
  });

  describe('totalPages', () => {
    it('至少返回 1', () => {
      expect(totalPages(0)).toBe(1);
      expect(totalPages(1)).toBe(1);
      expect(totalPages(48)).toBe(1);
    });
    it('向上取整', () => {
      expect(totalPages(49)).toBe(2);
      expect(totalPages(96)).toBe(2);
      expect(totalPages(97)).toBe(3);
    });
    it('用真实 tag 规模验算（cinematic 4511 / median 19）', () => {
      expect(totalPages(19)).toBe(1); // median tag 一页装完
      expect(totalPages(80)).toBe(2); // p75
      expect(totalPages(188)).toBe(4); // p90
      expect(totalPages(4511)).toBe(94); // max（48×94=4512），会被 MAX_DEPTH 夹到 3
    });
  });

  describe('pageWindow', () => {
    it('只有一页时只返回 [1]', () => {
      expect(pageWindow(1, 1)).toEqual([1]);
    });

    it('页数不多时全部展开', () => {
      expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
      expect(pageWindow(2, 3)).toEqual([1, 2, 3]);
    });

    it('首尾恒显，中间折叠为 gap', () => {
      expect(pageWindow(1, 10)).toEqual([1, 2, 'gap', 10]);
      expect(pageWindow(10, 10)).toEqual([1, 'gap', 9, 10]);
      expect(pageWindow(5, 10)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10]);
    });

    it('不会为头部 tag 生成上百个链接（HTML 体积护栏）', () => {
      const w = pageWindow(1, 95);
      // 首 + 邻近 + 尾 + gap，不超过 6 个节点
      expect(w.length).toBeLessThanOrEqual(6);
      expect(w[0]).toBe(1);
      expect(w[w.length - 1]).toBe(95);
    });

    it('始终包含当前页与首尾，且 gap 不重复', () => {
      for (let last = 2; last <= 20; last++) {
        for (let cur = 1; cur <= last; cur++) {
          const w = pageWindow(cur, last);
          expect(w).toContain(1);
          expect(w).toContain(last);
          expect(w).toContain(cur);
          const gaps = w.filter((x) => x === 'gap').length;
          const nums = w.filter((x) => x !== 'gap') as number[];
          // 无重复页码
          expect(new Set(nums).size).toBe(nums.length);
          // gap 不连续出现
          expect(gaps).toBeLessThanOrEqual(Math.floor(nums.length / 2));
          // 页码递增
          for (let i = 1; i < nums.length; i++) expect(nums[i]).toBeGreaterThan(nums[i - 1]);
        }
      }
    });
  });
});
