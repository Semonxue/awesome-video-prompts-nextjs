/**
 * SEO locale 决策不变量（2026-10-18）
 *
 * 决策背景：只把 en 送去 SEO，zh/ja 一律 `noindex, follow`。
 * 这三处必须永远一致，否则会给 Google 互相矛盾的信号：
 *   ① sitemap 提交哪些 locale
 *   ② hreflang（alternates.languages）列哪些 locale
 *   ③ 页面 robots 指令允许哪些 locale 被索引
 *
 * 只要有人把 zh 加进 SEO_INDEXABLE_LOCALES 却忘了处理 noindex，
 * 或者反过来，这些用例就会红。
 */
import { describe, it, expect } from 'vitest';
import { locales } from '@/i18n/request';
import {
  SEO_INDEXABLE_LOCALES,
  SEO_PRIMARY_LOCALE,
  isSeoIndexable,
  buildSeoAlternates,
  seoRobots,
} from './seo';

describe('SEO_INDEXABLE_LOCALES 单一真源', () => {
  it('当前只把 en 送去 SEO', () => {
    expect(SEO_INDEXABLE_LOCALES).toEqual(['en']);
  });

  it('主语言必须出现在可索引列表里', () => {
    expect((SEO_INDEXABLE_LOCALES as ReadonlyArray<string>).includes(SEO_PRIMARY_LOCALE)).toBe(true);
  });

  it('每个 SEO locale 都必须是站内真实存在的 locale', () => {
    for (const loc of SEO_INDEXABLE_LOCALES) {
      expect(locales, `${loc} 不是有效 locale`).toContain(loc);
    }
  });

  it('zh / ja 明确不可索引', () => {
    expect(isSeoIndexable('en')).toBe(true);
    expect(isSeoIndexable('zh')).toBe(false);
    expect(isSeoIndexable('ja')).toBe(false);
  });

  it('未知 / 畸形 locale 不会被误判为可索引', () => {
    for (const bad of ['', 'zh-CN', 'en-US', 'ja/ja', 'EN']) {
      expect(isSeoIndexable(bad), `"${bad}" 不该被判定可索引`).toBe(false);
    }
  });
});

describe('buildSeoAlternates（hreflang）', () => {
  const languages = buildSeoAlternates((loc) => `https://example.com/${loc}/page`);

  it('只列可索引 locale，不出现 zh / ja', () => {
    expect(Object.keys(languages).sort()).toEqual(['en', 'x-default']);
    expect(languages.en).toBe('https://example.com/en/page');
  });

  it('x-default 指向主语言', () => {
    expect(languages['x-default']).toBe(languages[SEO_PRIMARY_LOCALE]);
  });

  it('hreflang 组里没有任何 noindex 目标（否则整组信号会被忽略）', () => {
    for (const [code, url] of Object.entries(languages)) {
      if (code === 'x-default') continue;
      expect(isSeoIndexable(code), `hreflang 里出现了不可索引的 "${code}"`).toBe(true);
      expect(url).toContain(`/${code}/`);
    }
  });
});

describe('seoRobots', () => {
  it('en 默认不输出 robots（即默认可索引）', () => {
    expect(seoRobots('en')).toBeUndefined();
  });

  it('zh / ja 一律 noindex, follow（仍跟随内链，保留发现路径）', () => {
    for (const loc of ['zh', 'ja']) {
      expect(seoRobots(loc)).toEqual({ index: false, follow: true });
    }
  });

  it('en 的低价值页（分页 / 搜索 / 筛选）依然可以被单独 noindex', () => {
    expect(seoRobots('en', { noindex: true })).toEqual({ index: false, follow: true });
  });

  it('noindex 永远是 follow —— 否则会切断详情页的相关推荐链路', () => {
    for (const loc of ['en', 'zh', 'ja']) {
      const r = seoRobots(loc, { noindex: true });
      expect(r).toEqual({ index: false, follow: true });
    }
  });
});
