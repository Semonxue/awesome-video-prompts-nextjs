#!/usr/bin/env bash
#
# clean-cache.sh — 清理本机/工作区内的 npm / Next / OpenNext 缓存
#
# 用法：
#   ./scripts/clean-cache.sh              # 仅清工作区（.next / .open-next / .wrangler / .npm-cache）
#   ./scripts/clean-cache.sh --global     # 上述 + 清全局 npm cache（~/.npm）
#   ./scripts/clean-cache.sh --dry-run    # 只列出待删内容，不实际删除
#
# 适用场景：
#   - 磁盘告急时释放本地空间（mac 上 .npm 常常 2~5GB）
#   - CI/本地构建异常怀疑缓存污染（npm ci 偶发 ETARGET、lockfile 错位等）
#   - 切换 Node 主版本或 OpenNext 大版本后希望从干净状态构建
#
# 风险：
#   - 清理后下次 `npm ci` 会重新从 registry 拉依赖（速度变慢几分钟）
#   - 全局 cache 删除后 `npx wrangler ...` 第一次也会重新下载（透明）

# 不用 -o pipefail：`npm config get cache` 在 stdout 关闭时会触发 SIGPIPE。
# 也不用 -u：`GLOBAL_PATHS` 在 --global 未传时是空数组。

# 严格模式（仅打开 errexit + errtrace，不要 pipefail 和 nounset，参见下方注释）
# - 不用 -o pipefail：`npm config get cache` 在 stdout 关闭时会触发 SIGPIPE。
# - 不用 -u：`GLOBAL_PATHS` 在 --global 未传时是空数组。
set -o errexit
set -o errtrace
trap 'echo "[error] line $LINENO failed (exit $?)" >&2' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

CLEAN_GLOBAL=false
DRY_RUN=false
for arg in "$@"; do
  case $arg in
    --global) CLEAN_GLOBAL=true ;;
    --dry-run) DRY_RUN=true ;;
    -h|--help)
      sed -n '2,17p' "$0"
      exit 0
      ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# 待清理路径（相对项目根）— 全部已在 .gitignore
LOCAL_PATHS=(
  ".next"
  ".open-next"
  ".wrangler"
  ".npm-cache"
  "node_modules/.cache"
)

# 全局路径（默认空数组，--global 时再追加）
GLOBAL_PATHS=()
if [[ "$CLEAN_GLOBAL" == "true" ]]; then
  NPM_CACHE_DIR="$(npm config get cache 2>/dev/null || echo "$HOME/.npm")"
  GLOBAL_PATHS+=("$NPM_CACHE_DIR")
fi

show_size() {
  local p="$1"
  if [[ -e "$p" ]]; then
    du -sh "$p" 2>/dev/null | awk '{print $1}'
  else
    echo "—"
  fi
}

# 汇总 LOCAL_PATHS + GLOBAL_PATHS 的 KB 数，返回人类可读字符串
calc_total_human() {
  local sum_kb=0
  local p kb
  for p in "${LOCAL_PATHS[@]}"; do
    [[ -e "$p" ]] || continue
    kb=$(du -sk "$p" 2>/dev/null | awk '{print $1}')
    sum_kb=$((sum_kb + kb))
  done
  if [[ ${#GLOBAL_PATHS[@]} -gt 0 ]]; then
    for p in "${GLOBAL_PATHS[@]}"; do
      [[ -e "$p" ]] || continue
      kb=$(du -sk "$p" 2>/dev/null | awk '{print $1}')
      sum_kb=$((sum_kb + kb))
    done
  fi
  if [[ $sum_kb -ge 1048576 ]]; then
    awk -v k=$sum_kb 'BEGIN{printf "%.1fG", k/1048576}'
  elif [[ $sum_kb -ge 1024 ]]; then
    awk -v k=$sum_kb 'BEGIN{printf "%.1fM", k/1024}'
  else
    echo "${sum_kb}K"
  fi
}

echo "── 待清理路径 ───────────────────────────"
printf '  %-30s  %8s\n' "路径" "当前大小"
for p in "${LOCAL_PATHS[@]}"; do
  printf '  %-30s  %8s\n' "$p" "$(show_size "$p")"
done
for p in "${GLOBAL_PATHS[@]}"; do
  printf '  %-30s  %8s\n' "$p" "$(show_size "$p")"
done
echo "  预估可释放：$(calc_total_human)"

if [[ "$DRY_RUN" == "true" ]]; then
  echo
  echo "DRY-RUN：未执行任何删除"
  exit 0
fi

echo
read -r -p "确认删除以上内容？[y/N] " ans
if [[ "${ans,,}" != "y" && "${ans,,}" != "yes" ]]; then
  echo "已取消"
  exit 0
fi

echo "── 开始清理 ─────────────────────────────"
for p in "${LOCAL_PATHS[@]}" "${GLOBAL_PATHS[@]}"; do
  if [[ -e "$p" ]]; then
    echo "  rm -rf $p"
    rm -rf "$p"
  fi
done

echo
echo "✓ 清理完成"
echo "  下次构建会自动重建："
echo "    npm ci            # 重建 node_modules"
echo "    npm run build     # 重建 .next"
echo "    npm run build:cf  # 重建 .open-next"
if [[ "$CLEAN_GLOBAL" == "true" ]]; then
  echo "  首次 npx wrangler 会重新下载到本地 _npx 缓存"
fi
