-- ============================================================
-- Awesome Video Prompts — D1 schema init
-- 对应 src/db/schema.ts（drizzle 0.45.x）
-- ============================================================

CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  video_url TEXT,
  cover_url TEXT,
  source_url TEXT,
  author TEXT,
  prompt_date TEXT,
  is_draft INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 唯一索引：(slug, locale) — 同一 slug 不同语言允许多条
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_slug_locale ON prompts(slug, locale);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS prompt_tags (
  prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (prompt_id, tag_id)
);

CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_models (
  prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  PRIMARY KEY (prompt_id, model_id)
);

-- 索引：按 prompt_date DESC 排序 + 过滤
CREATE INDEX IF NOT EXISTS idx_prompts_prompt_date ON prompts(prompt_date DESC);
CREATE INDEX IF NOT EXISTS idx_prompts_locale ON prompts(locale);
CREATE INDEX IF NOT EXISTS idx_prompts_is_draft ON prompts(is_draft);
