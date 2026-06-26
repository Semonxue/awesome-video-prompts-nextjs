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
                              npx wrangler deploy
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

脚本自动：加载 `.dev.vars` → type-check → unit tests → npm build → npm build:cf → wrangler deploy → 6 路由冒烟验证 → cache-control 检查。

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
npx wrangler deploy
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

## 8. 常见问题

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

## 9. 快速命令速查

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
```
