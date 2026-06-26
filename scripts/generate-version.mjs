/**
 * prebuild 脚本：生成 src/version-generated.ts
 * 在 next build 之前运行，版本数据内联进 bundle，运行时无需读文件
 */
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'src/version-generated.ts');

// 读取 package.json 的 version 字段
let pkgVersion = '0.0.0';
try {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  pkgVersion = pkg.version || '0.0.0';
} catch {
  // fallback
}

let sha = 'unknown';
let date = new Date().toISOString().slice(0, 19).replace(/T/, ' ');

try {
  sha = execSync('git rev-parse --short HEAD', { cwd: ROOT })
    .toString()
    .trim();
} catch {
  // CI 环境下 git 不可用，sha = unknown
}

try {
  date = execSync('date "+%Y-%m-%d %H:%M:%S"', { cwd: ROOT })
    .toString()
    .trim();
} catch {
  // fallback to ISO
}

const branch = (() => {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT }).toString().trim();
  } catch {
    return 'unknown';
  }
})();

mkdirSync(resolve(ROOT, 'src'), { recursive: true });
// 生成 TypeScript 文件，version.ts 直接 import 它
writeFileSync(OUT, `// 此文件由 prebuild 自动生成，不要手动修改
export const BUNDLED_VERSION = '${pkgVersion}' as const;
export const BUNDLED_SHA = '${sha}' as const;
export const BUNDLED_DATE = '${date}' as const;
export const BUNDLED_BRANCH = '${branch}' as const;
`);
console.log(`[version] generated: version=${pkgVersion} sha=${sha} date=${date} branch=${branch}`);
