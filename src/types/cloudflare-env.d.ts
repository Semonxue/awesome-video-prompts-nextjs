/**
 * CloudflareEnv 类型扩展 — 让 wrangler.toml 里的 binding 在 TS 里可用
 *
 * 来源：wrangler.toml:
 *   - [[d1_databases]] binding = "DB"        → env.DB: D1Database
 *   - [[r2_buckets]]    binding = "MEDIA"     → env.MEDIA: R2Bucket
 *
 * Secrets（不在 wrangler.toml，通过 wrangler secret put 设置）：
 *   - ADMIN_SECRET        → env.ADMIN_SECRET
 *   - REVALIDATE_SECRET   → env.REVALIDATE_SECRET
 */
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    MEDIA: R2Bucket;
    ADMIN_SECRET?: string;
    REVALIDATE_SECRET?: string;
    NEXT_PUBLIC_R2_PUBLIC_URL?: string;
  }
}

export {};
