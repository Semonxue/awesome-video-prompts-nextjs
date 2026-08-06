-- ============================================================
-- Awesome Video Prompts — D1 performance indexes
-- 对应线上慢查询优化（2026-08-07）
--
-- 背景：线上 D1 慢查询全部是全表扫描（读 1B / 77M / 61M / 140M / 160M 行）
--   根因是缺复合索引，不是缓存。加索引后查询从"扫全表"变"走索引"。
--
-- 应用方式：
--   npx wrangler d1 execute awesomevideoprompts-db --remote --file=./drizzle/migrations/0001_indexes.sql
-- ============================================================

-- 首页/分页：WHERE is_draft=0 ORDER BY prompt_date DESC, id DESC
-- 覆盖 listPrompts() 主查询 + offset 分页
CREATE INDEX IF NOT EXISTS idx_prompts_draft_date
  ON prompts(is_draft, prompt_date DESC, id DESC);

-- 详情页：WHERE slug=? AND is_draft=0
-- 覆盖 getPromptBySlug()（原 is_draft 过滤导致未走 slug 唯一索引）
CREATE INDEX IF NOT EXISTS idx_prompts_slug_draft
  ON prompts(slug, is_draft);

-- tag 筛选子查询：WHERE tag_id=?
-- 覆盖 listPrompts({tag}) 的 IN (SELECT ... WHERE tags.name=?)
-- 原表只有 PK (prompt_id, tag_id)，无 tag_id 前缀索引
CREATE INDEX IF NOT EXISTS idx_prompt_tags_tag
  ON prompt_tags(tag_id);

-- model 筛选子查询：WHERE model_id=?
-- 覆盖 listPrompts({model}) 的 IN (SELECT ... WHERE models.slug=?)
CREATE INDEX IF NOT EXISTS idx_prompt_models_model
  ON prompt_models(model_id);

-- 聚合查询：listAllTags() 的 JOIN + GROUP BY
-- 覆盖 tags 聚合（40% 慢查询，读 1B 行）
CREATE INDEX IF NOT EXISTS idx_prompt_tags_tag_prompt
  ON prompt_tags(tag_id, prompt_id);

-- 聚合查询：listAllModels() 的 JOIN + GROUP BY
-- 覆盖 models 聚合（13.9% 慢查询，读 250M 行）
CREATE INDEX IF NOT EXISTS idx_prompt_models_model_prompt
  ON prompt_models(model_id, prompt_id);