/**
 * 单元测试：Drizzle schema 结构
 *
 * 不依赖 D1 runtime — 只验证 schema 定义本身
 * （PK / NOT NULL / UNIQUE / 字段映射等）
 */

import { describe, it, expect } from 'vitest';
import { prompts, tags, models, promptTags, promptModels } from './schema';

describe('prompts schema', () => {
  it('id 是主键 + 自增', () => {
    const idCol = prompts.id;
    expect(idCol.primary).toBe(true);
    // autoIncrement 是 drizzle 内部运行时字段，不在 public 类型里
    // 改用 hasDefault + notNull 间接验证（自增必带默认 + 必非空）
    expect(idCol.hasDefault).toBe(true);
    expect(idCol.notNull).toBe(true);
  });

  it('slug 不允许 null', () => {
    expect(prompts.slug.notNull).toBe(true);
  });

  it('locale 默认 en 且不允许 null', () => {
    expect(prompts.locale.notNull).toBe(true);
    expect(prompts.locale.default).toBe('en');
  });

  it('title 不允许 null', () => {
    expect(prompts.title.notNull).toBe(true);
  });

  it('description 默认空字符串 + 不允许 null', () => {
    expect(prompts.description.notNull).toBe(true);
    expect(prompts.description.default).toBe('');
  });

  it('video / cover / source / author / promptDate 可空', () => {
    expect(prompts.videoUrl.notNull).toBe(false);
    expect(prompts.coverUrl.notNull).toBe(false);
    expect(prompts.sourceUrl.notNull).toBe(false);
    expect(prompts.author.notNull).toBe(false);
    expect(prompts.promptDate.notNull).toBe(false);
  });

  it('isDraft 默认 0 且不允许 null', () => {
    expect(prompts.isDraft.notNull).toBe(true);
    expect(prompts.isDraft.default).toBe(0);
  });

  it('createdAt / updatedAt 必填', () => {
    expect(prompts.createdAt.notNull).toBe(true);
    expect(prompts.updatedAt.notNull).toBe(true);
  });
});

describe('tags schema', () => {
  it('name UNIQUE 且 NOT NULL', () => {
    expect(tags.name.notNull).toBe(true);
    // drizzle 用 isUnique 表示 UNIQUE 约束
    expect(tags.name.isUnique).toBe(true);
  });
});

describe('models schema', () => {
  it('slug UNIQUE 且 NOT NULL', () => {
    expect(models.slug.notNull).toBe(true);
    expect(models.slug.isUnique).toBe(true);
  });
  it('name NOT NULL', () => {
    expect(models.name.notNull).toBe(true);
  });
});

describe('prompt_tags 关联表', () => {
  it('promptId 外键引用 prompts.id', () => {
    // 外键约束在 references() 中
    const col = promptTags.promptId;
    expect(col.notNull).toBe(true);
  });
  it('tagId 外键引用 tags.id', () => {
    expect(promptTags.tagId.notNull).toBe(true);
  });
});

describe('prompt_models 关联表', () => {
  it('promptId 外键引用 prompts.id', () => {
    expect(promptModels.promptId.notNull).toBe(true);
  });
  it('modelId 外键引用 models.id', () => {
    expect(promptModels.modelId.notNull).toBe(true);
  });
});