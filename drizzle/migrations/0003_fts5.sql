-- ============================================================
-- Awesome Video Prompts — D1 FTS5 全文搜索索引
-- 对应 Q4 慢查询优化（2026-08-20 12h 观测）
--   原 OR LIKE 全表扫：5,211 rows/call × 20 calls = 104k rows read
--   FTS5 倒排索引后：毫秒级返回，预期 < 1k rows total
--
-- 设计决策：
--   - contentless mode（不重复存字段，节省空间；FTS5 只存 token 倒排索引）
--   - unicode61 + remove_diacritics + case-insensitive（兼容多语言 prompt）
--   - rowid 同步 prompts.id（通过触发器维护，listPrompts({q}) 用 id IN (subquery) 衔接）
--   - 触发器过滤 is_draft=0：草稿不进搜索（用户不应该搜到 draft）
--   - CJK 风险（已知）：unicode61 tokenizer 对 CJK 词边界处理弱
--     短期可接受（搜索使用率 20/12h，Q4 改完用的人都少）
--     长期若 CJK 搜索成问题：换 trigram tokenize 或保留 LIKE 兜底
--
-- 应用方式（生产）：
--   npx wrangler d1 execute awesomevideoprompts-db --remote \
--     --file=./drizzle/migrations/0003_fts5.sql
--   本地：
--   npx wrangler d1 execute prompts-db --local \
--     --file=./drizzle/migrations/0003_fts5.sql
-- ============================================================

-- 1) FTS5 virtual table
--    content='' = contentless（不存原文，rowid 关联 prompts.id 即可）
--    tokenize='unicode61 remove_diacritics 2' = 标准分词 + 去音标 + 不区分大小写
CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
  title,
  description,
  slug,
  author,
  content='',
  tokenize='unicode61 remove_diacritics 2'
);

-- 2) 同步触发器
--    策略：DELETE + INSERT（"delete" 命令删除 + 重新插入新值）
--    覆盖 INSERT / UPDATE / DELETE 全场景

-- INSERT：仅 is_draft=0 的才入索引（草稿不入搜索）
CREATE TRIGGER IF NOT EXISTS prompts_ai_fts
  AFTER INSERT ON prompts
  WHEN NEW.is_draft = 0
  BEGIN
    INSERT INTO prompts_fts(rowid, title, description, slug, author)
    VALUES (NEW.id, NEW.title, NEW.description, NEW.slug, NEW.author);
  END;

-- UPDATE：先删旧的（无论新 is_draft 状态），再插新的（仅 is_draft=0）
-- 无 OF 子句：title/description/slug/author/is_draft 任何字段更新都触发
CREATE TRIGGER IF NOT EXISTS prompts_au_fts
  AFTER UPDATE ON prompts
  BEGIN
    INSERT INTO prompts_fts(prompts_fts, rowid, title, description, slug, author)
    VALUES ('delete', OLD.id, OLD.title, OLD.description, OLD.slug, OLD.author);
    INSERT INTO prompts_fts(rowid, title, description, slug, author)
    SELECT NEW.id, NEW.title, NEW.description, NEW.slug, NEW.author
    WHERE NEW.is_draft = 0;
  END;

-- DELETE：硬删
CREATE TRIGGER IF NOT EXISTS prompts_ad_fts
  AFTER DELETE ON prompts
  BEGIN
    INSERT INTO prompts_fts(prompts_fts, rowid, title, description, slug, author)
    VALUES ('delete', OLD.id, OLD.title, OLD.description, OLD.slug, OLD.author);
  END;

-- 3) Backfill：现有 published prompts 全部导入 FTS5
--    5,055 行（按 AGENTS.md 截至 2026-08-15）一次性导入，毫秒级
INSERT INTO prompts_fts(rowid, title, description, slug, author)
SELECT id, title, description, slug, author
FROM prompts
WHERE is_draft = 0;
