/**
 * legacy-url.ts 单元测试
 *
 * 覆盖 2026-09-08 的行为变更：旧 prompt URL 不再直接 301，
 * 而是返回 legacyPrompt 动作交给 /api/legacy-prompt 做存在性检查。
 *
 * 2026-10-08 SEO 审计（P0-1/P0-2）新增：重复 locale 前缀折叠 + 别名补齐 +
 * tag 分页 ?page=N → /p/N 收敛。
 */
import { describe, it, expect } from 'vitest';
import { resolveLegacyAction } from './legacy-url';
import { TAG_PAGE_MAX_DEPTH, MODEL_PAGE_MAX_DEPTH } from './pagination';

describe('resolveLegacyAction', () => {
  it('根路径交给 intlMiddleware（返回 null）', () => {
    expect(resolveLegacyAction('/', '')).toBeNull();
  });

  it('已是新站格式的路径不处理', () => {
    expect(resolveLegacyAction('/en/tags/smile', '')).toBeNull();
    expect(resolveLegacyAction('/zh/prompts/2096144016089780321-flying-dinosaur', '')).toBeNull();
    expect(resolveLegacyAction('/en/about', '')).toBeNull();
    // 新的 tag 分页真实路径不应被 legacy 逻辑碰
    expect(resolveLegacyAction('/en/tags/cinematic/p/2', '')).toBeNull();
  });

  it('去尾斜杠 + 补 locale', () => {
    expect(resolveLegacyAction('/tags/smile/', '')).toEqual({
      kind: 'redirect',
      to: '/en/tags/smile',
    });
  });

  it('tag 页 ?page=N 收敛到真实路径 /p/N（P1-1）', () => {
    expect(resolveLegacyAction('/en/tags/cinematic', '?page=2')).toEqual({
      kind: 'redirect',
      to: '/en/tags/cinematic/p/2',
    });
    // 同时带尾斜杠 + query，也要正确归一
    expect(resolveLegacyAction('/en/tags/cinematic/', '?page=3')).toEqual({
      kind: 'redirect',
      to: '/en/tags/cinematic/p/3',
    });
    // 无 locale 前缀先补 /en
    expect(resolveLegacyAction('/tags/cinematic', '?page=2')).toEqual({
      kind: 'redirect',
      to: '/en/tags/cinematic/p/2',
    });
    // 多个 query 参数时也能取到 page
    expect(resolveLegacyAction('/en/tags/cinematic', '?tag=x&page=2')).toEqual({
      kind: 'redirect',
      to: '/en/tags/cinematic/p/2',
    });
  });

  it('tag 页 ?page=1 收敛到干净路径（不产生重复 URL）', () => {
    expect(resolveLegacyAction('/en/tags/cinematic', '?page=1')).toEqual({
      kind: 'redirect',
      to: '/en/tags/cinematic',
    });
  });

  it('tag 页 ?page=N 超上限时夹到上限，不丢回 page 1', () => {
    expect(resolveLegacyAction('/en/tags/cinematic', '?page=188')).toEqual({
      kind: 'redirect',
      to: `/en/tags/cinematic/p/${TAG_PAGE_MAX_DEPTH}`,
    });
  });

  it('非 tag 页的 ?page= 不被改写（首页分页保持原样）', () => {
    expect(resolveLegacyAction('/en', '?page=2')).toBeNull();
    expect(resolveLegacyAction('/en/models/seedance25', '?page=2')).toEqual({
      kind: 'redirect',
      to: '/en/models/seedance25/p/2',
    });
  });

  // ---- 2026-10-08 P1-1 扩展：model 页同样升级为 /p/N 真实路径 ----

  it('model 页 ?page=N 收敛到 /p/N', () => {
    expect(resolveLegacyAction('/en/models/seedance25', '?page=2')).toEqual({
      kind: 'redirect',
      to: '/en/models/seedance25/p/2',
    });
    expect(resolveLegacyAction('/models/seedance25/', '?page=3')).toEqual({
      kind: 'redirect',
      to: '/en/models/seedance25/p/3',
    });
    expect(resolveLegacyAction('/zh/models/kling-3', '?page=1')).toEqual({
      kind: 'redirect',
      to: '/zh/models/kling-3',
    });
  });

  it('model 页 ?page=N 超上限时夹到上限', () => {
    expect(resolveLegacyAction('/en/models/seedance25', '?page=40')).toEqual({
      kind: 'redirect',
      to: `/en/models/seedance25/p/${MODEL_PAGE_MAX_DEPTH}`,
    });
  });

  it('model 页带 ?tag= 分面时**不**收敛到 /p/N（facet 保持封锁）', () => {
    // tag 交叉面与 /[locale]/tags/[tag] 重复，刻意不进 /p/N 体系
    expect(resolveLegacyAction('/en/models/seedance25', '?tag=cinematic&page=2')).toBeNull();
    // 只有 tag、没有 page 时也不动
    expect(resolveLegacyAction('/en/models/seedance25', '?tag=cinematic')).toBeNull();
  });

  it('新的 /p/N 路径本身不被 legacy 逻辑改写', () => {
    expect(resolveLegacyAction('/en/models/seedance25/p/2', '')).toBeNull();
    expect(resolveLegacyAction('/en/tags/cinematic/p/2', '')).toBeNull();
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

  // ---- 2026-10-08 P0-1：重复 locale 前缀（旧站产物，修复前是 404）----

  it('折叠重复的同名 locale 前缀 /ja/ja/...', () => {
    expect(
      resolveLegacyAction('/ja/ja/prompts/2026-02/2019515197501603840-sanity-soup-factory-interview/', ''),
    ).toEqual({
      kind: 'legacyPrompt',
      locale: 'ja',
      slug: '2019515197501603840-sanity-soup-factory-interview',
    });
  });

  it('折叠重复的旧 locale 前缀 /zh-cn/zh-cn/...', () => {
    expect(
      resolveLegacyAction(
        '/zh-cn/zh-cn/prompts/2026-02/2021909649314770944-hyperspeed-fpv-diving-collapsing-coastal-cliff/',
        '',
      ),
    ).toEqual({
      kind: 'legacyPrompt',
      locale: 'zh',
      slug: '2021909649314770944-hyperspeed-fpv-diving-collapsing-coastal-cliff',
    });
  });

  it('折叠到不动点：三层重复也能归一', () => {
    expect(
      resolveLegacyAction('/zh-cn/zh-cn/zh-cn/prompts/2026-02/abc-123-demo/', ''),
    ).toEqual({ kind: 'legacyPrompt', locale: 'zh', slug: 'abc-123-demo' });
    expect(resolveLegacyAction('/ja/ja/ja/ja/prompts/2026-02/abc-123-demo/', '')).toEqual({
      kind: 'legacyPrompt',
      locale: 'ja',
      slug: 'abc-123-demo',
    });
  });

  it('规范 locale 后紧跟别名也折叠（/zh/zh-cn/...）', () => {
    expect(resolveLegacyAction('/zh/zh-cn/prompts/2026-02/abc-123-demo/', '')).toEqual({
      kind: 'legacyPrompt',
      locale: 'zh',
      slug: 'abc-123-demo',
    });
  });

  it('重复前缀的 tag 页也能归一而不是 404', () => {
    expect(resolveLegacyAction('/ja/ja/tags/librarian/', '')).toEqual({
      kind: 'redirect',
      to: '/ja/tags/librarian',
    });
    expect(resolveLegacyAction('/zh-cn/zh-cn/tags/group-scene/', '')).toEqual({
      kind: 'redirect',
      to: '/zh/tags/group-scene',
    });
  });

  it('重复前缀的旧分页也归一', () => {
    expect(resolveLegacyAction('/ja/ja/prompts/page/2', '')).toEqual({
      kind: 'redirect',
      to: '/ja?page=2',
    });
  });

  // ---- 2026-10-08 P0-2：locale 别名补齐 ----

  it('大小写不敏感的 locale 别名', () => {
    expect(resolveLegacyAction('/ZH-CN/prompts/2026-02/abc-123-demo/', '')).toEqual({
      kind: 'legacyPrompt',
      locale: 'zh',
      slug: 'abc-123-demo',
    });
    expect(resolveLegacyAction('/Zh-Cn/prompts/2026-02/abc-123-demo/', '')).toEqual({
      kind: 'legacyPrompt',
      locale: 'zh',
      slug: 'abc-123-demo',
    });
  });

  it('扩展别名：zh-tw / zh-hant / en-us / en-gb / ja-jp / jp', () => {
    const cases: Array<[string, string]> = [
      ['/zh-tw/prompts/2026-02/s1/', 'zh'],
      ['/zh-hant/prompts/2026-02/s1/', 'zh'],
      ['/en-us/prompts/2026-02/s1/', 'en'],
      ['/en-gb/prompts/2026-02/s1/', 'en'],
      ['/ja-jp/prompts/2026-02/s1/', 'ja'],
      ['/jp/prompts/2026-02/s1/', 'ja'],
    ];
    for (const [input, locale] of cases) {
      expect(resolveLegacyAction(input, ''), input).toEqual({
        kind: 'legacyPrompt',
        locale,
        slug: 's1',
      });
    }
  });

  // ---- 不回归：slug / tag 段的大小写必须原样保留 ----

  it('折叠 locale 时不改动后续段的大小写', () => {
    expect(resolveLegacyAction('/zh-cn/prompts/2026-02/AbC-123-MixedCase-Slug/', '')).toEqual({
      kind: 'legacyPrompt',
      locale: 'zh',
      slug: 'AbC-123-MixedCase-Slug',
    });
  });

  it('不误伤非 locale 开头且与 locale 同名的段', () => {
    // 'jp' 只有在开头（locale 位）才被当别名，tag slug 叫 jp 不受影响
    expect(resolveLegacyAction('/en/tags/jp', '')).toBeNull();
    // slug 里含 'jp' 不会被拆走：这里只是去尾斜杠（无 YYYY-MM 段，不是旧格式）
    expect(resolveLegacyAction('/en/prompts/abc-123-jp/', '')).toEqual({
      kind: 'redirect',
      to: '/en/prompts/abc-123-jp',
    });
    // 旧格式里 slug 含别名也要完整保留
    expect(resolveLegacyAction('/jp/prompts/2026-02/abc-123-jp/', '')).toEqual({
      kind: 'legacyPrompt',
      locale: 'ja',
      slug: 'abc-123-jp',
    });
  });
});
