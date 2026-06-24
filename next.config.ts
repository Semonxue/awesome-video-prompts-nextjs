import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // 媒体走 R2 自定义域，不走 next/image 优化（已经过 Cloudflare CDN）
  images: {
    unoptimized: true,
  },
};

export default withNextIntl(nextConfig);