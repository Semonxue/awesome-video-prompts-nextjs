-- ============================================================
-- Awesome Video Prompts — D1 schema init
-- 对应 src/db/schema.ts（drizzle 0.45.x）
--
-- 设计决策：
--   - prompts 不分 locale（用户要求内容一致；UI 多语言由 next-intl 处理）
--   - tags/models 全局唯一（不分 locale）
--   - slug 唯一：每个 prompt 一条 row
-- ============================================================

CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
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
CREATE INDEX IF NOT EXISTS idx_prompts_is_draft ON prompts(is_draft);
