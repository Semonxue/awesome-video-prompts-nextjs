/**
 * legacy-url.ts 单元测试
 *
 * 重点覆盖 2026-09-08 的行为变更：旧 prompt URL 不再直接 301，
 * 而是返回 legacyPrompt 动作交给 /api/legacy-prompt 做存在性检查。
 */
import { describe, it, expect } from 'vitest';
import { resolveLegacyAction } from './legacy-url';

describe('resolveLegacyAction', () => {
  it('根路径交给 intlMiddleware（返回 null）', () => {
    expect(resolveLegacyAction('/', '')).toBeNull();
  });

  it('已是新站格式的路径不处理', () => {
    expect(resolveLegacyAction('/en/tags/smile', '')).toBeNull();
    expect(resolveLegacyAction('/zh/prompts/2096144016089780321-flying-dinosaur', '')).toBeNull();
    expect(resolveLegacyAction('/en/about', '')).toBeNull();
  });

  it('去尾斜杠 + 补 locale', () => {
    expect(resolveLegacyAction('/tags/smile/', '')).toEqual({
      kind: 'redirect',
      to: '/en/tags/smile',
    });
  });

  it('保留 query string', () => {
    expect(resolveLegacyAction('/tags/smile/', '?page=2')).toEqual({
      kind: 'redirect',
      to: '/en/tags/smile?page=2',
    });
  });

  it('旧 locale 前缀映射 zh-cn → zh', () => {
    expect(resolveLegacyAction('/zh-cn/prompts/2026-02/20191519750160-3540-demo/', '')).toEqual({
      kind: 'legacyPrompt',
      locale: 'zh',
      slug: '20191519750160-3540-demo',
    });
  });

  it('旧 prompt 格式 → legacyPrompt（不猜目标，交给存在性检查）', () => {
    expect(
      resolveLegacyAction('/ja/prompts/2026-04/20487885870181167-647244-karuta-duel-dog/', ''),
    ).toEqual({
      kind: 'legacyPrompt',
      locale: 'ja',
      slug: '20487885870181167-647244-karuta-duel-dog',
    });
  });

  it('无 locale 的旧 prompt 格式 → 补 /en 后仍是 legacyPrompt', () => {
    expect(resolveLegacyAction('/prompts/2026-05/2052302492897-9224569-pancake/', '')).toEqual({
      kind: 'legacyPrompt',
      locale: 'en',
      slug: '2052302492897-9224569-pancake',
    });
  });

  it('旧分页 → 首页分页参数', () => {
    expect(resolveLegacyAction('/ja/prompts/page/150', '')).toEqual({
      kind: 'redirect',
      to: '/ja?page=150',
    });
    expect(resolveLegacyAction('/prompts/page/3', '')).toEqual({
      kind: 'redirect',
      to: '/en?page=3',
    });
  });
});
