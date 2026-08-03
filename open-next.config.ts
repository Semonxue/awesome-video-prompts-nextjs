import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * OpenNext → Cloudflare Workers 配置
 *
 * 当前: incrementalCache 用 dummy（靠 ISR + 手动 revalidate）
 * Phase 3 升级: 接 R2 作为完整缓存层
 *
 * Wrapper: 自定义 cache-control wrapper（覆盖 Next.js 默认 no-store）
 *   - 详见 ./wrappers/cache-control-cloudflare-node.js
 *   - 由 prebuild:cf 脚本复制到 node_modules/@opennextjs/aws/dist/overrides/wrappers/
 *     这样 OpenNext 的 openNextResolvePlugin 才能在 esbuild 时静态找到它
 *   - 作用：把 SSR HTML 页的 cache-control 从 `no-store` 改成
 *     `public, s-maxage=3600, stale-while-revalidate=86400`
 *   - 必要性：Next.js 15 page handler 在 sendRenderResult 阶段会重置 cache-control
 *     到 no-store，middleware 的设置被覆盖；唯一干净修复点在 OpenNext wrapper 层
 *
 * 为什么 mutate 而不是新构造：defineCloudflareConfig 返回完整默认配置
 * （default.override.wrapper = "cloudflare-node" + middleware.override.wrapper = "cloudflare-edge" 等），
 * 我们只替换 default.override.wrapper，其余保持默认，避免重新拼装整个 config 出错。
 */
const config = defineCloudflareConfig();
// @ts-expect-error - CloudflareOverrides 类型不暴露 override，但运行时支持
config.default.override.wrapper = 'cache-control-cloudflare-node';
config.cloudflare!.dangerousDisableConfigValidation = true;

export default config;