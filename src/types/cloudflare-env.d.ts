/**
 * CloudflareEnv 类型扩展 — 让 wrangler.toml 里的 binding 在 TS 里可用
 *
 * 来源：wrangler.toml:
 *   - [[d1_databases]] binding = "DB"        → env.DB: D1Database
 *   - [[r2_buckets]]    binding = "MEDIA"     → env.MEDIA: R2Bucket
 */
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    MEDIA: R2Bucket;
  }
}

export {};
