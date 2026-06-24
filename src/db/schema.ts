/**
 * Drizzle ORM Schema — Awesome Video Prompts
 *
 * 设计决策（详见 docs/EXECUTION.md）：
 * - tags/models 多对多
 * - prompt_date / created_at / updated_at 都用 TEXT 存 ISO 8601
 * - 不上 FTS5（CJK 走 LIKE 兜底）
 * - is_draft 用于过滤草稿
 */

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const prompts = sqliteTable('prompts', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull(),
  locale: text('locale').notNull().default('en'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  videoUrl: text('video_url'),
  coverUrl: text('cover_url'),
  sourceUrl: text('source_url'),
  author: text('author'),
  promptDate: text('prompt_date'), // ISO 8601 YYYY-MM-DD 或 YYYY-MM-01
  isDraft: integer('is_draft', { mode: 'number' }).notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const tags = sqliteTable('tags', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

export const promptTags = sqliteTable('prompt_tags', {
  promptId: integer('prompt_id', { mode: 'number' }).notNull().references(() => prompts.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id', { mode: 'number' }).notNull().references(() => tags.id, { onDelete: 'cascade' }),
});

export const models = sqliteTable('models', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
});

export const promptModels = sqliteTable('prompt_models', {
  promptId: integer('prompt_id', { mode: 'number' }).notNull().references(() => prompts.id, { onDelete: 'cascade' }),
  modelId: integer('model_id', { mode: 'number' }).notNull().references(() => models.id, { onDelete: 'cascade' }),
});

export type Prompt = typeof prompts.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Model = typeof models.$inferSelect;
export type PromptInsert = typeof prompts.$inferInsert;