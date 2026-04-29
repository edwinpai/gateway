#!/usr/bin/env bash
# Claude Code hook: UserPromptSubmit → before_agent_start
# Retrieves Shad context for the user's prompt and injects it via additionalContext.
set -euo pipefail

EDWINPAI_HOME="${EDWINPAI_HOME:-$HOME/.edwinpai}"
WORKSPACE="${EDWINPAI_HOME}/workspace"
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

# Debug: log immediately on entry
gw_log INFO "hook:UserPromptSubmit invoked (PID=$$)"

# Read the hook input from stdin (Claude Code passes JSON)
INPUT=$(cat)
gw_log INFO "hook:UserPromptSubmit stdin read (${#INPUT} bytes)"

# Extract the user's prompt from the hook input
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null || true)
gw_log INFO "hook:UserPromptSubmit prompt extracted (${#PROMPT} chars): ${PROMPT:0:80}"

if [ -z "$PROMPT" ]; then
  gw_log INFO "hook:UserPromptSubmit skipped (empty prompt)"
  exit 0
fi

# Skip retrieval for short/casual messages
PROMPT_LEN=${#PROMPT}
if [ "$PROMPT_LEN" -lt 10 ]; then
  gw_log INFO "hook:UserPromptSubmit skipped (short prompt, ${PROMPT_LEN} chars)"
  exit 0
fi

# Skip system commands
if echo "$PROMPT" | grep -qE '^\s*/(compact|status|help|clear)'; then
  gw_log INFO "hook:UserPromptSubmit skipped (system command)"
  exit 0
fi

# Try QMD BM25 search first against the focused memory collection.
# The broader workspace collection can be much slower because it includes large session/doc files.
CONTEXT=""
gw_log INFO "hook:UserPromptSubmit searching (qmd=$(command -v qmd 2>/dev/null || echo 'not found'))"
if command -v qmd &>/dev/null; then
  CONTEXT=$(qmd search "$PROMPT" -c memory-dir -n 6 --md 2>/dev/null || true)
  gw_log INFO "hook:UserPromptSubmit qmd(memory-dir) done (${#CONTEXT} bytes)"
fi

# Fallback to edwinpai memory search
if [ -z "$CONTEXT" ] && command -v edwinpai &>/dev/null; then
  CONTEXT=$(edwinpai memory search "$PROMPT" --limit 6 --format markdown 2>/dev/null || true)
  gw_log INFO "hook:UserPromptSubmit edwinpai-memory done (${#CONTEXT} bytes)"
fi

if [ -z "$CONTEXT" ]; then
  gw_log INFO "hook:UserPromptSubmit no context found for: ${PROMPT:0:80}"
  exit 0
fi

CTX_LINES=$(echo "$CONTEXT" | wc -l | tr -d ' ')
gw_log INFO "hook:UserPromptSubmit retrieved ${CTX_LINES} lines for: ${PROMPT:0:80}"

# Return additionalContext for Claude Code to inject
jq -n --arg ctx "$CONTEXT" '{
  "additionalContext": ("<collection-context source=\"memory\">\n" + $ctx + "\n</collection-context>")
}'
