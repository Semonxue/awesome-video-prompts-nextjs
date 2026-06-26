#!/usr/bin/env bash
#
# deploy.sh — awesome-video-prompts-nextjs 一键部署到 CF Workers
#
# 用法：
#   ./scripts/deploy.sh              # 完整流程（type-check + test + build + deploy）
#   ./scripts/deploy.sh --skip-test # 跳过 test（修改 CSS/文档时用）
#   ./scripts/deploy.sh --dry-run   # 只 dry-run build，不 deploy

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# ─── 颜色 ───────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*" >&2; }
info() { echo -e "${CYAN}[info]${NC} $*"; }

# ─── 参数解析 ─────────────────────────────────────────
SKIP_TEST=false
DRY_RUN=false
for arg in "$@"; do
  case $arg in
    --skip-test) SKIP_TEST=true ;;
    --dry-run)   DRY_RUN=true ;;
    -h|--help)
      echo "用法: $0 [--skip-test] [--dry-run]"
      echo "  --skip-test  跳过 unit test（修改 CSS/文档时用）"
      echo "  --dry-run    只跑 build，不 deploy"
      exit 0
      ;;
  esac
done

# ─── 前置检查 ─────────────────────────────────────────
log "检查凭证..."
if [[ ! -f "$PROJECT_DIR/.dev.vars" ]]; then
  err ".dev.vars 不存在，请先创建（见 docs/DEPLOY.md §0.2）"
  exit 1
fi

# 加载 .dev.vars 到环境变量（wrangler 会自动读取，但 build 脚本可能需要）
set -a
source "$PROJECT_DIR/.dev.vars"
set +a

info "SITE_URL:    ${NEXT_PUBLIC_SITE_URL:-未设置}"
info "ACCOUNT_ID:  ${CLOUDFLARE_ACCOUNT_ID:-未设置}"
info "D1_DB:       ${D1_DATABASE_ID:-未设置}"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  err "CLOUDFLARE_API_TOKEN 未设置，请检查 .dev.vars"
  exit 1
fi

# ─── Step 1: type-check ──────────────────────────────
log "Step 1/4 — type-check..."
if ! npm run type-check 2>&1; then
  err "type-check 失败，停止部署"
  exit 1
fi
log "type-check ✓"

# ─── Step 2: unit tests ──────────────────────────────
if [[ "$SKIP_TEST" == "true" ]]; then
  warn "跳过 unit tests（--skip-test）"
else
  log "Step 2/4 — unit tests..."
  if ! npm test 2>&1; then
    err "unit tests 失败，停止部署"
    exit 1
  fi
  log "unit tests ✓"
fi

# ─── Step 3: build ────────────────────────────────────
log "Step 3/4 — npm run build..."
if ! npm run build 2>&1; then
  err "npm run build 失败，停止部署"
  exit 1
fi
log "npm run build ✓"

log "Step 3/4b — npm run build:cf..."
if ! npm run build:cf 2>&1; then
  err "npm run build:cf 失败，停止部署"
  exit 1
fi
log "npm run build:cf ✓"

# ─── Step 4: deploy ──────────────────────────────────
if [[ "$DRY_RUN" == "true" ]]; then
  warn "DRY-RUN 模式，跳过 deploy"
  log "部署流程 dry-run 完成，可以执行了"
  exit 0
fi

log "Step 4/4 — npx wrangler deploy..."
DEPLOY_OUTPUT=$(npx wrangler deploy 2>&1)
DEPLOY_EXIT=$?

echo "$DEPLOY_OUTPUT"

if [[ $DEPLOY_EXIT -ne 0 ]]; then
  err "wrangler deploy 失败"
  exit 1
fi

# 提取部署 URL
DEPLOY_URL=$(echo "$DEPLOY_OUTPUT" | grep -o 'https://[^ ]*\.workers\.dev' | tail -1)
if [[ -n "$DEPLOY_URL" ]]; then
  log "部署成功！$DEPLOY_URL"
else
  warn "无法从输出中提取 URL，请手动验证"
fi

# ─── Step 5: 冒烟验证 ────────────────────────────────
SMOKE_URL="${DEPLOY_URL:-${NEXT_PUBLIC_SITE_URL}}"
log "冒烟验证..."
SMOKE_FAILED=0

  for path in \
  "/en" \
  "/zh" \
  "/ja" \
  "/en/prompts/2066987039866945601-crocodile-floodgate" \
  "/en/tags/cinematic" \
  "/sitemap.xml"; do

  FULL_URL="${SMOKE_URL}${path}"
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$FULL_URL" --max-time 10 2>&1 | tail -1)

  if [[ "$HTTP_CODE" == "200" ]]; then
    info "✓ $HTTP_CODE $path"
  else
    err "✗ $HTTP_CODE $path"
    SMOKE_FAILED=1
  fi
done

if [[ $SMOKE_FAILED -eq 1 ]]; then
  err "冒烟验证有失败，请检查！"
  exit 1
fi

log "冒烟验证全部通过 ✓"

# ─── cache-control 检查 ────────────────────────────────
info "检查 cache-control headers..."
HEADERS=$(curl -sI "${SMOKE_URL}/en" --max-time 10 2>/dev/null || true)
if echo "$HEADERS" | grep -qi "s-maxage=3600"; then
  info "✓ cache-control 正确（s-maxage=3600）"
else
  warn "cache-control 可能不正确，请检查 CF Dashboard Cache Rules（见 docs/DEPLOY.md §6.1）"
fi

# ─── 总结 ─────────────────────────────────────────────
echo ""
log "========================================"
log "部署完成"
if [[ -n "$DEPLOY_URL" ]]; then
  log "URL: $DEPLOY_URL"
fi
log "下一步："
log "  1. Playwright e2e: npx playwright test --project=chromium"
log "  2. revalidate-secret（首次）: npx wrangler secret put revalidate-secret"
log "  3. CF Cache Rules（首次）: 见 docs/DEPLOY.md §6.1"
log "  4. Lighthouse: 浏览器 DevTools Lighthouse panel"
log "========================================"
