import { describe, it, expect } from 'vitest';
import {
  extractWordStats,
  buildTagIntro,
  buildModelIntro,
  buildTagFaq,
  buildModelFaq,
  buildTagCollectionSchema,
  buildModelCollectionSchema,
  buildFaqSchema,
} from './content-pages';

describe('extractWordStats', () => {
  it('统计标题里的实义词频，忽略停用词', () => {
    const stats = extractWordStats([
      'Cinematic portrait of a woman',
      'Cinematic portrait in golden light',
      'Cinematic slow motion shot',
    ]);
    expect(stats[0]).toEqual({ word: 'cinematic', count: 3 });
  });

  it('只出现 1 次的词不算「常见」（避免导语里出现噪声）', () => {
    const stats = extractWordStats(['Cinematic portrait', 'Cinematic shot', 'Unique word here']);
    const words = stats.map((s) => s.word);
    expect(words).toContain('cinematic');
    expect(words).not.toContain('unique');
  });

  it('过滤掉 stopwords（含 video/prompt 这类会让导语变废话的词）', () => {
    const stats = extractWordStats([
      'Video prompt for cinematic scene',
      'Video prompt with cinematic camera',
      'Video prompt cinematic motion',
    ]);
    const words = stats.map((s) => s.word);
    expect(words).not.toContain('video');
    expect(words).not.toContain('prompt');
    expect(words).not.toContain('scene');
  });

  it('空输入返回空数组', () => {
    expect(extractWordStats([])).toEqual([]);
    expect(extractWordStats(['!!!', '1234'])).toEqual([]);
  });

  it('排除词参数：排除本页自己的主题词（避免导语说废话）', () => {
    const titles = [
      'Cinematic portrait of a woman',
      'Cinematic portrait in golden light',
      'Cinematic slow motion shot',
    ];
    // 不排除时，cinematic 排第一
    expect(extractWordStats(titles)[0].word).toBe('cinematic');
    // 排除后，名额让给真正的搭配风格
    const stats = extractWordStats(titles, 8, ['cinematic']);
    expect(stats.map((s) => s.word)).not.toContain('cinematic');
    expect(stats.map((s) => s.word)).toContain('portrait');
  });

  it('排除词大小写不敏感', () => {
    const stats = extractWordStats(
      ['Cinematic portrait', 'Cinematic portrait light', 'Cinematic portrait glow'],
      8,
      ['CINEMATIC'],
    );
    expect(stats.map((s) => s.word)).not.toContain('cinematic');
  });
});

describe('buildTagIntro', () => {
  const base = {
    tagName: 'cinematic',
    count: 4985,
    total: 7374,
    stats: {
      models: [
        { slug: 'seedance2', name: 'Seedance 2.0', count: 3200 },
        { slug: 'veo3', name: 'Veo 3', count: 900 },
      ],
      related: [{ slug: 'portrait', name: 'portrait', count: 300 }],
      words: [
        { word: 'cinematic', count: 30 },
        { word: 'portrait', count: 20 },
        { word: 'lighting', count: 15 },
      ],
    },
  };

  it('导语包含数量与占比（数据事实）', () => {
    const paras = buildTagIntro(base);
    expect(paras[0]).toContain('4,985');
    expect(paras[0]).toContain('67.6%');
  });

  it('导语包含词频最高的词（数据派生，非模板）', () => {
    const paras = buildTagIntro(base);
    expect(paras.join(' ')).toContain('cinematic');
    expect(paras.join(' ')).toContain('portrait');
  });

  it('导语包含主力模型与占比', () => {
    const paras = buildTagIntro(base);
    expect(paras.join(' ')).toContain('Seedance 2.0');
  });

  it('不同 tag 页的导语必须不同（防 scaled content abuse）', () => {
    const a = buildTagIntro(base).join(' ');
    const b = buildTagIntro({
      ...base,
      tagName: 'portrait',
      count: 1041,
      stats: { ...base.stats, models: [] },
    }).join(' ');
    expect(a).not.toBe(b);
    expect(b).not.toContain('4,985');
  });

  it('没有词频数据时只输出规模段，不编造内容', () => {
    const paras = buildTagIntro({ ...base, stats: { ...base.stats, words: [] } });
    expect(paras).toHaveLength(2); // 规模 + 模型
    expect(paras.join(' ')).not.toContain('undefined');
  });

  it('没有模型数据时不输出模型段（不写空句子）', () => {
    const paras = buildTagIntro({ ...base, stats: { ...base.stats, models: [] } });
    expect(paras).toHaveLength(2);
    expect(paras.join(' ')).not.toContain('are ,');
  });

  it('统计整体缺失时只输出规模段，绝不编数字', () => {
    const paras = buildTagIntro({ ...base, stats: null });
    expect(paras).toHaveLength(1);
    expect(paras[0]).toContain('4,985');
    expect(paras.join(' ')).not.toContain('undefined');
  });

  it('model 计数必须与传入的全量计数一致（2026-10-22 口径修正）', () => {
    // 回归测试：曾经用「当前页 48 条」的计数去比 tag 总数，
    // 线上渲染成 "covering 41 of the 5,018" —— 41 是本页计数，5,018 是全量。
    const paras = buildTagIntro(base).join(' ');
    expect(paras).toContain('3,200');
    expect(paras).not.toContain('41');
  });
});

describe('buildModelIntro', () => {
  const base = {
    modelName: 'Seedance 2.0',
    count: 4194,
    total: 7374,
    topTags: [
      { slug: 'cinematic', name: 'cinematic', count: 1041 },
      { slug: 'action', name: 'action', count: 620 },
    ],
    coModels: [
      { slug: 'veo3', name: 'Veo 3', count: 300 },
      { slug: 'kling4', name: 'Kling 4.0', count: 120 },
    ],
    modelRank: { rank: 3, totalModels: 32 },
  };

  it('导语包含数量与占比', () => {
    const paras = buildModelIntro(base);
    expect(paras[0]).toContain('4,194');
    expect(paras[0]).toContain('56.9%');
  });

  it('导语说明该 model 的主力风格（tag 分布事实）', () => {
    const paras = buildModelIntro(base);
    expect(paras.join(' ')).toContain('cinematic');
  });

  it('不包含任何编造的规格（时长/分辨率）', () => {
    const paras = buildModelIntro(base).join(' ');
    // 本站没有规格数据源 → 写出来就是虚构，会踩 scaled content abuse
    expect(paras).not.toMatch(/\d+\s*(seconds?|s\b)/i);
    expect(paras).not.toMatch(/\d{3,4}\s*[x×]\s*\d{3,4}/);
    expect(paras).not.toMatch(/\b(fps|4k|1080p|720p)\b/i);
  });

  it('没有共现 model 时改用全站排名（真值），而不是留空或编造', () => {
    const paras = buildModelIntro({ ...base, coModels: [] });
    expect(paras).toHaveLength(3); // 规模 + 风格 + 排名
    expect(paras[2]).toContain('3rd');
    expect(paras[2]).toContain('32');
  });

  it('既无共现又无排名时省略该段（不编造）', () => {
    const paras = buildModelIntro({ ...base, coModels: [], modelRank: null });
    expect(paras).toHaveLength(2); // 规模 + 风格
    expect(paras.join(' ')).not.toContain('undefined');
  });

  it('不同 model 页导语不同', () => {
    const a = buildModelIntro(base).join(' ');
    const b = buildModelIntro({
      ...base,
      modelName: 'Veo 3',
      count: 97,
      topTags: [],
      coModels: [],
    }).join(' ');
    expect(a).not.toBe(b);
  });
});

describe('buildTagFaq', () => {
  const base = {
    tagName: 'cinematic',
    count: 4985,
    total: 7374,
    stats: {
      models: [{ slug: 'seedance2', name: 'Seedance 2.0', count: 3200 }],
      related: [{ slug: 'portrait', name: 'portrait', count: 300 }],
      words: [],
    },
  };

  it('FAQ 至少 3 条且每条都有问答', () => {
    const faq = buildTagFaq(base);
    expect(faq.length).toBeGreaterThanOrEqual(3);
    for (const item of faq) {
      expect(item.question.length).toBeGreaterThan(10);
      expect(item.answer.length).toBeGreaterThan(20);
    }
  });

  it('FAQ 答案里的数字来自传入数据', () => {
    const faq = buildTagFaq(base);
    expect(faq[0].answer).toContain('4,985');
    expect(faq[0].answer).toContain('7,374');
  });

  it('统计缺失时省略依赖统计的问答，只保留规模与用法', () => {
    const faq = buildTagFaq({ ...base, stats: null });
    expect(faq).toHaveLength(2);
    expect(faq[0].answer).toContain('4,985');
    expect(JSON.stringify(faq)).not.toContain('undefined');
  });

  it('FAQ 里的 model 计数必须是全量计数（2026-10-22 口径修正）', () => {
    const faq = buildTagFaq(base);
    const modelFaq = faq.find((f) => f.question.includes('most used'));
    expect(modelFaq?.answer).toContain('3,200');
    expect(modelFaq?.answer).toContain('4,985');
  });

  it('不同 tag 页的 FAQ 不同', () => {
    const a = JSON.stringify(buildTagFaq(base));
    const b = JSON.stringify(buildTagFaq({ ...base, tagName: 'portrait', count: 1041 }));
    expect(a).not.toBe(b);
  });
});

describe('buildModelFaq', () => {
  const base = {
    modelName: 'Seedance 2.0',
    count: 4194,
    total: 7374,
    topTags: [{ slug: 'cinematic', name: 'cinematic', count: 1041 }],
    coModels: [
      { slug: 'veo3', name: 'Veo 3', count: 300 },
      { slug: 'kling4', name: 'Kling 4.0', count: 120 },
    ],
    modelRank: { rank: 3, totalModels: 32 },
  };

  it('FAQ 包含数量问答与主力风格问答', () => {
    const faq = buildModelFaq(base);
    expect(faq[0].question).toContain('Seedance 2.0');
    expect(faq[0].answer).toContain('4,194');
    expect(faq.some((f) => f.answer.includes('cinematic'))).toBe(true);
  });

  it('没有共现 model 时改用排名问答', () => {
    const faq = buildModelFaq({ ...base, coModels: [] });
    expect(faq.some((f) => f.question.includes('Which other models'))).toBe(false);
    expect(faq.some((f) => f.question.includes('compare'))).toBe(true);
    expect(faq.length).toBeGreaterThanOrEqual(3);
  });

  it('既无共现又无排名时省略排名问答', () => {
    const faq = buildModelFaq({ ...base, coModels: [], modelRank: null });
    expect(faq.some((f) => f.question.includes('compare'))).toBe(false);
  });

  it('不同 model 页 FAQ 不同', () => {
    const a = JSON.stringify(buildModelFaq(base));
    const b = JSON.stringify(buildModelFaq({ ...base, modelName: 'Veo 3', count: 97 }));
    expect(a).not.toBe(b);
  });
});

describe('结构化数据', () => {
  it('CollectionPage + ItemList 结构正确', () => {
    const schema = buildTagCollectionSchema({
      tagName: 'cinematic',
      url: 'https://awesomevideoprompts.com/en/tags/cinematic',
      items: [
        { name: 'A', url: 'https://awesomevideoprompts.com/en/prompts/a' },
        { name: 'B', url: 'https://awesomevideoprompts.com/en/prompts/b' },
      ],
    });
    expect(schema['@type']).toBe('CollectionPage');
    const list = schema.mainEntity as Record<string, unknown>;
    expect(list['@type']).toBe('ItemList');
    expect(list.numberOfItems).toBe(2);
    const items = list.itemListElement as Array<Record<string, unknown>>;
    expect(items[0].position).toBe(1);
    expect(items[1].position).toBe(2);
  });

  it('model 版 CollectionPage 结构一致', () => {
    const schema = buildModelCollectionSchema({
      modelName: 'Seedance 2.0',
      url: 'https://awesomevideoprompts.com/en/models/seedance2',
      items: [{ name: 'A', url: 'https://awesomevideoprompts.com/en/prompts/a' }],
    });
    expect(schema['@type']).toBe('CollectionPage');
    expect((schema.mainEntity as Record<string, unknown>).numberOfItems).toBe(1);
  });

  it('FAQPage 结构正确（Question + acceptedAnswer）', () => {
    const schema = buildFaqSchema([
      { question: 'How many?', answer: '42.' },
      { question: 'Why?', answer: 'Because.' },
    ]);
    expect(schema['@type']).toBe('FAQPage');
    const main = schema.mainEntity as Array<Record<string, any>>;
    expect(main).toHaveLength(2);
    expect(main[0]['@type']).toBe('Question');
    expect(main[0].name).toBe('How many?');
    expect(main[0].acceptedAnswer['@type']).toBe('Answer');
    expect(main[0].acceptedAnswer.text).toBe('42.');
  });
});
