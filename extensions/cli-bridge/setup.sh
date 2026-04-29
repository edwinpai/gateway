#!/usr/bin/env bash
# setup.sh — Configure LLM CLI tools (Claude Code, Codex, Gemini CLI) to use EdwinPAI tools
#
# What this does:
#   1. Detects which LLM CLI tools are installed
#   2. Adds EdwinPAI tool permissions (auto-allow `edwinpai tool` commands)
#   3. Adds SessionStart hook to inject available tools into LLM context
#   4. Sets EDWINPAI_GATEWAY_TOKEN env var if available
#
# Usage: ./setup.sh
#   Run from any directory — script resolves paths relative to itself.
#   Safe to re-run (idempotent).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EDWINPAI_HOME="${EDWINPAI_HOME:-$HOME/.edwinpai}"
# Legacy state-dir fallback retained for older installs.
if [ ! -d "$EDWINPAI_HOME" ] && [ -d "$HOME/.edwin" ]; then
  EDWINPAI_HOME="$HOME/.edwin"
fi
EDWINPAI_CONFIG="${EDWINPAI_CONFIG_PATH:-$EDWINPAI_HOME/edwinpai.json}"

BOLD="\033[1m"
DIM="\033[2m"
GREEN="\033[32m"
BLUE="\033[34m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

echo -e "${BOLD}=== EdwinPAI CLI Bridge Setup ===${RESET}"
echo -e "EdwinPAI home: $EDWINPAI_HOME"
echo ""

# ── Prerequisites ─────────────────────────────────────────────────────────
if ! command -v jq &>/dev/null; then
  echo -e "${RED}✗ jq not found.${RESET} Install: sudo apt install jq"
  exit 1
fi

if ! command -v edwinpai &>/dev/null; then
  echo -e "${YELLOW}⚠ edwinpai CLI not in PATH — hooks will fail until installed${RESET}"
fi

# ── Resolve gateway token ────────────────────────────────────────────────
GATEWAY_TOKEN=""
if [ -n "${EDWINPAI_GATEWAY_TOKEN:-}" ]; then
  GATEWAY_TOKEN="$EDWINPAI_GATEWAY_TOKEN"
  echo -e "${GREEN}✓${RESET} Gateway token from env"
elif [ -f "$EDWINPAI_CONFIG" ]; then
  GATEWAY_TOKEN=$(node - "$EDWINPAI_CONFIG" <<'NODE'
const fs = require("node:fs");
const JSON5 = require("json5");
const configPath = process.argv[2];
try {
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON5.parse(raw);
  const token = parsed?.gateway?.auth?.token;
  process.stdout.write(typeof token === "string" ? token : "");
} catch {
  process.stdout.write("");
}
NODE
)
  if [ -n "$GATEWAY_TOKEN" ]; then
    echo -e "${GREEN}✓${RESET} Gateway token from $EDWINPAI_CONFIG"
  fi
fi

if [ -z "$GATEWAY_TOKEN" ]; then
  echo -e "${YELLOW}⚠ No gateway token found — tools will need EDWINPAI_GATEWAY_TOKEN set manually${RESET}"
fi

# ── Helper: merge into JSON settings file ─────────────────────────────────
# Usage: merge_settings <file> <jq-filter>
# Creates the file if it doesn't exist. Merges without clobbering existing keys.
merge_settings() {
  local file="$1"
  local filter="$2"

  if [ ! -f "$file" ]; then
    echo '{}' | jq "$filter" > "$file"
  else
    local tmp="${file}.tmp.$$"
    jq "$filter" "$file" > "$tmp" && mv "$tmp" "$file"
  fi
}

# ── 1. Claude Code ────────────────────────────────────────────────────────
setup_claude_code() {
  echo -e "\n${BOLD}Claude Code${RESET}"

  local settings_file="$HOME/.claude/settings.json"
  local settings_dir="$HOME/.claude"
  local HOOKS_DIR="${SCRIPT_DIR}/hooks"

  if [ ! -d "$settings_dir" ]; then
    echo -e "  ${DIM}~/.claude/ not found — skipping${RESET}"
    return
  fi

  echo -e "  ${BLUE}→${RESET} Configuring $settings_file"

  # Ensure file exists
  if [ ! -f "$settings_file" ]; then
    echo '{}' > "$settings_file"
  fi

  local tmp="${settings_file}.tmp.$$"

  jq --arg token "${GATEWAY_TOKEN:-}" --arg hooks_dir "$HOOKS_DIR" '
    # Merge permissions
    .permissions //= {} |
    .permissions.allow //= [] |
    if (.permissions.allow | index("Bash(edwinpai tool:*)")) == null
    then .permissions.allow += ["Bash(edwinpai tool:*)"]
    else . end |

    # Merge env (only set token if we have one and its not already set)
    if $token != "" then
      .env //= {} |
      if .env.EDWINPAI_GATEWAY_TOKEN == null or .env.EDWINPAI_GATEWAY_TOKEN == ""
      then .env.EDWINPAI_GATEWAY_TOKEN = $token
      else . end
    else . end |

    # Add SessionStart hook if no edwinpai hook exists
    .hooks //= {} |
    .hooks.SessionStart //= [] |
    if (.hooks.SessionStart | map(select(
      (.hooks // [])[] | (.command // "") | test("edwinpai tool list")
    )) | length) == 0
    then
      .hooks.SessionStart += [{
        "hooks": [{
          "type": "command",
          "command": "TOOLS=$(edwinpai tool list 2>/dev/null) && printf \"{\\\"hookSpecificOutput\\\":{\\\"hookEventName\\\":\\\"SessionStart\\\",\\\"additionalContext\\\":\\\"EdwinPAI gateway tools available via: edwinpai tool invoke <tool> --args <json>. Run edwinpai tool describe <tool> for schema. Available tools:\\\\n%s\\\"}}\" \"$TOOLS\" || true",
          "timeout": 15,
          "statusMessage": "Loading EdwinPAI tools..."
        }]
      }]
    else . end |

    # Memory hook: UserPromptSubmit → before_agent_start (context retrieval)
    .hooks.UserPromptSubmit //= [] |
    if (.hooks.UserPromptSubmit | map(select(
      (.hooks // [])[] | (.command // "") | test("before-agent-start")
    )) | length) == 0
    then
      .hooks.UserPromptSubmit += [{
        "hooks": [{
          "type": "command",
          "command": ($hooks_dir + "/before-agent-start.sh"),
          "timeout": 10,
          "statusMessage": "Retrieving memory context..."
        }]
      }]
    else . end |

    # Memory hook: Stop → agent_end (session capture + reindex)
    .hooks.Stop //= [] |
    if (.hooks.Stop | map(select(
      (.hooks // [])[] | (.command // "") | test("agent-end")
    )) | length) == 0
    then
      .hooks.Stop += [{
        "hooks": [{
          "type": "command",
          "command": ($hooks_dir + "/agent-end.sh"),
          "timeout": 15
        }]
      }]
    else . end |

    # Memory hook: PreCompact → before_compaction (BM25 flush)
    .hooks.PreCompact //= [] |
    if (.hooks.PreCompact | map(select(
      (.hooks // [])[] | (.command // "") | test("before-compaction")
    )) | length) == 0
    then
      .hooks.PreCompact += [{
        "hooks": [{
          "type": "command",
          "command": ($hooks_dir + "/before-compaction.sh"),
          "timeout": 10,
          "statusMessage": "Flushing memory index..."
        }]
      }]
    else . end |

    # Memory hook: PostToolUse → message_sent (token tracking for embed scheduling)
    .hooks.PostToolUse //= [] |
    if (.hooks.PostToolUse | map(select(
      (.hooks // [])[] | (.command // "") | test("message-sent")
    )) | length) == 0
    then
      .hooks.PostToolUse += [{
        "hooks": [{
          "type": "command",
          "command": ($hooks_dir + "/message-sent.sh"),
          "timeout": 5
        }]
      }]
    else . end
  ' "$settings_file" > "$tmp" && mv "$tmp" "$settings_file"

  echo -e "  ${GREEN}✓${RESET} Permission: Bash(edwinpai tool:*)"
  echo -e "  ${GREEN}✓${RESET} Hook: SessionStart → inject available EdwinPAI tools"
  echo -e "  ${GREEN}✓${RESET} Hook: UserPromptSubmit → memory context retrieval"
  echo -e "  ${GREEN}✓${RESET} Hook: Stop → session capture + reindex"
  echo -e "  ${GREEN}✓${RESET} Hook: PreCompact → BM25 index flush"
  echo -e "  ${GREEN}✓${RESET} Hook: PostToolUse → token tracking for embed scheduling"
  if [ -n "$GATEWAY_TOKEN" ]; then
    echo -e "  ${GREEN}✓${RESET} Env: EDWINPAI_GATEWAY_TOKEN"
  fi

  # Validate JSON
  if ! jq empty "$settings_file" 2>/dev/null; then
    echo -e "  ${RED}✗ Invalid JSON in $settings_file — restoring backup${RESET}"
    if [ -f "${settings_file}.bak" ]; then
      cp "${settings_file}.bak" "$settings_file"
    fi
    return 1
  fi

  echo -e "  ${GREEN}✓${RESET} Settings validated"
}

# ── 2. Codex CLI ──────────────────────────────────────────────────────────
# Codex CLI setup removed — codex models route through OpenAI API (no CLI subprocess)

# ── 3. Gemini CLI ─────────────────────────────────────────────────────────
setup_gemini() {
  echo -e "\n${BOLD}Gemini CLI${RESET}"

  if ! command -v gemini &>/dev/null; then
    echo -e "  ${DIM}gemini not found — skipping${RESET}"
    return
  fi

  local gemini_config="$HOME/.gemini"
  local instructions_file="$gemini_config/GEMINI.md"

  mkdir -p "$gemini_config"

  local edwin_block="## EdwinPAI Tools Integration
EdwinPAI gateway tools are available via CLI:
- \`edwinpai tool list\` — list available tools
- \`edwinpai tool describe <tool>\` — show tool schema
- \`edwinpai tool invoke <tool> --args '{\"key\": \"value\"}'\` — invoke a tool
Tools include: message, browser, canvas, TTS, cron, web search, and more.
All invocations are logged and may require desktop approval."

  if [ -f "$instructions_file" ] && grep -qF "EdwinPAI Tools Integration" "$instructions_file"; then
    echo -e "  ${DIM}[skip] instructions already has EdwinPAI section${RESET}"
  else
    echo "" >> "$instructions_file"
    echo "$edwin_block" >> "$instructions_file"
    echo -e "  ${GREEN}✓${RESET} Added EdwinPAI tools to $instructions_file"
  fi
}

# ── Run setup for detected CLIs ──────────────────────────────────────────
setup_claude_code
setup_gemini

# ── Summary ───────────────────────────────────────────────────────────────
echo -e "\n${BOLD}=== Setup Complete ===${RESET}"
echo ""
echo -e "  EdwinPAI tools are now available in configured CLI sessions."
echo -e "  ${DIM}Test:  edwinpai tool list${RESET}"
echo -e "  ${DIM}Use:   edwinpai tool invoke message --to 'matrix:jake' --text 'Hello from Claude Code'${RESET}"
echo ""
echo -e "  ${DIM}Claude Code: restart session or /hooks to reload${RESET}"
echo -e "  ${DIM}Codex/Gemini: start new session to pick up instructions${RESET}"
