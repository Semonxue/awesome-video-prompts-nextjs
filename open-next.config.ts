/**
 * OpenNext → Cloudflare Workers 配置
 * 使用默认导出对象格式，避免新版 OpenNext 对配置校验时忽略自定义 wrapper。
 */
export default {
	default: {
		override: {
			wrapper: 'cache-control-cloudflare-node',
			converter: 'edge',
			proxyExternalRequest: 'fetch',
			incrementalCache: 'dummy',
			tagCache: 'dummy',
			queue: 'direct',
		},
	},
	edgeExternals: ['node:crypto'],
	middleware: {
		external: true,
		override: {
			wrapper: 'cloudflare-edge',
			converter: 'edge',
			proxyExternalRequest: 'fetch',
			incrementalCache: 'dummy',
			tagCache: 'dummy',
			queue: 'direct',
		},
	},
	cloudflare: {
		dangerousDisableConfigValidation: true,
	},
};