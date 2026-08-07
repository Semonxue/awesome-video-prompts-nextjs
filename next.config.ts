import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // 媒体走 R2 自定义域，不走 next/image 优化（已经过 Cloudflare CDN）
  images: {
    unoptimized: true,
  },
  // data/models.yaml + data/tags.yaml 在编译期作为 raw source bundle 进代码
  // （Workers runtime 没有 fs，不能运行时读文件；必须静态嵌入）
  // 配合 src/lib/dict-yaml.ts 的 import 使用。
  webpack: (config) => {
    config.module.rules.push({
      test: /\.yaml$/,
      type: 'asset/source',
    });
    return config;
  },
};

export default withNextIntl(nextConfig);