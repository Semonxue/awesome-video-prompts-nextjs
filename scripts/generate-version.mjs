/**
 * prebuild 脚本：生成 src/version.json
 * 在 next build 之前运行，输出 git SHA + build 时间
 * 供 src/lib/version.ts 在服务端读取
 */
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'src/version.json');

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

const payload = {
  sha,
  date,
  // 额外 build info
  branch: (() => {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT }).toString().trim();
    } catch {
      return 'unknown';
    }
  })(),
};

mkdirSync(resolve(ROOT, 'src'), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log(`[version] generated: sha=${payload.sha} date=${payload.date} branch=${payload.branch}`);
