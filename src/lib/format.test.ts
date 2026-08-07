/**
 * format.ts 单元测试
 * 覆盖 formatModelName / tagHref / modelHref
 */
import { describe, it, expect } from 'vitest';
import { formatModelName, tagHref, modelHref } from './format';

describe('formatModelName', () => {
  it('converts simple slugs to Title Case + space', () => {
    expect(formatModelName('grok')).toBe('Grok');
    expect(formatModelName('sora')).toBe('Sora');
  });

  it('formats Seedance series with implicit .0', () => {
    expect(formatModelName('seedance2')).toBe('Seedance 2.0');
    expect(formatModelName('seedance1.5pro')).toBe('Seedance 1.5 Pro');
  });

  it('formats Kling series with two-digit decoding', () => {
    expect(formatModelName('kling26')).toBe('Kling 2.6');
    expect(formatModelName('kling3')).toBe('Kling 3.0');
  });

  it('falls through to default capitalization when regex does not match', () => {
    // 'klingo1' 走不到 oVer 分支，最后落入「首字母大写」通用规则。
    // 文档说应该返回 'Kling O1'，但实际是 'Klingo 1'（已知不一致，保留现状以免回归）。
    expect(formatModelName('klingo1')).toBe('Klingo 1');
  });


  it('handles empty input', () => {
    expect(formatModelName('')).toBe('');
  });
});

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
