/**
 * format.ts 单元测试
 * 覆盖 tagHref / modelHref
 *
 * formatModelName 已删除（2026-08-09）：model 显示名改由 db/queries.ts 的 getModelName 从 D1 拿，
 * 详见 lib/dict-yaml.ts 的真源 + lib/dict-sync.ts 的同步保证。
 */
import { describe, it, expect } from 'vitest';
import { tagHref, modelHref } from './format';

describe('tagHref', () => {
  it('returns canonical path for ASCII slugs', () => {
    expect(tagHref('en', 'cinematic')).toBe('/en/tags/cinematic');
    expect(tagHref('zh', 'kling3')).toBe('/zh/tags/kling3');
  });

  it('encodes slug with spaces', () => {
    // 29 个 tag slug 含空格（如 "martial arts"）
    expect(tagHref('en', 'martial arts')).toBe('/en/tags/martial%20arts');
    expect(tagHref('ja', 'sports broadcast')).toBe('/ja/tags/sports%20broadcast');
  });

  it('encodes non-ASCII slugs (UTF-8 percent-encoding)', () => {
    // 含 café / 末日 等非 ASCII
    expect(tagHref('en', 'café')).toBe('/en/tags/caf%C3%A9');
    expect(tagHref('zh', '末日')).toBe('/zh/tags/%E6%9C%AB%E6%97%A5');
  });

  it('keeps dash/underscore/period unencoded (these are path-safe)', () => {
    expect(tagHref('en', 'seedance-2.0')).toBe('/en/tags/seedance-2.0');
    expect(tagHref('en', 'under_score')).toBe('/en/tags/under_score');
  });
});

describe('modelHref', () => {
  it('returns canonical path for ASCII slugs', () => {
    expect(modelHref('en', 'veo3')).toBe('/en/models/veo3');
  });

  it('encodes slug with spaces', () => {
    // 4 个 model slug 含空格
    expect(modelHref('en', 'seedance 2.0')).toBe('/en/models/seedance%202.0');
    expect(modelHref('en', 'claude opus 4.7')).toBe('/en/models/claude%20opus%204.7');
  });

  it('encodes mixed-case slug (case-sensitive path segment)', () => {
    // model 表里 "Seedance 2.0" 是大写开头
    expect(modelHref('en', 'Seedance 2.0')).toBe('/en/models/Seedance%202.0');
  });
});
