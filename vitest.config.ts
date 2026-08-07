import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 把 .yaml 当 raw string 加载（默认 export 是字符串内容）
 *
 * next.config.ts 用 webpack rule { test: /\.yaml$/, type: 'asset/source' }；
 * vitest 走 Vite，需要手写一个 plugin 让 `import x from 'foo.yaml'` 拿到 string。
 * 与 src/types/yaml.d.ts 的 ambient 声明配套使用。
 */
const yamlAsStringPlugin = {
  name: 'yaml-as-string',
  enforce: 'pre' as const,
  transform(_code: string, id: string) {
    if (id.endsWith('.yaml') && !id.endsWith('.d.ts')) {
      const content = fs.readFileSync(id, 'utf8');
      return {
        code: `export default ${JSON.stringify(content)}`,
        map: null,
      };
    }
  },
};

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  assetsInclude: ['**/*.yaml'],
  plugins: [yamlAsStringPlugin],
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'src/**/*.{test,spec}.tsx'],
  },
});