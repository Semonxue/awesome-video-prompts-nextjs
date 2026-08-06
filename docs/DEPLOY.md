# Deployment Guide — awesome-video-prompts-nextjs

> 本地开发 → 测试 → 部署到 Cloudflare Workers 的完整流程。
> 适用于日常 dev 版本发布。Phase 6 灰度切主域另见 EXECUTION.md §6。

---

## 环境概览

```
本地开发    ──→  Git push   ──→  GitHub Actions CI
                                    │
                              npm run build
                              npm run build:cf
                              npx wrangler deploy --env=""
                                    │
                              ✅ 线上验证
                                    │
                              ⚠️ 手动 CF Dashboard 配置（如需要）
```

---

## 0. 前置条件（首次配置）

### 0.1 工具安装

```bash
node --version   # 要求 ≥ 20.x
npm --version    # 要求 ≥ 10.x
npx wrangler --version  # 要求 ≥ 4.x
```

### 0.2 凭证配置

在项目根目录创建 `.dev.vars`（**gitignored**，不要提交）：

```bash
CLOUDFLARE_API_TOKEN=your_cf_user_api_token   # 见 CF Dashboard → Profile → API Tokens
CLOUDFLARE_ACCOUNT_ID=a5dfcda3d7f7b488c2597d8dcdf54cca
D1_DATABASE_ID=486ccac9-d364-4db4-b911-d4a420bcbc6c
R2_BUCKET=awesome-video-prompts-media
R2_PUBLIC_URL=https://static.awesomevideoprompts.com
LEGACY_CONTENT_DIR=/Users/semonxue/Workplace/Works/ai-dev/awesome-video-prompts/content
REVALIDATE_SECRET=your_random_secret_string   # 随便设，POST /api/revalidate 时用
NEXT_PUBLIC_SITE_URL=https://awesome-video-prompts-nextjs.semonxue.workers.dev
NEXT_PUBLIC_R2_PUBLIC_URL=https://static.awesomevideoprompts.com
```

> ⚠️ **Token 安全**：当前 token 已在对话中出现多次。**每次部署前**去 CF Dashboard revoke 并重建，TTL 设 24h。Token 权限要求：`Account | D1 | Edit` + `Workers Scripts | Edit` + `Account Settings | Read`。

#### GitHub Actions 凭证（必须单独配置）

本地 `.dev.vars` **不会**被上传到 GitHub Actions。请在 GitHub 仓库进入 **Settings → Secrets and variables → Actions → Repository secrets**，创建以下两个 secret（名称区分大小写）：

| Secret | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（不是 Global API Key） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |

也可以用 GitHub CLI 安全地交互输入（不要把 token 直接写进命令或提交到仓库）：

```bash
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
```

配置后，在仓库 **Actions → Deploy to Cloudflare Workers → Run workflow** 手动重跑。工作流会在构建前检查这两个值；缺失时会直接给出明确错误，而不是等到 Wrangler 部署阶段才失败。

### 0.3 凭证环境变量（本地 dev 时加载）

```bash
# 方式 A：自动加载 .dev.vars（wrangler 4.x 原生支持）
npx wrangler dev   # 自动读取 .dev.vars

# 方式 B：手动 export
export $(grep -v '^#' .dev.vars | xargs)
```

---

## 1. 本地开发

```bash
# 安装依赖
npm install

# 启动本地 dev server（端口 8787）
npm run dev
# 访问 http://localhost:8788/en
# D1 数据走本地 SQLite（.wrangler/state/）
```

**注意**：本地 dev 时 `npx wrangler dev` 会自动读取 `.dev.vars`，无需手动 export。

---

## 2. 提交代码

```bash
git add .
git commit -m "feat: 你的改动描述"
git push origin main
```

> **GitHub Actions 自动触发**：push 后 CI 会自动跑 type-check + tests + build + deploy。

---

## 3. 手动部署（跳过 CI，直接本地推）

### 方式 A：一键脚本（推荐）

```bash
# 完整流程（type-check + test + build + deploy + 冒烟验证）
./scripts/deploy.sh

# 跳过 test（改 CSS / 文档时用）
./scripts/deploy.sh --skip-test

# dry-run（只 build 不 deploy）
./scripts/deploy.sh --dry-run
```

脚本自动：加载 `.dev.vars` → type-check → unit tests → npm build → npm build:cf → wrangler deploy → **模型校准（以 `data/models.yaml` 为准同步 D1 models 表）** → 6 路由冒烟验证 → cache-control 检查。

> **模型校准说明**：`data/models.yaml` 是模型字典的唯一真源（slug → name）。部署时 `scripts/sync-models.ts` 会把线上 D1 `models` 表校准到与它完全一致——新增缺失的、更新 name 不一致的、删除线上多余（并清理 `prompt_models` 关联）。幂等可重跑，无差异时不写库。也可单独手动执行：
> ```bash
> # 试运行（只打印差异，不写库）
> npx tsx scripts/sync-models.ts --dry-run
> # 实际校准（需 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / D1_DATABASE_ID）
> npx tsx scripts/sync-models.ts
> ```

### 方式 B：分步手动

当 GitHub Actions 不可用时：

```bash
# 3.1 加载凭证
export $(grep -v '^#' .dev.vars | xargs)

# 3.2 type-check + unit tests
npm run type-check && npm test

# 3.3 build
npm run build

# 3.4 OpenNext build（生成 .open-next/）
npm run build:cf

# 3.5 deploy
npx wrangler deploy --env=""
# 输出示例：
# Successfully published...
# https://awesome-video-prompts-nextjs.semonxue.workers.dev
```

**预估耗时**：
| 步骤 | 耗时 |
|------|------|
| `npm run type-check && npm test` | ~15s |
| `npm run build` | ~60s |
| `npm run build:cf` | ~30s |
| `npx wrangler deploy` | ~30s |
| **总计** | **~2.5 分钟** |

---

## 4. 部署后验证

### 4.1 快速冒烟

```bash
BASE="https://awesome-video-prompts-nextjs.semonxue.workers.dev"

for url in \
  "$BASE/en" \
  "$BASE/zh" \
  "$BASE/ja" \
  "$BASE/en/prompts/2066987039866945601-crocodile-floodgate" \
  "$BASE/en/tags/cinematic" \
  "$BASE/en/models/seedance2" \
  "$BASE/sitemap.xml" \
  "$BASE/robots.txt"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  echo "$code $url"
done
```

**期望**：全部返回 `200`

### 4.2 Playwright e2e

```bash
# 加载凭证（Playwright 直接读 playwright.config.ts 里的 BASE_URL）
export $(grep -v '^#' .dev.vars | xargs)

# 跑 e2e（9 个路径，约 35s）
npx playwright test --project=chromium --timeout=60000
```

**期望**：9/9 passed

### 4.3 TTFB 基准

```bash
BASE="https://awesome-video-prompts-nextjs.semonxue.workers.dev"
curl -s -w "TTFB: %{time_starttransfer}s | Size: %{size_download}B | Code: %{http_code}\n" \
  -o /dev/null "$BASE/en"
```

**期望**（首次冷启动）：TTFB < 5s
**热路径**（CF 缓存命中后）：TTFB < 100ms

### 4.4 cache-control headers

```bash
curl -I https://awesome-video-prompts-nextjs.semonxue.workers.dev/en \
  | grep -i "cache-control\|cf-cache-status"
```

**期望**：
```
cache-control: public, s-maxage=3600, stale-while-revalidate=86400
cf-cache-status: (HIT 或 EXECUTED)
```

> ⚠️ 若 `cf-cache-status` 不是 `HIT`：说明 CF 边缘缓存未命中，可能需要配置 Cache Rules（见 §6）

---

## 5. revalidate-secret 设置（首次部署后必须执行）

`REVALIDATE_SECRET` 必须在 CF 上设置，不能写在 `.dev.vars` 里（`.dev.vars` 不会上传）：

```bash
# 手动设置 secret（交互式输入）
npx wrangler secret put revalidate-secret

# 或非交互式（CI/CD 用）
echo "your_secret_value" | npx wrangler secret put revalidate-secret --name awesome-video-prompts-nextjs
```

**验证**：
```bash
# 正常触发（200）
curl -X POST "https://awesome-video-prompts-nextjs.semonxue.workers.dev/api/revalidate?secret=your_secret_value"
# {"revalidated":true,"paths":["/en","/zh","/ja"]}

# 错误 secret（403）
curl -X POST "https://awesome-video-prompts-nextjs.semonxue.workers.dev/api/revalidate?secret=wrong"
# {"error":"Invalid secret"}

# GET 请求（405）
curl "https://awesome-video-prompts-nextjs.semonxue.workers.dev/api/revalidate?secret=xxx"
# {"error":"Method not allowed"}
```

---

## 6. Cloudflare Dashboard 手动配置

以下配置无法通过 `wrangler.toml` 完成，需登录 CF Dashboard：

### 6.1 Cache Rules（边缘缓存 TTL 1h）

> **目的**：让热路径绕过 Workers 冷启动，直接从 CF PoP 返回，TTFB 从 1.5s → < 50ms

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **Workers & Pages** → `awesome-video-prompts-nextjs`
3. **Settings** → **Cache Rules** → **Create rule**
4. 配置：
   - **When incoming requests match**：Hostname equals `awesome-video-prompts-nextjs.semonxue.workers.dev`
   - **Cache**: Edge TTL = **3600 seconds**（1小时）
   - **Browser TTL**: Respect origin headers
5. **Save and Deploy**

### 6.2 Workers Memory（可选）

> 默认 128MB 够用。如果 D1 查询变慢或 OOM 可调。

**Settings** → **Resources** → **Memory** → 调整（最大 300MB）

---

## 7. 回滚

```bash
# 查看部署历史
npx wrangler deployments list

# 回滚到上一版本
npx wrangler rollback

# 回滚到指定版本
npx wrangler rollback --version-id <version-id>
```

**预期回滚时间**：< 2 分钟

---

## 8. 数据备份与恢复

D1 是 prompt 数据的唯一副本（本地 `content/_drafts` 不入 git、发布清理后会删除），必须有两层备份：

### 8.1 行级自动备份（已内置，无需操作）

`/api/admin/publish` 在 **update**（覆盖已发布 slug）前，自动把旧 row + tags/models 关联 dump 到 R2：

```
backups/<slug>/<timestamp>.json
# 例：backups/2066987039866945601-crocodile-floodgate/2026-07-25T02-30-45-123Z.json
```

- 内容：`{ backed_up_at, reason, prompt: {...row}, tags: [...], models: [...] }`
- best-effort：备份失败不阻断发布，响应里的 `backup` 字段会带错误信息
- 发布响应的 `backup.key` 即本次备份路径
- ⚠️ 备份只含 D1 数据，**不含 R2 媒体字节**（媒体覆盖式 PUT 同 key，无历史）

查看备份：

```bash
# 列出某 slug 的全部备份
npx wrangler r2 object list awesome-video-prompts-media --prefix "backups/<slug>/"

# 下载某个备份
npx wrangler r2 object get "awesome-video-prompts-media/backups/<slug>/<timestamp>.json" --file /tmp/backup.json
```

### 8.2 全量定期快照（手动，建议每周）

```bash
# 全量导出 D1（含 schema + 全部数据）
mkdir -p backups
npx wrangler d1 export awesomevideoprompts-db --remote \
  --output "backups/d1-$(date +%Y%m%d-%H%M).sql"

# 建议保留最近 4 份，旧的归档或删除
ls -t backups/d1-*.sql | tail -n +5 | xargs rm -f
```

> 建议：每周发布批次完成后跑一次；快照文件不要提交 git（含线上数据），`backups/` 已在 .gitignore 或自行排除。

### 8.3 恢复

**单条恢复（误改/误删某个 prompt）**：从 R2 备份 JSON 取回旧 row 字段，用 md-editor「⬇️ 加载线上」拉回草稿（若 row 还在），或手动按备份内容重建草稿 md 后重新发布。tags/models 关联在备份 JSON 里。

**整库恢复（灾难）**：

```bash
# 先备份当前状态（防止二次损失）
npx wrangler d1 export awesomevideoprompts-db --remote --output backups/d1-before-restore.sql

# 用快照恢复（注意：会全量覆盖，谨慎执行）
npx wrangler d1 execute awesomevideoprompts-db --remote --file backups/d1-YYYYMMDD-HHMM.sql

# 恢复后刷缓存
curl -X POST "https://awesome-video-prompts-nextjs.semonxue.workers.dev/api/revalidate?secret=<REVALIDATE_SECRET>"
```

---

## 9. 常见问题

### Q: `wrangler deploy` 报 `CLOUDFLARE_API_TOKEN` 权限不足

**原因**：Token 权限不够（缺少 D1 或 Workers Scripts 编辑权限）

**解决**：
1. CF Dashboard → Profile → API Tokens → 编辑当前 Token
2. 添加权限：`Account | D1 | Edit` + `Workers Scripts | Edit`
3. revoke 旧 token，创建新 token（TTL 建议 24h）

### Q: `wrangler deploy` 报 `D1 Database not found`

**原因**：`wrangler.toml` 的 `database_name` 与 CF Dashboard 上实际数据库名不匹配

**解决**：
```bash
# 查看实际数据库名
npx wrangler d1 list
# 输出：name: awesomevideoprompts-db（不是 prompts-db）

# 确认 wrangler.toml 里的是
grep "database_name" wrangler.toml
# 应该显示：database_name = "awesomevideoprompts-db"
```

### Q: 部署成功但页面 500

**排查**：
```bash
# 查看 Workers 日志
npx wrangler tail

# 实时 tail（本地终端）
npx wrangler dev --log-level debug
```

**常见原因**：D1 binding 为 undefined（`env.DB` 未正确传入）/ R2 URL 配置错误

### Q: `npm run build:cf` 失败

```bash
# 清理缓存重试
rm -rf .open-next node_modules/.cache
npm run build && npm run build:cf
```

### Q: Playwright e2e 全挂

**检查**：确认线上 URL 正确 + 凭证环境变量已加载
```bash
echo $BASE_URL  # 应该等于 https://awesome-video-prompts-nextjs.semonxue.workers.dev
```

---

## 10. 清理本地/CI 缓存

CI 日志里如果看到 “Restored from cache” 或最终 cache entry 几百 MB，说明 GitHub Actions 的 `actions/setup-node` cache 跟本地 `~/.npm` 都堆积了。可用项目内置脚本一键清。

```bash
# 1. 试运行（只列出大小，不删任何东西）
./scripts/clean-cache.sh --dry-run

# 2. 清理工作区内的 .next / .open-next / .wrangler / .npm-cache / node_modules/.cache
./scripts/clean-cache.sh

# 3. 同时清理全局 npm cache（macOS 常见 2~5GB；--global 会取 `npm config get cache` 的值）
./scripts/clean-cache.sh --global
```

清理后重新走一遍：

```bash
npm ci              # 重建 node_modules
npm run build       # 重建 .next
npm run build:cf    # 重建 .open-next
```

> **CI 端说明**：GitHub Actions 的 `node_modules` cache 是按 `package-lock.json` hash 存的，源代码不变化时每次都会复用 250MB+ 缓存；这是设计行为，不要手动清，**依赖在 CI 端重装不会带来额外网络费**（走 cache）。在 release tag（如 `v2.x`）后第一次部署才会真正重新下载。

## 11. 快速命令速查

```bash
# 一键部署（推荐）
./scripts/deploy.sh

# Playwright e2e（部署后必跑）
./scripts/deploy.sh --skip-test && npx playwright test --project=chromium

# 触发 ISR revalidate（数据更新后）
curl -X POST "https://awesome-video-prompts-nextjs.semonxue.workers.dev/api/revalidate?secret=<REVALIDATE_SECRET>"

# 回滚
npx wrangler rollback

# 看线上日志
npx wrangler tail --format pretty

# 清理本地/CI 缓存
./scripts/clean-cache.sh --dry-run   # 先看
./scripts/clean-cache.sh --global     # 真的清（含 ~/.npm）
```
