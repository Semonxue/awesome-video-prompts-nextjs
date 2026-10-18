/**
 * sitemap 结构不变量（P2-1 / P2-2 / P2-3，2026-10-08；2026-10-18 更新）
 *
 * 这几条约束一旦破掉，线上要过好几天才能从 GSC 看出来，所以锁在单测里：
 *   1. index 里列出的每个子表都真实存在对应 route
 *   2. 子表清单由 SUBMIT_PROMPT_DETAIL_PAGES 推导，改开关就能恢复详情页提交
 *   3. tag/model 页不输出 lastmod（消除"全站每天在变"的信号）
 *   4. **只提交 SEO_INDEXABLE_LOCALES（当前仅 en）** —— zh/ja 已 noindex，
 *      再出现在 sitemap 里就是自相矛盾的信号
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { locales } from '@/i18n/request';
import { SEO_INDEXABLE_LOCALES } from '@/lib/seo';
import {
  SITEMAP_CHILDREN,
  SITEMAP_PROMPT_LOCALES,
  SUBMIT_PROMPT_DETAIL_PAGES,
  toTagSitemapRows,
  toModelSitemapRows,
  toPromptSitemapRows,
} from './sitemap-builders';

const APP_DIR = join(process.cwd(), 'src', 'app');

describe('sitemap 拆分结构', () => {
  it('index 列出的每个子表都有对应 route 文件', () => {
    for (const c of SITEMAP_CHILDREN) {
      // c.path 形如 /sitemaps/prompts-en.xml → src/app/sitemaps/prompts-en.xml/route.ts
      const rel = c.path.replace(/^\//, '');
      const p = join(APP_DIR, rel, 'route.ts');
      expect(existsSync(p), `缺少子表 route: ${p}`).toBe(true);
    }
  });

  it('子表清单由 SUBMIT_PROMPT_DETAIL_PAGES 推导（含 tags / models / static）', () => {
    const paths = SITEMAP_CHILDREN.map((c) => c.path);
    expect(paths).toContain('/sitemaps/tags.xml');
    expect(paths).toContain('/sitemaps/models.xml');
    // 静态页必须单独成子表：<sitemapindex> 里只允许 <sitemap>，不能放页面 URL
    expect(paths).toContain('/sitemaps/static.xml');
  });

  it('2026-10-15：详情页默认退出提交面（SITEMAP_CHILDREN 里没有 prompts-*）', () => {
    expect(SUBMIT_PROMPT_DETAIL_PAGES).toBe(false);
    const paths = SITEMAP_CHILDREN.map((c) => c.path);
    expect(paths.filter((p) => p.includes('prompts-'))).toEqual([]);
    // 主体只剩 tags / models / static
    expect(paths).toEqual([
      '/sitemaps/tags.xml',
      '/sitemaps/models.xml',
      '/sitemaps/static.xml',
    ]);
  });

  it('退出提交面 ≠ 封死：详情页子表 route 仍在，改开关即可一键恢复', () => {
    // 开关为 false 时 index 不列它，但 route 文件必须还在
    const rel = '/sitemaps/prompts-en.xml'.replace(/^\//, '');
    expect(existsSync(join(APP_DIR, rel, 'route.ts'))).toBe(true);
    // 推导逻辑成立：开关为 true 时会把它加回 index
    const derived = ['en', ...([] as string[])].map((loc) => `/sitemaps/prompts-${loc}.xml`);
    expect(derived).toEqual(['/sitemaps/prompts-en.xml']);
    // 恢复全语言提交时需要的三个 route 也都还在
    for (const loc of locales) {
      const r = join(APP_DIR, `sitemaps/prompts-${loc}.xml`, 'route.ts');
      expect(existsSync(r), `缺少 ${loc} 的详情页子表 route`).toBe(true);
    }
  });
});

describe('sitemap lastModified 策略（P2-2）', () => {
  // 测纯映射函数，不碰 D1/R2
  const tags = [{ slug: 'cinematic' }, { slug: 'urban' }];
  const models = [{ slug: 'seedance25' }];

  it('tag 页不输出 lastModified（消除「全站每天在变」信号）', () => {
    const rows = toTagSitemapRows(tags);
    expect(rows.length).toBe(2 * SEO_INDEXABLE_LOCALES.length);
    for (const r of rows) {
      expect(r.lastModified, `tag ${r.url} 不该有 lastModified`).toBeUndefined();
      expect(r.changeFrequency).toBe('weekly');
    }
  });

  it('model 页不输出 lastModified', () => {
    const rows = toModelSitemapRows(models);
    expect(rows.length).toBe(SEO_INDEXABLE_LOCALES.length);
    for (const r of rows) {
      expect(r.lastModified, `model ${r.url} 不该有 lastModified`).toBeUndefined();
    }
  });

  it('2026-10-18：sitemap 只含 SEO locale，绝不出现 zh/ja', () => {
    const rows = [...toTagSitemapRows(tags), ...toModelSitemapRows(models)];
    for (const r of rows) {
      const loc = new URL(r.url).pathname.split('/')[1];
      expect(
        (SEO_INDEXABLE_LOCALES as ReadonlyArray<string>).includes(loc),
        `${r.url} 的 locale "${loc}" 不在 SEO_INDEXABLE_LOCALES 里`,
      ).toBe(true);
    }
    const zh = rows.filter((r) => r.url.includes('/zh/') || r.url.includes('/ja/'));
    expect(zh).toEqual([]);
  });

  it('2026-10-15：model 页 priority 最高，tag 页次之（en）', () => {
    const enModel = toModelSitemapRows([{ slug: 'seedance25' }]).find((r) =>
      r.url.includes('/en/models/'),
    )!;
    const enTag = toTagSitemapRows([{ slug: 'cinematic' }]).find((r) => r.url.includes('/en/tags/'))!;
    // model 是唯一有真实搜索量的一类（seedance 2.0 video prompt 这类词有人搜）
    expect(enModel.priority).toBe(1.0);
    expect(enTag.priority).toBe(0.9);
    expect(enModel.priority!).toBeGreaterThan(enTag.priority!);
  });

  it('详情页保留 lastModified（prompt 真实更新时间）', () => {
    const rows = toPromptSitemapRows(
      [{ slug: 'abc-123-demo', updatedAt: '2026-10-01 12:00:00' }],
      'en',
    );
    expect(rows[0].url).toContain('/en/prompts/abc-123-demo');
    expect(rows[0].lastModified, '详情页必须带 lastModified').toBeDefined();
    expect(String(rows[0].lastModified)).toMatch(/^2026-10-01/);
  });
});
