#!/bin/bash
# x_timeline_collect.sh - cron 入口
# 跑一次完整流程，含 watchdog（5min 硬上限）和 PATH 补全

set -u

# 显式补 PATH：cron 环境不继承
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:$PATH"

# 工具目录
ROOT="/Users/semonxue/Workplace/Works/ai-dev/awesome-video-prompts-nextjs"
SCRIPT="$ROOT/tools/x_timeline_collect.py"
LOG_DIR="$ROOT/logs/x_timeline_cron"
LOG_FILE="$LOG_DIR/cron.log"
mkdir -p "$LOG_DIR"

# watchdog PID file
WD_PID_FILE="$LOG_DIR/.watchdog.pid"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# 清理可能残留的 watchdog（防止 SIGCHLD 孤儿）
if [ -f "$WD_PID_FILE" ]; then
    OLD_PID=$(cat "$WD_PID_FILE" 2>/dev/null)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        kill -9 "$OLD_PID" 2>/dev/null
    fi
    rm -f "$WD_PID_FILE"
fi

log "=== x_timeline_collect start ==="

# watchdog: 270s（4.5min）后强杀主进程
(
    sleep 270
    if [ -f "$WD_PID_FILE" ]; then
        MAIN_PID=$(cat "$WD_PID_FILE" 2>/dev/null)
        if [ -n "$MAIN_PID" ] && kill -0 "$MAIN_PID" 2>/dev/null; then
            log "⏱️  watchdog TIMEOUT (270s), killing main pid=$MAIN_PID"
            kill -9 "$MAIN_PID" 2>/dev/null
            # 杀掉所有 opencli 子进程（避免僵尸）
            pkill -9 -f "opencli twitter" 2>/dev/null
        fi
    fi
    rm -f "$WD_PID_FILE"
) &
WD_PID=$!
disown $WD_PID 2>/dev/null
echo $WD_PID > "$WD_PID_FILE"

# 跑主脚本
cd "$ROOT"
python3 "$SCRIPT" run 2>&1
EXIT_CODE=$?

# 收尾
kill $WD_PID 2>/dev/null
wait $WD_PID 2>/dev/null
rm -f "$WD_PID_FILE"

log "=== x_timeline_collect done (exit=$EXIT_CODE) ==="

# 清理可能残留的 0-byte 临时文件
find "$ROOT/temp" -maxdepth 2 -type f -size 0 -delete 2>/dev/null

exit $EXIT_CODE
