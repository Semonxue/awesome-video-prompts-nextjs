/**
 * 版本信息
 * - 在 CF Workers 运行时：从环境变量读取（部署时通过 wrangler.toml env 注入）
 * - 本地 dev / fallback：使用 prebuild 生成的 version.json
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const APP_VERSION = '2.0.0';

interface VersionInfo {
  sha: string;
  date: string;
  branch: string;
}

function getFromEnv(): VersionInfo | null {
  const sha = process.env['APP_GIT_SHA'];
  const date = process.env['APP_BUILD_DATE'];
  const branch = process.env['APP_GIT_BRANCH'];
  if (sha && date && branch) {
    return { sha, date, branch };
  }
  return null;
}

function getFromFile(): VersionInfo {
  try {
    // 兼容 ESM 模块路径解析
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const filePath = join(__dirname, '..', 'version.json');
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as VersionInfo;
  } catch {
    return { sha: 'unknown', date: 'unknown', branch: 'unknown' };
  }
}

const info = getFromEnv() ?? getFromFile();

export const GIT_SHA = info.sha;
export const BUILD_DATE = info.date;
export const BUILD_BRANCH = info.branch;
export { APP_VERSION };

export const VERSION_STRING = GIT_SHA !== 'unknown'
  ? `v${APP_VERSION} · ${GIT_SHA}`
  : `v${APP_VERSION} · dev`;
