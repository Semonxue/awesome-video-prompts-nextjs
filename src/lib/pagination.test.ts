import { describe, it, expect } from 'vitest';
import {
  PAGE_SIZE,
  TAG_PAGE_MAX_DEPTH,
  MODEL_PAGE_MAX_DEPTH,
  MIN_PAGE_ITEMS,
  totalPages,
  pageWindow,
  lastUsablePage,
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

  describe('lastUsablePage（剔除薄末页，2026-10-15）', () => {
    it('内容量不足一页时只有 page 1', () => {
      expect(lastUsablePage(19, 3)).toBe(1);
      expect(lastUsablePage(48, 3)).toBe(1);
    });

    it('末页刚好 ≥12 条时保留', () => {
      // 96 = 48×2 → 第 2 页有 48 条
      expect(lastUsablePage(96, 3)).toBe(2);
      // 60 = 48 + 12 → 第 2 页正好 12 条，保留
      expect(lastUsablePage(60, 3)).toBe(2);
    });

    it('末页 <12 条时回退到上一页（真实 tag 分布）', () => {
      // wuxia count=49 → /p/2 只剩 1 条 → 回退，page2 不存在
      expect(lastUsablePage(49, 3)).toBe(1);
      // handheld-camera count=52 → 只剩 4 条 → 回退
      expect(lastUsablePage(52, 3)).toBe(1);
      // romantic count=53 → 只剩 5 条 → 回退
      expect(lastUsablePage(53, 3)).toBe(1);
      // count=61 → 只剩 13 条 → 保留 page2
      expect(lastUsablePage(61, 3)).toBe(2);
    });

    it('回退后仍要 ≥MIN_PAGE_ITEMS 才算有效', () => {
      // count=97 → p2 有 48 条(达标)，p3 有 1 条(不达标) → last=2
      expect(lastUsablePage(97, 3)).toBe(2);
      // count=144 → p3 正好满 48 条 → last=3
      expect(lastUsablePage(144, 3)).toBe(3);
      // count=155 → p3 仍是满的 48 条（第 4 页那 11 条被 maxDepth 截掉，
      //   不是"末页变薄"）→ 不回退
      expect(lastUsablePage(155, 3)).toBe(3);
      // 真正的回退场景：总数只够 2 页、且第 2 页不足 12 条
      // count=58 → p2 只有 10 条 → 回退到 1
      expect(lastUsablePage(58, 3)).toBe(1);
      // count=59 → p2 有 11 条 → 仍回退
      expect(lastUsablePage(59, 3)).toBe(1);
      // count=60 → p2 有 12 条 → 保留
      expect(lastUsablePage(60, 3)).toBe(2);
    });

    it('永远不超过深度上限', () => {
      expect(lastUsablePage(5000, 3)).toBe(3);
      expect(lastUsablePage(5000, 1)).toBe(1);
    });

    it('不会把 page 1 本身回退掉', () => {
      expect(lastUsablePage(0, 3)).toBe(1);
      expect(lastUsablePage(1, 3)).toBe(1);
    });

    it('单调性：内容量增加时 last 不会变小', () => {
      let prev = 1;
      for (let n = 1; n <= 300; n += 7) {
        const l = lastUsablePage(n, 3);
        expect(l).toBeGreaterThanOrEqual(prev);
        prev = l;
      }
    });

    it('MIN_PAGE_ITEMS 的取值符合文档约定', () => {
      expect(MIN_PAGE_ITEMS).toBe(12);
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
