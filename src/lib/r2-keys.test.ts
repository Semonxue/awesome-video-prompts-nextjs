import { describe, expect, it } from 'vitest';
import { deriveYearMonth, keyFromMediaUrl, R2_KEY_PREFIX } from './r2-keys';

describe('deriveYearMonth', () => {
  it('从 YYYY-MM-DD 提取 YYYY-MM', () => {
    expect(deriveYearMonth('2026-06-15')).toBe('2026-06');
  });

  it('从 YYYY-MM-01 提取 YYYY-MM', () => {
    expect(deriveYearMonth('2026-06-01')).toBe('2026-06');
  });

  it('空值/非法值回退到当前月', () => {
    const now = new Date();
    const expected = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    expect(deriveYearMonth('')).toBe(expected);
    expect(deriveYearMonth(null)).toBe(expected);
    expect(deriveYearMonth(undefined)).toBe(expected);
    expect(deriveYearMonth('not-a-date')).toBe(expected);
  });
});

describe('keyFromMediaUrl', () => {
  const slug = '206987039866945601-crocodile-floodgate';

  it('从完整 R2 公网 URL 反解 key', () => {
    expect(
      keyFromMediaUrl(`https://static.awesomevideoprompts.com/prompts/2026-06/${slug}/cover.jpg`, slug),
    ).toBe(`prompts/2026-06/${slug}/cover.jpg`);
  });

  it('从 video URL 反解 key', () => {
    expect(
      keyFromMediaUrl(`https://static.awesomevideoprompts.com/prompts/2025-11/${slug}/video.mp4`, slug),
    ).toBe(`prompts/2025-11/${slug}/video.mp4`);
  });

  it('兼容相对路径形式', () => {
    expect(keyFromMediaUrl(`/prompts/2026-06/${slug}/cover.jpg`, slug)).toBe(
      `prompts/2026-06/${slug}/cover.jpg`,
    );
  });

  it('空值返回 null', () => {
    expect(keyFromMediaUrl(null, slug)).toBeNull();
    expect(keyFromMediaUrl(undefined, slug)).toBeNull();
    expect(keyFromMediaUrl('', slug)).toBeNull();
  });

  it('拒绝非 prompts/ 前缀的 URL（防误删/误覆盖任意对象）', () => {
    expect(keyFromMediaUrl(`https://evil.example.com/other/2026-06/${slug}/cover.jpg`, slug)).toBeNull();
  });

  it('拒绝 slug 目录不匹配的路径', () => {
    expect(
      keyFromMediaUrl('https://static.awesomevideoprompts.com/prompts/2026-06/other-slug/cover.jpg', slug),
    ).toBeNull();
  });

  it('key 前缀常量与路径约定一致', () => {
    expect(R2_KEY_PREFIX).toBe('prompts');
  });
});