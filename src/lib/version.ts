/**
 * 版本信息
 * - 在 CF Workers 运行时：从环境变量读取（部署时通过 wrangler --var 注入）
 * - 本地 dev / fallback：使用 prebuild 生成的 version-generated.ts（内联进 bundle）
 */
import {
  BUNDLED_VERSION,
  BUNDLED_SHA,
  BUNDLED_DATE,
  BUNDLED_BRANCH,
} from '../version-generated';

function getFromEnv(): { version: string; sha: string; date: string; branch: string } | null {
  const sha = process.env['APP_GIT_SHA'];
  const date = process.env['APP_BUILD_DATE'];
  const branch = process.env['APP_GIT_BRANCH'];
  if (sha && date && branch) {
    return {
      version: process.env['APP_VERSION'] || BUNDLED_VERSION,
      sha,
      date,
      branch,
    };
  }
  return null;
}

const info = getFromEnv() ?? {
  version: BUNDLED_VERSION,
  sha: BUNDLED_SHA,
  date: BUNDLED_DATE,
  branch: BUNDLED_BRANCH,
};

export const APP_VERSION = info.version;
export const GIT_SHA = info.sha;
export const BUILD_DATE = info.date;
export const BUILD_BRANCH = info.branch;

export const VERSION_STRING =
  GIT_SHA !== 'unknown'
    ? `v${APP_VERSION} · ${GIT_SHA}`
    : `v${APP_VERSION} · dev`;