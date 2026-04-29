#!/usr/bin/env bash
# Claude Code hook: PreCompact → before_compaction
# Flushes the BM25 index before context window compression.
set -euo pipefail

LOG_FILE="/tmp/edwinpai/edwinpai-$(date -u +%Y-%m-%d).log"

gw_log() {
  local level="$1" msg="$2"
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  printf '{"0":"%s","_meta":{"name":"hooks","parentNames":["edwinpai"],"date":"%s","logLevelId":%s,"logLevelName":"%s"},"time":"%s"}\n' \
    "$(echo "$msg" | sed 's/"/\\"/g')" "$ts" \
    "$([ "$level" = "ERROR" ] && echo 5 || echo 3)" "$level" "$ts" \
    >> "$LOG_FILE" 2>/dev/null || true
}

gw_log INFO "hook:PreCompact flushing BM25 index"

if command -v qmd &>/dev/null; then
  qmd update -c workspace 2>/dev/null || true
fi

exit 0
