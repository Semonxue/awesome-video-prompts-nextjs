import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * OpenNext → Cloudflare Workers 配置
 *
 * 当前: incrementalCache 用 dummy（靠 ISR + 手动 revalidate）
 * Phase 3 升级: 接 R2 作为完整缓存层
 */
export default defineCloudflareConfig({});