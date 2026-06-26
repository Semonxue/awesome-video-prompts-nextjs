/**
 * Pre-build: 把自定义 cache-control wrapper 复制到 OpenNext 期望的位置
 *
 * 原因：OpenNext 的 openNextResolvePlugin 在 esbuild 静态扫描时只识别字符串 override，
 *       会把 import("../overrides/wrappers/aws-lambda.js") 替换成 import("../overrides/wrappers/${userOverride}.js")
 *       用户自定义 wrapper 必须放在 node_modules/@opennextjs/aws/dist/overrides/wrappers/ 下
 *
 * 行为：
 *   - 复制 ./wrappers/cache-control-cloudflare-node.js → node_modules/.../wrappers/cache-control-cloudflare-node.js
 *   - 幂等（每次都覆盖）
 */
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('./wrappers/cache-control-cloudflare-node.js');
const dest = path.resolve(
  './node_modules/@opennextjs/aws/dist/overrides/wrappers/cache-control-cloudflare-node.js',
);

if (!fs.existsSync(src)) {
  console.error(`[prebuild:cf] wrapper not found: ${src}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log(`[prebuild:cf] copied wrapper → ${path.relative(process.cwd(), dest)}`);
