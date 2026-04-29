#!/usr/bin/env bash
# Claude Code hook: Stop → agent_end
# Captures session summary and triggers reindexing.
set -euo pipefail

EDWINPAI_HOME="${EDWINPAI_HOME:-$HOME/.edwinpai}"
WORKSPACE="${EDWINPAI_HOME}/workspace"
SESSIONS_DIR="${WORKSPACE}/sessions"
LOG_FILE="/tmp/edwinpai/edwinpai-$(date +%Y-%m-%d).log"

gw_log() {
  local level="$1" msg="$2"
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  printf '{"0":"%s","_meta":{"name":"hooks","parentNames":["edwinpai"],"date":"%s","logLevelId":%s,"logLevelName":"%s"},"time":"%s"}\n' \
    "$(echo "$msg" | sed 's/"/\\"/g')" "$ts" \
    "$([ "$level" = "ERROR" ] && echo 5 || echo 3)" "$level" "$ts" \
    >> "$LOG_FILE" 2>/dev/null || true
}

mkdir -p "$SESSIONS_DIR"

# Read hook input
INPUT=$(cat)
gw_log INFO "hook:Stop fired"

# Extract the last assistant message for session capture
LAST_MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // empty' 2>/dev/null || true)

if [ -n "$LAST_MSG" ]; then
  gw_log INFO "hook:Stop capturing session summary"
  DATE=$(date +%Y-%m-%d)
  TIMESTAMP=$(date +%H%M%S)
  SESSION_FILE="${SESSIONS_DIR}/${DATE}-cli-${TIMESTAMP}.md"

  cat > "$SESSION_FILE" << EOF
---
source: claude-code
captured: $(date -Iseconds)
---

## CLI Session Summary

$LAST_MSG
EOF
fi

# Trigger reindex — full embed if token watermark is high, otherwise BM25 only
WATERMARK_FILE="${EDWINPAI_HOME}/.token-watermark"
EMBED_THRESHOLD=2000  # tokens accumulated before triggering embedding

DO_EMBED=false
if [ -f "$WATERMARK_FILE" ]; then
  TOTAL=$(tail -1 "$WATERMARK_FILE" 2>/dev/null | awk '{print $2}' || echo 0)
  TOTAL=${TOTAL:-0}
  if [ "$TOTAL" -ge "$EMBED_THRESHOLD" ]; then
    DO_EMBED=true
  fi
  # Reset watermark for next session
  rm -f "$WATERMARK_FILE"
fi

if command -v qmd &>/dev/null; then
  if [ "$DO_EMBED" = true ]; then
    gw_log INFO "hook:Stop reindexing (embed, tokens=$TOTAL)"
    qmd update -c workspace --embed &>/dev/null &
  else
    gw_log INFO "hook:Stop reindexing (BM25 only)"
    qmd update -c workspace &>/dev/null &
  fi
fi

exit 0
