-- ============================================================
-- Awesome Video Prompts — D1 冗余索引清理（2026-08-07）
--
-- 背景：线上存在 0000/0001 叠加产生的冗余索引，拖慢每次写入
--   （INSERT/UPDATE 需维护多个索引）。数据验证确认无膨胀/重复/孤儿。
--
-- 冗余判定（被保留索引覆盖）：
--   idx_prompts_is_draft (is_draft)
--     ← 被 idx_prompts_draft_date (is_draft, prompt_date DESC, id DESC) 覆盖
--   idx_prompts_is_draft_prompt_date (is_draft, prompt_date)
--     ← 与 idx_prompts_draft_date 功能重叠
--   idx_prompts_prompt_date (prompt_date)
--     ← 被 idx_prompts_draft_date 覆盖（is_draft=0 场景）
--   idx_prompt_tags_tag (tag_id)
--     ← 被 idx_prompt_tags_tag_prompt (tag_id, prompt_id) 覆盖
--   idx_prompt_tags_tag_id (tag_id)
--     ← 与 idx_prompt_tags_tag 重复
--   idx_prompt_models_model (model_id)
--     ← 被 idx_prompt_models_model_prompt (model_id, prompt_id) 覆盖
--   idx_prompt_models_model_id (model_id)
--     ← 与 idx_prompt_models_model 重复
--
-- 保留：
--   idx_prompts_draft_date (is_draft, prompt_date DESC, id DESC)  — 首页分页
--   idx_prompts_slug_draft (slug, is_draft)                        — 详情页
--   idx_prompt_tags_tag_prompt (tag_id, prompt_id)                 — tag 聚合/筛选
--   idx_prompt_models_model_prompt (model_id, prompt_id)           — model 聚合/筛选
--   sqlite_autoindex_*（自动索引，勿删）
--
-- 应用方式：
--   npx wrangler d1 execute awesomevideoprompts-db --remote --file=./drizzle/migrations/0002_drop_redundant_indexes.sql
-- ============================================================

DROP INDEX IF EXISTS idx_prompts_is_draft;
DROP INDEX IF EXISTS idx_prompts_is_draft_prompt_date;
DROP INDEX IF EXISTS idx_prompts_prompt_date;
DROP INDEX IF EXISTS idx_prompt_tags_tag;
DROP INDEX IF EXISTS idx_prompt_tags_tag_id;
DROP INDEX IF EXISTS idx_prompt_models_model;
DROP INDEX IF EXISTS idx_prompt_models_model_id;