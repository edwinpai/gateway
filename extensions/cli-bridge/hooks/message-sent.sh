#!/usr/bin/env bash
# Claude Code hook: PostToolUse → message_sent
# Tracks cumulative token watermark to a state file so agent-end.sh
# can decide whether a full embed pass is warranted.
#
# Note: For API-path sessions, the shad-context plugin handles this
# natively via its message_sent JS hook. This shell hook only fires
# for direct `claude` CLI sessions.
set -euo pipefail

EDWINPAI_HOME="${EDWINPAI_HOME:-$HOME/.edwinpai}"
WATERMARK_FILE="${EDWINPAI_HOME}/.token-watermark"
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

# Read hook input
INPUT=$(cat)

# Extract tool name
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null || true)

# Skip common non-content tools (fire fast, ~0ms)
case "$TOOL_NAME" in
  Bash|Read|Edit|Write|Grep|Glob|Agent) exit 0 ;;
esac

gw_log INFO "hook:PostToolUse tool=${TOOL_NAME}"

# Estimate tokens from tool output length
CONTENT=$(echo "$INPUT" | jq -r '.tool_output // empty' 2>/dev/null || true)
if [ -z "$CONTENT" ]; then
  exit 0
fi

CONTENT_LEN=${#CONTENT}
ESTIMATED_TOKENS=$(( CONTENT_LEN / 4 ))

# Accumulate to watermark file (atomic append, read by agent-end.sh)
# Format: timestamp accumulated_tokens
PREV=0
if [ -f "$WATERMARK_FILE" ]; then
  PREV=$(tail -1 "$WATERMARK_FILE" 2>/dev/null | awk '{print $2}' || echo 0)
  PREV=${PREV:-0}
fi

TOTAL=$(( PREV + ESTIMATED_TOKENS ))
echo "$(date +%s) $TOTAL" >> "$WATERMARK_FILE"

exit 0
