#!/usr/bin/env bash
# D1 Insights Hourly Monitor
# 每小时抓一次 D1 insights，记录 Query 1 的增量变化
# 用法: bash scripts/monitor-d1.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs/d1-monitor"
mkdir -p "$LOG_DIR"

# 从 .dev.vars 读 token
TOKEN=$(grep CLOUDFLARE_API_TOKEN "$PROJECT_DIR/.dev.vars" | cut -d= -f2-)
ACCOUNT=$(grep CLOUDFLARE_ACCOUNT_ID "$PROJECT_DIR/.dev.vars" | cut -d= -f2-)

if [ -z "$TOKEN" ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ERROR: CLOUDFLARE_API_TOKEN not found"
  exit 1
fi

NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
SNAPSHOT_FILE="$LOG_DIR/snapshot-$TIMESTAMP.json"
PREV_SNAPSHOT=$(ls -1t "$LOG_DIR"/snapshot-*.json 2>/dev/null | head -1 || true)

echo "[$NOW] Taking D1 insights snapshot..."

cd "$PROJECT_DIR"

# 抓取 insights（过滤掉 wrangler 的 ANSI 头，只保留 JSON 数组）
CLOUDFLARE_API_TOKEN="$TOKEN" CLOUDFLARE_ACCOUNT_ID="$ACCOUNT" \
  npx wrangler d1 insights awesomevideoprompts-db 2>&1 \
  | sed 's/\x1b\[[0-9;]*m//g' \
  | grep -A999999 '^\[' \
  > "$SNAPSHOT_FILE"

if [ ! -s "$SNAPSHOT_FILE" ]; then
  echo "[$NOW] ERROR: empty response"
  rm -f "$SNAPSHOT_FILE"
  exit 1
fi

# Python 分析和对比
python3 << PYEOF
import json, os

with open("$SNAPSHOT_FILE") as f:
    data = json.load(f)

queries = {}
for q in data:
    t = q.get('query', '')
    # Strip double quotes for matching
    t_clean = t.replace('"', '')
    if 'prompts.id in (' in t_clean and 'is_draft' in t_clean and 'slug <>' in t_clean:
        queries['Q1_Related'] = q
    elif 'id > ?' in t_clean and 'id <>' in t_clean:
        queries['Q2_AdjNext'] = q
    elif 'prompt_models' in t_clean:
        queries['Q3_ModelSub'] = q
    elif 'id < ?' in t_clean and 'id <>' in t_clean:
        queries['Q4_AdjPrev'] = q
    elif 'prompt_tags' in t_clean:
        queries['Q5_TagSub'] = q

lines = [f"=== $NOW ==="]
for name in ['Q1_Related','Q2_AdjNext','Q3_ModelSub','Q4_AdjPrev','Q5_TagSub']:
    q = queries.get(name)
    if q:
        lines.append(f"{name}: runs={q['numberOfTimesRun']:,}  rows={q['totalRowsRead']:,}  ms={q['avgDurationMs']:.1f}")

prev_file = "$PREV_SNAPSHOT"
if prev_file and os.path.exists(prev_file) and prev_file != "$SNAPSHOT_FILE":
    with open(prev_file) as f:
        prev_data = json.load(f)
    for q in prev_data:
        t = q.get('query', '').replace('"', '')
        if 'prompts.id in (' in t and 'is_draft' in t and 'slug <>' in t:
            prev_runs = q['numberOfTimesRun']
            curr_runs = queries.get('Q1_Related', {}).get('numberOfTimesRun', 0)
            delta = curr_runs - prev_runs
            lines.append("")
            lines.append(f"Q1 delta: {delta:,} calls since last snapshot")
            if delta <= 0:
                lines.append("✅✅✅ Query 1 STOPPED — staticization 已生效!")
            elif delta < 100:
                lines.append(f"✅ rate very low ({delta}/interval)")
            elif delta < 1000:
                lines.append(f"⚠️ rate moderate ({delta}/interval)")
            else:
                lines.append(f"❌ rate HIGH ({delta}/interval) — still need publish to trigger staticization")
            break

output = "\n".join(lines)
print(output)
with open("$LOG_DIR/monitor.log", "a") as f:
    f.write(output + "\n\n")
PYEOF

# 清理 7 天以前的旧快照
ls -1t "$LOG_DIR"/snapshot-*.json 2>/dev/null | tail -n +169 | xargs rm -f 2>/dev/null || true
