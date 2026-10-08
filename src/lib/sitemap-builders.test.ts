/**
 * sitemap 结构不变量（P2-1 / P2-2 / P2-3，2026-10-08）
 *
 * 这几条约束一旦破掉，线上要过几天才能从 GSC 看出来，所以锁在单测里：
 *   1. index 里列出的每个子表都真实存在对应 route
 *   2. 子表清单由 SITEMAP_PROMPT_LOCALES 推导，改常量就能恢复 zh/ja 提交
 *   3. tag/model 页不输出 lastmod（消除"全站每天在变"的信号）
 *   4. 提交量确实大幅收敛（防手滑把 en-only 改回全量却没人发现）
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { locales } from '@/i18n/request';
import {
  SITEMAP_CHILDREN,
  SITEMAP_PROMPT_LOCALES,
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

  it('子表清单由 SITEMAP_PROMPT_LOCALES 推导（含 tags / models）', () => {
    const paths = SITEMAP_CHILDREN.map((c) => c.path);
    for (const loc of SITEMAP_PROMPT_LOCALES) {
      expect(paths).toContain(`/sitemaps/prompts-${loc}.xml`);
    }
    expect(paths).toContain('/sitemaps/tags.xml');
    expect(paths).toContain('/sitemaps/models.xml');
    // 每个 locale 恰好一个子表
    const promptPaths = paths.filter((p) => p.includes('prompts-'));
    expect(promptPaths.length).toBe(SITEMAP_PROMPT_LOCALES.length);
  });

  it('P2-3：当前只提交 en 的 prompt 详情页（zh/ja 不进 sitemap）', () => {
    expect(SITEMAP_PROMPT_LOCALES).toEqual(['en']);
    const paths = SITEMAP_CHILDREN.map((c) => c.path);
    expect(paths).not.toContain('/sitemaps/prompts-zh.xml');
    expect(paths).not.toContain('/sitemaps/prompts-ja.xml');
  });

  it('恢复全语言提交只需要改一行常量（推导关系成立）', () => {
    // 模拟把常量改成全量时的推导结果
    const derived = locales.map((loc) => `/sitemaps/prompts-${loc}.xml`);
    expect(derived).toEqual(['/sitemaps/prompts-en.xml', '/sitemaps/prompts-zh.xml', '/sitemaps/prompts-ja.xml']);
    for (const p of derived) {
      const rel = p.replace(/^\//, '');
      expect(existsSync(join(APP_DIR, rel, 'route.ts')), `恢复全量时缺少 ${p} 的 route`).toBe(true);
    }
  });
});

describe('sitemap lastModified 策略（P2-2）', () => {
  // 测纯映射函数，不碰 D1/R2
  const tags = [{ slug: 'cinematic' }, { slug: 'urban' }];
  const models = [{ slug: 'seedance25' }];

  it('tag 页不输出 lastModified（消除「全站每天在变」信号）', () => {
    const rows = toTagSitemapRows(tags);
    expect(rows.length).toBe(2 * locales.length);
    for (const r of rows) {
      expect(r.lastModified, `tag ${r.url} 不该有 lastModified`).toBeUndefined();
      expect(r.changeFrequency).toBe('weekly');
    }
  });

  it('model 页不输出 lastModified', () => {
    const rows = toModelSitemapRows(models);
    expect(rows.length).toBe(locales.length);
    for (const r of rows) {
      expect(r.lastModified, `model ${r.url} 不该有 lastModified`).toBeUndefined();
    }
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
