/**
 * Drizzle D1 客户端
 * 在 OpenNext Cloudflare Workers 运行时通过 context.cloudflare.env.DB 注入
 */
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export { schema };
export type { Prompt, Tag, Model } from './schema';