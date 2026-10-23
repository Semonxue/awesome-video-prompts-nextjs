#!/bin/bash
# collect.sh - 发现线 cron 入口
# 跑一次完整流程，含 watchdog（5min 硬上限）和 PATH 补全

set -u

# 显式补 PATH：cron 环境不继承
# 注意：必须含 $HOME/.local/bin（twitter / xhs CLI 在此），
# 否则回退到 yt-dlp 路径会拿到截断的 description，导致日期解析 100% 失败。
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$HOME/miniconda3/bin:$PATH"

# opencli 自身的浏览器命令超时（默认 60s）。
# `twitter likes --limit 1000` 实测 36~59s，正好压在 60s 默认值上，
# 稍有网络抖动就返回 exit=75 TIMEOUT 并触发重试。放宽到 150s 消除抖动。
# 注意：opencli 的 likes 子命令没有 --timeout 选项，只有这个环境变量能调。
export OPENCLI_BROWSER_COMMAND_TIMEOUT=150

# 工具目录
ROOT="/Users/semonxue/Workplace/Works/ai-dev/awesome-video-prompts-nextjs"
SCRIPT="$ROOT/tools/collect.py"
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

log "=== collect start ==="

# watchdog：3000s（50min）后强杀主进程。
# 旧值 270s 是基于「watchdog 会自杀、实际从不生效」的假象设定的。
# PID bug 修好后 watchdog 真正生效，阈值必须匹配实际耗时预算：
#   timeline ~20s + dedup ~10s + likes ~60s + N 条 × 17~38s（实测 10 条 = 253~488s）
#   target=10 → 约 300~500s；target=40 → 约 1200~1700s
# 900s 够 target=10 但会被 target=40 腰斩，故提到 3000s 留足余量。
# 仍远小于 cron 间隔 7200s，不会与下一 tick 重叠。
(
    sleep 3000
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
# 后台启动，把 python 的真实 PID 写进 PID file 交给 watchdog。
# （旧写法写的是 watchdog 自己的 $!，导致 watchdog 读到后自杀，主进程永不被杀）
cd "$ROOT"
python3 "$SCRIPT" run 2>&1 &
MAIN_PID=$!
echo "$MAIN_PID" > "$WD_PID_FILE"
wait "$MAIN_PID"
EXIT_CODE=$?

# 收尾
kill $WD_PID 2>/dev/null
wait $WD_PID 2>/dev/null
rm -f "$WD_PID_FILE"

log "=== collect done (exit=$EXIT_CODE) ==="

# ---- 文件卫生巡检（非致命，只记录） ----
# 2026-10-23 定规则：仓库里不允许留一次性脚本（scripts/_*.py / batch*.py / *.bak …）。
# 每 tick 巡检一次，有残留就把清单写进 cron.log，直到清干净为止。
# 注意：这里不能影响 EXIT_CODE（采集本身的结果），所以单独取 rc。
HYGIENE_OUT="$(python3 "$SCRIPT" hygiene 2>&1)"
HYGIENE_RC=$?
if [ "$HYGIENE_RC" -ne 0 ]; then
    log "🧹 文件卫生: 发现未入库的一次性脚本残留（清理: python3 tools/collect.py hygiene --trash）"
    printf '%s\n' "$HYGIENE_OUT" | sed 's/^/    /' >> "$LOG_FILE"
fi

# 清理可能残留的 0-byte 临时文件
find "$ROOT/temp" -maxdepth 2 -type f -size 0 -delete 2>/dev/null

exit $EXIT_CODE
