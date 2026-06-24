/**
 * TagDisplay — 标签显示（按 locale 翻译）
 *
 * Phase 1 实现：标签翻译表用代码内 hardcode（从老站 data/tags/*.yaml 提取）
 * Phase 2 优化：标签字典从 D1 models 查
 */

import type { Locale } from '@/i18n/request';

interface TagDisplayProps {
  tag: string;
  locale: Locale;
}

/**
 * 简化版标签翻译表（Phase 1 用）
 * Phase 2 实装时从老站 data/tags 加载完整字典
 */
const TAG_TRANSLATIONS: Record<string, { en: string; zh: string; ja: string }> = {
  cinematic: { en: 'Cinematic', zh: '电影感', ja: 'シネマティック' },
  anime: { en: 'Anime', zh: '动漫', ja: 'アニメ' },
  'sci-fi': { en: 'Sci-Fi', zh: '科幻', ja: 'SF' },
  fantasy: { en: 'Fantasy', zh: '奇幻', ja: 'ファンタジー' },
  realistic: { en: 'Realistic', zh: '写实', ja: 'リアル' },
  portrait: { en: 'Portrait', zh: '人像', ja: 'ポートレート' },
  landscape: { en: 'Landscape', zh: '风景', ja: '風景' },
  abstract: { en: 'Abstract', zh: '抽象', ja: 'アブストラクト' },
  nature: { en: 'Nature', zh: '自然', ja: '自然' },
  urban: { en: 'Urban', zh: '城市', ja: '都市' },
};

export default function TagDisplay({ tag, locale }: TagDisplayProps) {
  const translation = TAG_TRANSLATIONS[tag];
  if (translation) return translation[locale];
  return tag;
}