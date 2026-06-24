/**
 * 单元测试：parse-md 工具函数
 */

import { describe, it, expect } from 'vitest';
import {
  detectLocale,
  extractSlug,
  parseDate,
  parsePromptMeta,
} from './parse-md';

describe('detectLocale', () => {
  it('识别 zh-cn 路径', () => {
    expect(detectLocale('/content/zh-cn/prompts/foo.md')).toBe('zh');
  });
  it('识别 ja 路径', () => {
    expect(detectLocale('/content/ja/prompts/bar.md')).toBe('ja');
  });
  it('默认 en', () => {
    expect(detectLocale('/content/prompts/baz.md')).toBe('en');
    expect(detectLocale('C:\\content\\prompts\\qux.md')).toBe('en');
  });
  it('Windows 路径分隔符也支持', () => {
    expect(detectLocale('C:\\awesome\\zh-cn\\prompts\\foo.md')).toBe('zh');
    expect(detectLocale('C:\\awesome\\ja\\prompts\\bar.md')).toBe('ja');
  });
});

describe('extractSlug', () => {
  it('从 YYYY-MM-XXX-slug.md 提取', () => {
    expect(extractSlug('2025-12-001-fancy-title.md')).toBe('fancy-title');
  });
  it('从 YYYY-MM-DD-XXX-slug.md 提取', () => {
    expect(extractSlug('2025-12-25-042-cinematic-shot.md')).toBe('cinematic-shot');
  });
  it('跳过草稿（下划线开头）', () => {
    expect(extractSlug('_draft-foo.md')).toBe('');
  });
  it('格式不对时回退到文件名', () => {
    expect(extractSlug('plain-name.md')).toBe('plain-name');
  });
});

describe('parseDate', () => {
  it('YYYY-MM-DD 原样', () => {
    expect(parseDate('2025-12-25')).toBe('2025-12-25');
  });
  it('YYYY-MM 补 -01', () => {
    expect(parseDate('2025-12')).toBe('2025-12-01');
  });
  it('ISO 8601 截取日期部分', () => {
    expect(parseDate('2025-12-25T10:30:00Z')).toBe('2025-12-25');
  });
  it('YYYY/MM/DD 转换分隔符', () => {
    expect(parseDate('2025/12/25')).toBe('2025-12-25');
  });
  it('空 / undefined 返回 null', () => {
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate('')).toBeNull();
  });
  it('无法识别格式返回 null', () => {
    expect(parseDate('not-a-date')).toBeNull();
    expect(parseDate('25-12-2025')).toBeNull();
  });
});

describe('parsePromptMeta', () => {
  it('基本 front matter 解析', () => {
    const data = {
      title: 'Cinematic Shot',
      date: '2025-12-25',
      image: 'https://example.com/cover.jpg',
      video: 'https://example.com/video.mp4',
      tags: ['cinematic', 'portrait'],
      model: 'veo3',
      author: 'Alice',
    };
    const result = parsePromptMeta(data, 'A cinematic shot of mountains.');
    expect(result.title).toBe('Cinematic Shot');
    expect(result.description).toBe('A cinematic shot of mountains.');
    expect(result.promptDate).toBe('2025-12-25');
    expect(result.tags).toEqual(['cinematic', 'portrait']);
    expect(result.models).toEqual(['veo3']);
    expect(result.author).toBe('Alice');
    expect(result.isDraft).toBe(false);
  });

  it('兼容 model / models 两种字段', () => {
    const data1 = { title: 'A', models: ['veo3', 'sora'] };
    expect(parsePromptMeta(data1, '').models).toEqual(['veo3', 'sora']);

    const data2 = { title: 'A', model: 'veo3' };
    expect(parsePromptMeta(data2, '').models).toEqual(['veo3']);

    const data3 = { title: 'A', model: ['veo3'] };
    expect(parsePromptMeta(data3, '').models).toEqual(['veo3']);
  });

  it('tags 字符串按逗号分割', () => {
    const data = { title: 'A', tags: 'cinematic, portrait, nature' };
    expect(parsePromptMeta(data, '').tags).toEqual(['cinematic', 'portrait', 'nature']);
  });

  it('isDraft 识别', () => {
    expect(parsePromptMeta({ title: 'A', draft: true }, '').isDraft).toBe(true);
    expect(parsePromptMeta({ title: 'A', draft: false }, '').isDraft).toBe(false);
    expect(parsePromptMeta({ title: 'A' }, '').isDraft).toBe(false);
  });

  it('缺失字段给默认值', () => {
    const result = parsePromptMeta({}, '');
    expect(result.title).toBe('');
    expect(result.description).toBe('');
    expect(result.videoUrl).toBeNull();
    expect(result.coverUrl).toBeNull();
    expect(result.sourceUrl).toBeNull();
    expect(result.author).toBeNull();
    expect(result.promptDate).toBeNull();
    expect(result.tags).toEqual([]);
    expect(result.models).toEqual([]);
  });

  it('image 字段兼容 cover', () => {
    expect(parsePromptMeta({ title: 'A', image: 'i' }, '').coverUrl).toBe('i');
    expect(parsePromptMeta({ title: 'A', cover: 'c' }, '').coverUrl).toBe('c');
    expect(parsePromptMeta({ title: 'A' }, '').coverUrl).toBeNull();
  });
});