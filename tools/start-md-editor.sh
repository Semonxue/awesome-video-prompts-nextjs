#!/bin/bash
#
# 启动 md-editor（新流程：Next.js + D1 + R2）
#
# 前置条件：
# 1. Python 3.9+
# 2. pip install pyyaml
# 3. 项目根 .dev.vars 配置 NEW_SITE_ADMIN_SECRET（与新站 wrangler secret 一致）
#
# 用法：./start-md-editor.sh [port]
# 默认端口：3000

set -e

PORT=${1:-3000}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# 脚本在 tools/ 下，所以向上 1 层就是项目根
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 检查 Python
if ! command -v python3 &> /dev/null; then
    echo "❌ python3 未安装"
    exit 1
fi

# 检查 pyyaml
if ! python3 -c "import yaml" 2>/dev/null; then
    echo "❌ pyyaml 未安装。运行：pip install pyyaml"
    exit 1
fi

# 检查 .dev.vars
if [ ! -f "$PROJECT_ROOT/.dev.vars" ]; then
    echo "⚠️  $PROJECT_ROOT/.dev.vars 不存在"
    echo "   md-editor 需要 NEW_SITE_ADMIN_SECRET 才能调新站 API"
    echo "   创建 .dev.vars 加入："
    echo "     NEW_SITE_PUBLISH_URL=https://awesome-video-prompts-nextjs.semonxue.workers.dev/api/admin/publish"
    echo "     NEW_SITE_LIST_PROMPT_URL=https://awesome-video-prompts-nextjs.semonxue.workers.dev/api/admin/list-prompt"
    echo "     NEW_SITE_ADMIN_SECRET=<your-admin-secret>"
    echo
    read -p "继续启动？(y/N) " yn
    if [ "$yn" != "y" ] && [ "$yn" != "Y" ]; then
        exit 1
    fi
fi

# 杀端口
if command -v lsof &> /dev/null; then
    PID=$(lsof -t -i:$PORT 2>/dev/null || true)
    if [ ! -z "$PID" ]; then
        echo "Killing existing process on port $PORT (PID: $PID)..."
        kill -9 $PID 2>/dev/null || true
        sleep 1
    fi
fi

echo "🚀 启动 md-editor（新流程）"
echo "   项目根: $PROJECT_ROOT"
echo "   端口: $PORT"
echo "   草稿目录: $PROJECT_ROOT/content/_drafts/prompts/"
echo
cd "$SCRIPT_DIR/md-editor"
python3 server.py "$PORT"
