/**
 * 类别页内容生成（2026-10-22）
 *
 * 把 model 页 / tag 页从「筛选列表」升级成「内容页」—— 依据：
 *   - docs/research-model-tag-pages-as-content-pages.md（业界调研）
 *   - docs/SEO-STATUS-AND-COST-NEUTRAL-PLAN-2026-10-18.md §6.4
 *
 * 设计铁律（决定了本文件的所有写法）：
 *
 * 1. **零虚构**。
 *    Google 的 `scaled content abuse` 红线原文：
 *    "Using generative AI tools or other similar tools to generate many pages
 *    without adding value for users"。
 *    调研文档建议的「参数规格表（时长/分辨率/参考输入数）」若没有官方 API schema
 *    作为来源，就是编造 → 本站的 `data/models.yaml` 只有 `name` 字段，
 *    **没有任何规格数据源**。所以本文件不写规格，只写能从 D1 实际数据算出来的事实。
 *    宁可内容单薄，不可内容虚假 —— 虚假内容会让 Google 进一步降低质量判断。
 *
 * 2. **零新增 D1 查询**。
 *    所有输入都来自调用方已经加载好的数据（本页 items / counts 聚合 / tags 聚合）。
 *    新增查询 = 新增 D1 rows read，而 D1 是本站唯一在花钱的项的关联成本。
 *
 * 3. **每页内容必须不同**（防 doorway / scaled content）。
 *    内容由该页自己的数据（数量、占比、分布、排名）决定，
 *    两个不同的 tag 页不会有相同的导语与 FAQ。绝不使用固定模板句 + 变量填充
 *    那种「只有数字不同的模板」写法 —— 那种页面 Google 会判定为 scaled content。
 *
 * 4. **纯函数、可单测**。
 *    所有生成逻辑都在本文件，测试不需要 D1 binding。
 */

/** 一条 tag 的计数 */
export interface TagCount {
  slug: string;
  name: string;
  count: number;
}

/** 一条 model 的计数 */
export interface ModelCount {
  slug: string;
  name: string;
  count: number;
}

/**
 * 类别页的全量统计
 *
 * 结构与 `src/db/aggregate-cache.ts` 的 `TagStatsEntry` 一致，
 * 但在这里独立声明 —— 本文件必须保持"无 D1 / 无 CF SDK 依赖"才能单测。
 * TypeScript 的结构化类型让 db 层的对象可以直接传进来。
 *
 * ⚠️ 这里的每个 count 都必须是**全量真值**（该 tag/model 下所有 prompt 的统计），
 *    不能是"当前页 48 条"的现算值 —— 拿本页计数去和 tag 总数比较就是错的
 *    （实测 bug：cinematic 5,018 条却写成 "covering 41 of the 5,018"）。
 */
export interface CategoryStats {
  /** 该类别下所有 prompt 的 model 分布 */
  models: { slug: string; name: string; count: number }[];
  /** 与该类别共现最多的其它类别 */
  related: { slug: string; name: string; count: number }[];
  /** 该类别下所有 prompt 标题的词频 */
  words: { word: string; count: number }[];
}

/**
 * 描述词分布（用页面内 prompts 的实际词频算出的"这个类别最常见什么"）
 *
 * ⚠️ 只统计**有信息量**的词：长度 ≥ 4、纯字母、不在停用词表里。
 *    目的是让导语能写出"这个 tag 下最常见的是 cinematic/portrait 这类
 *    具体风格"，而不是"这个 tag 下有很多提示词"这种废话。
 */
export interface WordStat {
  word: string;
  count: number;
}

/** 英文停用词（只保留会让导语变废话的词） */
const STOPWORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'also', 'and', 'any', 'are',
  'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'can',
  'cannot', 'could', 'did', 'does', 'doing', 'down', 'during', 'each', 'few',
  'for', 'from', 'further', 'had', 'has', 'have', 'having', 'here', 'how',
  'into', 'its', 'itself', 'just', 'like', 'more', 'most', 'not', 'now', 'off',
  'once', 'only', 'other', 'our', 'out', 'over', 'own', 'same', 'should', 'some',
  'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'too', 'under', 'until', 'very', 'was',
  'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why',
  'will', 'with', 'would', 'you', 'your', 'video', 'prompt', 'prompts', 'scene',
  'shot', 'style', 'footage', 'clip', 'using', 'used', 'make', 'create',
  'creating', 'this', 'very', 'image', 'audio', 'quality',
]);

/**
 * 从标题里提取描述词频
 *
 * 为什么用标题而不是正文：
 *   - 标题已经是作者写的"这条 prompt 讲什么"（实测标题质量高）
 *   - 正文包含大量分镜描述、否定词、参数说明，词频会被噪声淹没
 *   - 标题短 → 词频更有区分度
 *
 * @param titles 该页 prompts 的标题
 * @param topN 取前 N 个
 * @param excludeWords 要排除的词（通常传该页自己的主题词）。
 *   原因：tag 页叫 "cinematic" 时，导语写"最常见的是 cinematic"是废话，
 *   浪费了导语里最宝贵的位置。排除后名额留给真正的搭配风格。
 */
export function extractWordStats(
  titles: string[],
  topN = 8,
  excludeWords: string[] = [],
): WordStat[] {
  const excluded = new Set(excludeWords.map((w) => w.toLowerCase()));
  const freq = new Map<string, number>();
  for (const title of titles) {
    const words = title.toLowerCase().match(/[a-z]{4,}/g);
    if (!words) continue;
    for (const w of words) {
      if (STOPWORDS.has(w)) continue;
      if (excluded.has(w)) continue;
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  return [...freq.entries()]
    .filter(([, c]) => c >= 2) // 至少出现 2 次才算"常见"
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));
}

/**
 * 生成类别页导语（tag 页用）
 *
 * 写法要求：
 *   - 说出**这个类别的规模和在全站的地位**（数据事实）
 *   - 说出**这个类别下最常见什么**（词频事实）
 *   - 说出**用什么模型做**（分布事实）
 *   - 每句都带该页自己的数字 → 不同 tag 页的导语天然不同
 *
 * @returns 若干段导语文本（每段一个语义单元，便于 SEO 读取）
 */
export function buildTagIntro(params: {
  tagName: string;
  count: number;
  total: number;
  stats: CategoryStats | null;
}): string[] {
  const { tagName, count, total, stats } = params;
  const paragraphs: string[] = [];

  // 第 1 段：规模与地位
  const share = total > 0 ? (count / total) * 100 : 0;
  paragraphs.push(
    share >= 1
      ? `This page collects all ${count.toLocaleString()} ${tagName} video prompts in our library — ${share.toFixed(1)}% of every prompt we publish. Every card shows the clip it was generated from and the model that made it; one click copies the prompt, and the title opens the entry page where the full text is written out.`
      : `This page collects ${count.toLocaleString()} ${tagName} video prompts from our library. Every card shows the clip it was generated from and the model that made it; one click copies the prompt, and the title opens the entry page where the full text is written out.`,
  );

  // 第 2 段：最常见什么（词频事实）
  // ⚠️ 统计不可用时**整段省略** —— 宁可少一句，也不能拿"当前页"的词频冒充全量。
  const words = stats?.words ?? [];
  if (words.length > 0) {
    const wordList = words.slice(0, 5).map((w) => w.word);
    const last = wordList[wordList.length - 1];
    const joined =
      wordList.length === 1
        ? last
        : `${wordList.slice(0, -1).join(', ')} and ${last}`;
    paragraphs.push(
      `Looking across the titles of these prompts, the most recurring subjects are ${joined}. That combination is a good signal for what a ${tagName} prompt usually has to nail: the subject itself, the camera treatment, and the lighting.`,
    );
  }

  // 第 3 段：用什么模型做（分布事实）
  const models = stats?.models ?? [];
  if (models.length > 0) {
    const modelList = models.slice(0, 4);
    const names = modelList.map((m) => m.name);
    const last = names[names.length - 1];
    const joined =
      names.length === 1 ? last : `${names.slice(0, -1).join(', ')} and ${last}`;
    const top = modelList[0];
    const topShare = count > 0 ? (top.count / count) * 100 : 0;
    paragraphs.push(
      `The models behind these prompts are ${joined}` +
        (topShare >= 20
          ? `, and ${top.count.toLocaleString()} of these prompts (${topShare.toFixed(0)}%) were generated with ${top.name}.`
          : `, with ${top.name} the most used of them at ${top.count.toLocaleString()} prompts.`),
    );
  }

  return paragraphs;
}

/**
 * 生成类别页导语（model 页用）
 *
 * 与 tag 版的差异：model 页的"规模"是**这个模型**的 prompt 数，
 * 而"最常见什么"应该来自**这个模型下的 tag 分布**（模型擅长什么风格），
 * 而不是 prompt 标题词频（同一个模型下标题词频区分度低）。
 */
export function buildModelIntro(params: {
  modelName: string;
  count: number;
  total: number;
  topTags: TagCount[];
  /** 与该 model 出现在同一条 prompt 上的其它 model（全量真值） */
  coModels: ModelCount[];
  /** 该 model 在全站的用量排名（真值，来自全站 model 计数） */
  modelRank: { rank: number; totalModels: number } | null;
}): string[] {
  const { modelName, count, total, topTags, coModels, modelRank } = params;
  const paragraphs: string[] = [];

  const share = total > 0 ? (count / total) * 100 : 0;
  paragraphs.push(
    share >= 1
      ? `All ${count.toLocaleString()} ${modelName} video prompts in our library, collected in one place — ${share.toFixed(1)}% of everything we publish. Every card shows the clip it was generated from and the model it came from; one click copies the prompt, and the title opens the entry page where the full text is written out.`
      : `All ${count.toLocaleString()} ${modelName} video prompts in our library, collected in one place. Every card shows the clip it was generated from and the model it came from; one click copies the prompt, and the title opens the entry page where the full text is written out.`,
  );

  // 第 2 段：这个模型下最常见的风格（tag 分布事实 —— listModelTagDistribution 是全量）
  if (topTags.length > 0) {
    const tagList = topTags.slice(0, 5);
    const names = tagList.map((t) => t.name);
    const last = names[names.length - 1];
    const joined =
      names.length === 1 ? last : `${names.slice(0, -1).join(', ')} and ${last}`;
    paragraphs.push(
      `The styles these prompts lean on are ${joined}. If you are new to ${modelName}, start with the first tag on the page and work across: the same model behaves very differently depending on whether you are asking for a static portrait or a moving camera.`,
    );
  }

  // 第 3 段：与其它 model 的关系
  // ⚠️ 两个分支都必须有真值支撑：
  //   - 共现 model 存在 → 写共现（同一批 prompt 上用过哪些 model）
  //   - 共现 model 为空（实测：绝大多数 prompt 只挂一个 model）→ 改写全站用量排名
  //   - 两者都没有 → 整段省略
  if (coModels.length > 0) {
    const others = coModels.slice(0, 3);
    const names = others.map((m) => m.name);
    const last = names[names.length - 1];
    const joined =
      names.length === 1 ? last : `${names.slice(0, -1).join(', ')} and ${last}`;
    paragraphs.push(
      `For prompts that need more than one model — the same subject restyled, or a shot that must match an existing clip — ${joined} are the ones most often generated alongside ${modelName}.`,
    );
  } else if (modelRank) {
    paragraphs.push(
      `By sheer volume it sits ${ordinal(modelRank.rank)} of the ${modelRank.totalModels} models we track, with ${count.toLocaleString()} published prompts of its own.`,
    );
  }

  return paragraphs;
}

/** FAQ 一条 */
export interface FaqItem {
  question: string;
  answer: string;
}

/** 英文序数词（1st / 2nd / 3rd / 4th …），用于"全站第 N 名"这类排名表述 */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * 生成 FAQ（tag 页用）
 *
 * 铁律：**答案必须是可验证的事实**，不能是营销话术。
 * 每条 FAQ 都由该页自己的数据算出来，所以不同 tag 页的 FAQ 内容不同。
 */
export function buildTagFaq(params: {
  tagName: string;
  count: number;
  total: number;
  stats: CategoryStats | null;
}): FaqItem[] {
  const { tagName, count, total, stats } = params;
  const faq: FaqItem[] = [];

  faq.push({
    question: `How many ${tagName} video prompts are there?`,
    answer:
      `We currently publish ${count.toLocaleString()} ${tagName} prompts` +
      (total > 0
        ? `, out of ${total.toLocaleString()} prompts in the whole library.`
        : '.'),
  });

  // 统计不可用 → 省略该问答（不能编数字）
  const models = stats?.models ?? [];
  if (models.length > 0) {
    const m = models[0];
    const share = count > 0 ? (m.count / count) * 100 : 0;
    faq.push({
      question: `Which model is most used for ${tagName} prompts?`,
      answer:
        `${m.name} is the most used model for this category, covering ${m.count.toLocaleString()} of the ${count.toLocaleString()} ${tagName} prompts (${share.toFixed(0)}%).` +
        (models.length > 1
          ? ` After it come ${models
              .slice(1, 3)
              .map((x) => x.name)
              .join(' and ')}.`
          : ''),
    });
  }

  const related = stats?.related ?? [];
  if (related.length > 0) {
    const relatedNames = related.slice(0, 3).map((t) => t.name);
    const last = relatedNames[relatedNames.length - 1];
    const joined =
      relatedNames.length === 1
        ? last
        : `${relatedNames.slice(0, -1).join(', ')} and ${last}`;
    const top = related[0];
    faq.push({
      question: `Which styles pair well with ${tagName}?`,
      answer: `The tags that most often appear alongside ${tagName} in the same prompt are ${joined} — ${top.name} alone shares a prompt with ${top.count.toLocaleString()} of them. Following those links is the fastest way to move from a look you like to the specific prompts that achieve it.`,
    });
  }

  faq.push({
    question: `How do I copy a ${tagName} prompt?`,
    answer:
      `Click the card (or the prompt text on it) and the prompt is copied to your clipboard. The card only shows the opening lines — the copy pulls the complete text first, so you get the whole prompt rather than the truncated preview.`,
  });

  return faq;
}

/**
 * 生成 FAQ（model 页用）
 */
export function buildModelFaq(params: {
  modelName: string;
  count: number;
  total: number;
  topTags: TagCount[];
  /** 与该 model 出现在同一条 prompt 上的其它 model（全量真值） */
  coModels: ModelCount[];
  /** 该 model 在全站的用量排名（真值） */
  modelRank: { rank: number; totalModels: number } | null;
}): FaqItem[] {
  const { modelName, count, total, topTags, coModels, modelRank } = params;
  const faq: FaqItem[] = [];

  faq.push({
    question: `How many ${modelName} video prompts are available?`,
    answer:
      `There are ${count.toLocaleString()} ${modelName} prompts in our library` +
      (total > 0
        ? `, which is ${((count / total) * 100).toFixed(1)}% of all ${total.toLocaleString()} prompts we publish.`
        : '.'),
  });

  if (topTags.length > 0) {
    const t = topTags[0];
    faq.push({
      question: `What kind of videos do people make with ${modelName}?`,
      answer: `The most common style in our ${modelName} collection is ${t.name}, appearing on ${t.count.toLocaleString()} of the ${count.toLocaleString()} prompts. The other frequent styles are ${topTags
        .slice(1, 3)
        .map((x) => x.name)
        .join(' and ')}.`,
    });
  }

  // 聚合不可用 → 省略该问答（不能编数字）
  if (coModels.length > 0) {
    const others = coModels.slice(0, 3);
    const names = others.map((m) => m.name);
    const last = names[names.length - 1];
    const joined =
      names.length === 1 ? last : `${names.slice(0, -1).join(', ')} and ${last}`;
    faq.push({
      question: `Which other models should I look at for ${modelName}?`,
      answer: `For the same subject rendered a different way, the models most often generated alongside ${modelName} in our library are ${joined}. Every model page lists the tags that go with it, so you can compare the same style across models.`,
    });
  } else if (modelRank) {
    faq.push({
      question: `How does ${modelName} compare with the other models here?`,
      answer: `By published prompt count it is the ${ordinal(modelRank.rank)} most used of the ${modelRank.totalModels} models we track, with ${count.toLocaleString()} prompts. Each model page lists the styles that go with it, so you can compare the same look across models.`,
    });
  }

  faq.push({
    question: `Is the prompt on this page the full text?`,
    answer:
      `Yes. The entry page writes out the complete prompt text, links back to the original source post, and plays the clip so you can check the result before you write your own version.`,
  });

  return faq;
}

/**
 * 生成 CollectionPage / ItemList 结构化数据（tag 页）
 *
 * 为什么用 ItemList：Google 把它理解为「这个页面上有一组同类条目」，
 * 与 tag 页的语义（一个类别的条目集合）完全吻合，比 Article 更贴切。
 */
export function buildTagCollectionSchema(params: {
  tagName: string;
  url: string;
  items: Array<{ name: string; url: string }>;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${params.tagName} AI Video Prompts`,
    url: params.url,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: params.items.length,
      itemListElement: params.items.map((it, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: it.name,
        url: it.url,
      })),
    },
  };
}

/**
 * 生成 CollectionPage / ItemList 结构化数据（model 页）
 */
export function buildModelCollectionSchema(params: {
  modelName: string;
  url: string;
  items: Array<{ name: string; url: string }>;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${params.modelName} AI Video Prompts`,
    url: params.url,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: params.items.length,
      itemListElement: params.items.map((it, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: it.name,
        url: it.url,
      })),
    },
  };
}

/**
 * 生成 FAQPage 结构化数据
 *
 * ⚠️ Google 的政策：FAQPage 结构化数据**只对知名政府/医疗类站点**在搜索结果里展示富摘要，
 *    其他站点不会显示。但它仍有两个作用：① 帮助 Google 理解页面问答结构
 *    ② 是页面内容为 FAQ 形态的机器可读标记。所以值得加。
 */
export function buildFaqSchema(faq: FaqItem[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}
