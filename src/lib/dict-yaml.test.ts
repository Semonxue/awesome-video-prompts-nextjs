/**
 * dict-yaml.test.ts — 验证 yaml 解析器 + MODELS_DICT / TAGS_DICT 形状正确
 *
 * 覆盖：
 *   - parseModelsYaml 顶层 slug 提取 + name 字段提取
 *   - parseTagsYaml 顶层 slug 提取（多语言翻译不参与字典同步）
 *   - 引号字符串去引号
 *   - 注释行被跳过
 *   - yaml 文件与项目里实际 data/*.yaml 一致（防止 data 被改后忘了重新 build）
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { MODELS_DICT, TAGS_DICT, getModelDisplayName, getTagDisplayName } from './dict-yaml';

// 复用 scripts/sync-models.ts 里的两个 parser（同款实现）
function parseModelsYaml(filePath: string): Map<string, string> {
  const raw = fs.readFileSync(filePath, 'utf8');
  const models = new Map<string, string>();
  let currentSlug: string | null = null;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const slugMatch = line.match(/^([a-zA-Z0-9._-]+):\s*$/);
    if (slugMatch) {
      currentSlug = slugMatch[1];
      continue;
    }

    const nameMatch = line.match(/^\s+name:\s*(.+?)\s*$/);
    if (nameMatch && currentSlug) {
      models.set(currentSlug, nameMatch[1]);
      currentSlug = null;
    }
  }

  return models;
}

function parseTagsYaml(filePath: string): Set<string> {
  const raw = fs.readFileSync(filePath, 'utf8');
  const tags = new Set<string>();
  let currentSlug: string | null = null;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const slugMatch = line.match(/^([a-zA-Z0-9._-]+):\s*$/);
    if (slugMatch) {
      const slug = slugMatch[1];
      if (['en', 'zh-cn', 'ja', 'description_en', 'description_zh-cn'].includes(slug)) {
        currentSlug = null;
        continue;
      }
      currentSlug = slug;
      tags.add(slug);
      continue;
    }

    if (line.match(/^\s+[a-zA-Z_-]+:\s*.+/)) {
      // 子属性行
    }
  }

  return tags;
}

const ROOT = path.resolve(__dirname, '../..');
const MODELS_YAML_PATH = path.join(ROOT, 'data', 'models.yaml');
const TAGS_YAML_PATH = path.join(ROOT, 'data', 'tags.yaml');

describe('dict-yaml: 项目 data/*.yaml 解析', () => {
  it('data/models.yaml 至少收录一个 model', () => {
    expect(Object.keys(MODELS_DICT).length).toBeGreaterThan(0);
  });

  it('data/tags.yaml 至少收录一个 tag', () => {
    expect(Object.keys(TAGS_DICT).length).toBeGreaterThan(0);
  });

  it('MODELS_DICT 与 parseModelsYaml 结果一致（防止 parser 分叉）', () => {
    const fromScript = parseModelsYaml(MODELS_YAML_PATH);
    expect(Object.keys(MODELS_DICT).length).toBe(fromScript.size);
    for (const [slug, { name }] of Object.entries(MODELS_DICT)) {
      expect(fromScript.get(slug)).toBe(name);
    }
  });

  it('TAGS_DICT 顶层 slug 集合与 parseTagsYaml 一致', () => {
    const fromScript = parseTagsYaml(TAGS_YAML_PATH);
    const fromModule = new Set(Object.keys(TAGS_DICT));
    expect(fromModule.size).toBe(fromScript.size);
    for (const slug of fromScript) {
      expect(fromModule.has(slug)).toBe(true);
    }
  });

  it('MODELS_DICT 中每个 slug 都有 name 字段', () => {
    for (const [slug, entry] of Object.entries(MODELS_DICT)) {
      expect(entry.name, `slug=${slug}`).toBeTruthy();
      expect(typeof entry.name).toBe('string');
    }
  });

  it('TAGS_DICT 中每个 slug 至少有 en fallback', () => {
    for (const [slug, entry] of Object.entries(TAGS_DICT)) {
      expect(entry.en, `slug=${slug}`).toBeTruthy();
      expect(typeof entry.en).toBe('string');
    }
  });
});

describe('dict-yaml: 已知样本（防止 yaml 改格式后解析失败）', () => {
  it('klingo1 → Kling O1（去引号 + 含空格）', () => {
    expect(getModelDisplayName('klingo1')).toBe('Kling O1');
  });

  it('kling26 → Kling 2.6', () => {
    expect(getModelDisplayName('kling26')).toBe('Kling 2.6');
  });

  it('seedance1.5pro → Seedance 1.5 Pro', () => {
    expect(getModelDisplayName('seedance1.5pro')).toBe('Seedance 1.5 Pro');
  });

  it('未知 model slug 返回空串（UI 不显示）', () => {
    expect(getModelDisplayName('this-model-does-not-exist')).toBe('');
  });

  it('tag 多语言翻译：cinematic（data/tags.yaml 里 cinematic 只有 en + zh-cn）', () => {
    expect(getTagDisplayName('cinematic', 'en')).toBe('cinematic');
    expect(getTagDisplayName('cinematic', 'zh')).toBe('电影感');
    // ja 未提供 → fallback 到 en
    expect(getTagDisplayName('cinematic', 'ja')).toBe('cinematic');
  });

  it('未知 tag slug fallback 到 slug 本身', () => {
    expect(getTagDisplayName('no-such-tag', 'en')).toBe('no-such-tag');
  });

  it('未知 locale fallback 到 en', () => {
    expect(getTagDisplayName('cinematic', 'fr')).toBe('cinematic');
  });
});