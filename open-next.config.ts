import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * OpenNext → Cloudflare Workers 配置
 *
 * 当前: incrementalCache 用 dummy（靠 ISR + 手动 revalidate）
 * Phase 3 升级: 接 R2 作为完整缓存层
 *
 * Wrapper: 通过 prebuild 覆盖官方 cloudflare-node wrapper（覆盖 Next.js 默认 no-store）
 *   - 详见 ./wrappers/cache-control-cloudflare-node.js
 *   - 由 prebuild:cf 脚本复制到 node_modules/@opennextjs/aws/dist/overrides/wrappers/
 *     并覆盖 cloudflare-node.js，避免 OpenNext 对自定义 wrapper 名称的校验崩溃
 *   - 作用：把 SSR HTML 页的 cache-control 从 `no-store` 改成
 *     `public, s-maxage=3600, stale-while-revalidate=86400`
 *   - 必要性：Next.js 15 page handler 在 sendRenderResult 阶段会重置 cache-control
 *     到 no-store，middleware 的设置被覆盖；唯一干净修复点在 OpenNext wrapper 层
 *
 * 为什么保留默认 wrapper 名：OpenNext validateConfig 会检查 wrapper 是否在兼容矩阵。
 * 使用未注册自定义名在某些版本会抛 TypeError（compatibilityMatrix[wrapper] undefined）。
 * 这里保持默认 cloudflare-node 名称，仅通过 prebuild 替换同名文件实现自定义行为。
 */
const config = defineCloudflareConfig();
config.cloudflare!.dangerousDisableConfigValidation = true;

export default config;