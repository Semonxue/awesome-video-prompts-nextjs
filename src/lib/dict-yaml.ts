/**
 * dict-yaml.ts — 把 data/models.yaml + data/tags.yaml 解析成 TS 常量
 *
 * 为什么需要这个：
 *   - Workers runtime 没有 fs，运行时不能 readFileSync('data/...yaml')
 *   - 所以在编译期通过 next.config.ts 的 webpack rule 把 .yaml 作为 raw source 打包进来
 *   - 这里解析后暴露两个常量（MODELS_DICT / TAGS_DICT），代码里直接 import 用
 *
 * 与 yaml 字典一致性的保证：
 *   - data/ 下的 yaml 仍然是编辑入口（人工可读、md-editor 直接读）
 *   - publish 流程调 src/lib/dict-sync.ts 把这里解析出的常量与 D1 校准
 *   - deploy.sh 调 scripts/sync-models.ts（含 tags）做部署时二次保险
 *
 * 解析器范围：
 *   - 注释（# 整行）+ 行尾注释（trim 后判定）
 *   - 顶层 + 二层 map（key: value，value 可选引号包起来）
 *   - 不支持 list、anchor、multi-doc —— 当前 yaml 文件不需要
 *   - 解析失败直接抛错（开发期暴露，部署前 type-check 即可）
 */

import modelsYamlRaw from '../../data/models.yaml';
import tagsYamlRaw from '../../data/tags.yaml';

/** 解析后的 model 字典：slug → { name } */
export interface ModelDictEntry {
  name: string;
}
export type ModelsDict = Record<string, ModelDictEntry>;

/** 解析后的 tag 字典：slug → 多语言 + 描述 */
export interface TagDictEntry {
  /** 英文显示名（默认 fallback） */
  en: string;
  /** 中文显示名（zh-CN） */
  zh: string;
  /** 日文显示名 */
  ja: string;
  /** 英文描述（可选，未填则空串） */
  descriptionEn: string;
  /** 中文描述（可选） */
  descriptionZh: string;
}
export type TagsDict = Record<string, TagDictEntry>;

// ============================================================
// 轻量 YAML parser（只支持本项目用的两层 map + 注释）
// ============================================================

/**
 * 去掉引号 + 转义。支持双引号/单引号包围的字符串。
 * 不支持嵌套转义（本项目 yaml 里没用）。
 */
function unquote(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2 && (s.startsWith('"') || s.startsWith("'")) && s.endsWith(s[0])) {
    return s.slice(1, -1);
  }
  return s;
}

/** 行是否仅是注释或空行 */
function isCommentOrBlank(line: string): boolean {
  const t = line.trim();
  return !t || t.startsWith('#');
}

/**
 * 解析顶层为 slug → 二层 map 的 yaml。
 * 格式：
 *   slug1:
 *     key: value
 *     key2: "quoted value"
 *   slug2:
 *     name: Foo
 */
function parseTwoLevelYaml(raw: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  const lines = raw.split('\n');
  let currentSlug: string | null = null;

  for (const line of lines) {
    if (isCommentOrBlank(line)) continue;

    // 顶层 slug：非空字符开头，以 ":" 结尾
    const topMatch = line.match(/^([A-Za-z0-9._-]+):\s*$/);
    if (topMatch) {
      currentSlug = topMatch[1];
      if (!result[currentSlug]) result[currentSlug] = {};
      continue;
    }

    // 缩进属性行
    if (currentSlug === null) {
      // 容错：顶层属性无所属 slug（罕见）；按顶级 key 当 slug
      const inline = line.match(/^([A-Za-z0-9._-]+):\s*(.+?)\s*$/);
      if (inline) {
        result[inline[1]] = { _inline: unquote(inline[2]) };
      }
      continue;
    }

    const subMatch = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.+?)\s*$/);
    if (subMatch) {
      result[currentSlug][subMatch[1]] = unquote(subMatch[2]);
    }
  }

  return result;
}

// ============================================================
// models.yaml → MODELS_DICT
// ============================================================

const modelsParsed = parseTwoLevelYaml(modelsYamlRaw);

/** slug → { name }，剔除 _inline 容错条目 */
export const MODELS_DICT: ModelsDict = Object.fromEntries(
  Object.entries(modelsParsed)
    .filter(([, v]) => v.name !== undefined)
    .map(([slug, v]) => [slug, { name: v.name }]),
);

// ============================================================
// tags.yaml → TAGS_DICT（多语言）
// ============================================================

const tagsParsed = parseTwoLevelYaml(tagsYamlRaw);

/** slug → 多语言 + 描述（en 缺失则 fallback 到 slug 本身） */
export const TAGS_DICT: TagsDict = Object.fromEntries(
  Object.entries(tagsParsed).map(([slug, v]) => [
    slug,
    {
      en: v.en ?? slug,
      zh: v['zh-cn'] ?? v.en ?? slug,
      ja: v.ja ?? v.en ?? slug,
      descriptionEn: v.description_en ?? '',
      descriptionZh: v['description_zh-cn'] ?? '',
    },
  ]),
);

// ============================================================
// 查询辅助
// ============================================================

/** 取 model 显示名；未知 slug 返回空串（UI 上不显示） */
export function getModelDisplayName(slug: string): string {
  return MODELS_DICT[slug]?.name ?? '';
}

/**
 * 取 tag 显示名（按 locale 翻译；未知 locale fallback 到 en，再 fallback 到 slug）
 * locale 取 'en' | 'zh' | 'ja'
 */
export function getTagDisplayName(slug: string, locale: string): string {
  const entry = TAGS_DICT[slug];
  if (!entry) return slug;
  if (locale === 'zh') return entry.zh;
  if (locale === 'ja') return entry.ja;
  return entry.en;
}