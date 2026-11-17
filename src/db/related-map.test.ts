import { describe, expect, it } from 'vitest';
import { buildRelatedMap, RELATED_CANDIDATE_LIMIT } from './queries';

/**
 * buildRelatedMap 是纯函数（2026-11-17 publish 提速时抽出来的）。
 *
 * 语义必须与旧实现完全一致：
 *   1. 候选 = 共享任一 tag/model 的其它 prompt，按 rank（发布时间 DESC）取最新 N 个
 *   2. 打分：共享 model +10 / 共享 tag +2
 *   3. 排序：分数 DESC，再 promptDate DESC
 */
const P = (id: number, slug: string, promptDate: string) => ({ id, slug, promptDate });

function mapOf(entries: Record<number, string[]>) {
  const m = new Map<number, Set<string>>();
  for (const [id, arr] of Object.entries(entries)) m.set(Number(id), new Set(arr));
  return m;
}

describe('buildRelatedMap', () => {
  it('共享 model 比共享 tag 权重高（10 vs 2）', () => {
    const prompts = [P(1, 'target', '2026-03-01'), P(2, 'same-model', '2026-02-01'), P(3, 'four-tags', '2026-03-02')];
    const result = buildRelatedMap({
      prompts,
      tagByPromptId: mapOf({
        1: ['a', 'b', 'c', 'd'],
        2: ['x'],
        3: ['a', 'b', 'c', 'd'],
      }),
      modelByPromptId: mapOf({ 1: ['seedance'], 2: ['seedance'], 3: [] }),
    });
    // same-model: 10 分；four-tags: 8 分
    expect(result.target).toEqual(['same-model', 'four-tags']);
  });

  it('候选池只保留最新的 N 个（复刻旧实现「先按 rank 裁到 100 再打分」的语义）', () => {
    // 6 个候选都共享同一个 tag；target 另外和「最旧的那个」共享 model。
    // 候选池限 3 → 最旧的候选根本没进池，即使它分数最高。
    const prompts = [
      P(1, 'target', '2026-06-01'),
      P(2, 'c1', '2026-05-01'),
      P(3, 'c2', '2026-04-01'),
      P(4, 'c3', '2026-03-01'),
      P(5, 'c4', '2026-02-01'),
      P(6, 'oldest-but-same-model', '2026-01-01'),
    ];
    const result = buildRelatedMap(
      {
        prompts,
        tagByPromptId: mapOf({ 1: ['shared'], 2: ['shared'], 3: ['shared'], 4: ['shared'], 5: ['shared'], 6: ['shared'] }),
        modelByPromptId: mapOf({ 1: ['m'], 6: ['m'] }),
      },
      6,
      3,
    );
    expect(result.target).not.toContain('oldest-but-same-model');
    expect(result.target).toHaveLength(3);
    expect(result.target).toEqual(['c1', 'c2', 'c3']);
  });

  it('排除自己，且无共享 tag/model 时返回空数组', () => {
    const prompts = [P(1, 'lonely', '2026-01-02'), P(2, 'other', '2026-01-01')];
    const result = buildRelatedMap({
      prompts,
      tagByPromptId: mapOf({ 1: ['only-me'], 2: ['another'] }),
      modelByPromptId: mapOf({}),
    });
    expect(result.lonely).toEqual([]);
    expect(result.other).toEqual([]);
  });

  it('分数相同时按 promptDate DESC', () => {
    const prompts = [P(1, 'target', '2026-03-01'), P(2, 'older', '2026-01-01'), P(3, 'newer', '2026-02-01')];
    const result = buildRelatedMap({
      prompts,
      tagByPromptId: mapOf({ 1: ['t'], 2: ['t'], 3: ['t'] }),
      modelByPromptId: mapOf({}),
    });
    expect(result.target).toEqual(['newer', 'older']);
  });

  it('默认候选上限 = 100，输出条数不超过 perPrompt', () => {
    expect(RELATED_CANDIDATE_LIMIT).toBe(100);
    const prompts = [P(1, 'target', '2026-06-01')];
    const tags: Record<number, string[]> = { 1: ['big'] };
    const models: Record<number, string[]> = { 1: [] };
    for (let i = 2; i <= 260; i++) {
      prompts.push(P(i, `p${i}`, '2026-01-01'));
      tags[i] = ['big'];
      models[i] = [];
    }
    const result = buildRelatedMap({
      prompts,
      tagByPromptId: mapOf(tags),
      modelByPromptId: mapOf(models),
    });
    expect(result.target).toHaveLength(12); // 默认 RELATED_PER_PROMPT
    // 候选池按 rank 取最新 100 → id 2..101（同日期时按传入顺序，即 rank 顺序）
    expect(result.target[0]).toBe('p2');
    expect(result.target).not.toContain('p102');
  });
});
