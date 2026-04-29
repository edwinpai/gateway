#!/usr/bin/env bash
set -euo pipefail

# EdwinPAI — Install Script
# Usage: curl -fsSL https://edwinpai.com/install.sh | bash

BOLD="\033[1m"
DIM="\033[2m"
GREEN="\033[32m"
BLUE="\033[34m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

echo -e "${BOLD}⚡ EdwinPAI — Installer${RESET}\n"

# Check prerequisites
check_prereq() {
  if ! command -v "$1" &>/dev/null; then
    echo -e "${RED}✗ $1 not found.${RESET} $2"
    return 1
  fi
  echo -e "${GREEN}✓${RESET} $1 found"
}

upsert_env_file_var() {
  local file="$1"
  local key="$2"
  local value="$3"

  node - "$file" "$key" "$value" <<'EOF'
const fs = require("node:fs");
const path = require("node:path");

const [file, key, value] = process.argv.slice(2);
const escapeRegExp = (input) => input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
let raw = "";
if (fs.existsSync(file)) {
  raw = fs.readFileSync(file, "utf8");
}
const lines = raw.length ? raw.split(/\r?\n/) : [];
const matcher = new RegExp(`^(\\s*(?:export\\s+)?)${escapeRegExp(key)}\\s*=`);
let replaced = false;
const nextLines = lines.map((line) => {
  const match = line.match(matcher);
  if (!match) {
    return line;
  }
  replaced = true;
  return `${match[1] || ""}${key}=${value}`;
});
if (!replaced) {
  nextLines.push(`${key}=${value}`);
}
const output = `${nextLines.join("\n").replace(/\n+$/u, "")}\n`;
fs.writeFileSync(file, output, "utf8");
fs.chmodSync(file, 0o600);
EOF
}

echo -e "${BOLD}Checking prerequisites...${RESET}"
check_prereq "node" "Install Node.js 20+ from https://nodejs.org" || exit 1
check_prereq "git" "Install git from https://git-scm.com" || exit 1

# Check Node version
NODE_MAJOR=$(node -v | cut -d. -f1 | tr -d v)
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo -e "${RED}✗ Node.js 20+ required (found $(node -v))${RESET}"
  exit 1
fi
echo -e "${GREEN}✓${RESET} Node.js $(node -v)"

# Check for pnpm
if ! command -v pnpm &>/dev/null; then
  echo -e "${YELLOW}→ Installing pnpm...${RESET}"
  npm install -g pnpm
fi
echo -e "${GREEN}✓${RESET} pnpm $(pnpm -v)"

# Detect if we're already inside the EdwinPAI repo
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/package.json" ] && grep -q '"@edwinpai/edwinpai"' "$SCRIPT_DIR/package.json" 2>/dev/null; then
  INSTALL_DIR="$SCRIPT_DIR"
  echo -e "\n${GREEN}✓${RESET} Running from EdwinPAI repo at $INSTALL_DIR"
elif [ -n "${EDWINPAI_DIR:-${EDWIN_DIR:-}}" ]; then
  INSTALL_DIR="${EDWINPAI_DIR:-$EDWIN_DIR}"
else
  INSTALL_DIR="$HOME/edwinpai"
fi

if [ "$INSTALL_DIR" != "$SCRIPT_DIR" ]; then
  if [ -d "$INSTALL_DIR" ]; then
    echo -e "\n${YELLOW}Directory $INSTALL_DIR already exists.${RESET}"
    read -p "Update existing installation? [Y/n] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
      echo "Aborted."
      exit 0
    fi
    cd "$INSTALL_DIR"
    git pull origin main
  else
    echo -e "\n${BLUE}→ Cloning EdwinPAI...${RESET}"
    git clone https://github.com/onchaininnovation/edwinpai.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi
else
  cd "$INSTALL_DIR"
fi

# Install dependencies
echo -e "\n${BLUE}→ Installing dependencies...${RESET}"
PNPM_INSTALL_ARGS=()
if [ "${CI:-}" = "1" ] || [ "${CI:-}" = "true" ] || [ "${NONINTERACTIVE:-}" = "1" ]; then
  PNPM_INSTALL_ARGS+=(--force)
fi
pnpm install --frozen-lockfile "${PNPM_INSTALL_ARGS[@]}" 2>/dev/null || pnpm install "${PNPM_INSTALL_ARGS[@]}"

# Build
echo -e "\n${BLUE}→ Building...${RESET}"
pnpm build

# Migrate legacy state dir to the canonical .edwinpai home
EDWINPAI_HOME="$HOME/.edwinpai"
LEGACY_EDWIN_HOME="$HOME/.edwin"
if [ -d "$LEGACY_EDWIN_HOME" ] && [ ! -d "$EDWINPAI_HOME" ]; then
  echo -e "\n${BLUE}→ Migrating $LEGACY_EDWIN_HOME → $EDWINPAI_HOME...${RESET}"
  mv "$LEGACY_EDWIN_HOME" "$EDWINPAI_HOME"
  # Rename legacy config file if present
  if [ -f "$EDWINPAI_HOME/edwin.json" ] && [ ! -f "$EDWINPAI_HOME/edwinpai.json" ]; then
    mv "$EDWINPAI_HOME/edwin.json" "$EDWINPAI_HOME/edwinpai.json"
  fi
  echo -e "${GREEN}✓${RESET} Migration complete"
elif [ -d "$LEGACY_EDWIN_HOME" ] && [ -d "$EDWINPAI_HOME" ]; then
  # Both dirs exist — legacy dir is leftover zombie bait (old `edwin` gateway wrote to it).
  # Archive it and remove so nothing accidentally writes to the old path.
  LEGACY_BAK="$EDWINPAI_HOME/edwin-legacy.bak.$(date +%Y%m%d-%H%M%S).tar.gz"
  echo -e "\n${YELLOW}→ Found legacy $LEGACY_EDWIN_HOME alongside $EDWINPAI_HOME${RESET}"
  echo -e "  ${DIM}Archiving to $LEGACY_BAK and removing...${RESET}"
  tar -czf "$LEGACY_BAK" -C "$HOME" .edwin 2>/dev/null \
    && rm -rf "$LEGACY_EDWIN_HOME" \
    && echo -e "${GREEN}✓${RESET} Legacy $LEGACY_EDWIN_HOME archived and removed" \
    || echo -e "${YELLOW}⚠${RESET} Could not archive $LEGACY_EDWIN_HOME — remove manually: rm -rf $LEGACY_EDWIN_HOME"
fi

# Clean up legacy 'edwin' global package and systemd unit
if command -v edwin &>/dev/null 2>&1; then
  echo -e "\n${BLUE}→ Removing legacy 'edwin' global package...${RESET}"
  npm uninstall -g edwin 2>/dev/null || true
  # Remove dangling symlink if npm didn't clean it
  NPM_BIN="$(npm prefix -g)/bin"
  [ -L "$NPM_BIN/edwin" ] && rm -f "$NPM_BIN/edwin"
  echo -e "${GREEN}✓${RESET} Legacy 'edwin' package removed"
fi

# Stop and disable legacy systemd unit (edwin-gateway.service)
LEGACY_SERVICE="$HOME/.config/systemd/user/edwin-gateway.service"
if [ -f "$LEGACY_SERVICE" ] || systemctl --user is-enabled edwin-gateway.service &>/dev/null 2>&1; then
  echo -e "\n${BLUE}→ Removing legacy edwin-gateway systemd unit...${RESET}"
  systemctl --user stop edwin-gateway.service 2>/dev/null || true
  systemctl --user disable edwin-gateway.service 2>/dev/null || true
  rm -f "$LEGACY_SERVICE"
  rm -rf "${LEGACY_SERVICE}.d"
  systemctl --user daemon-reload 2>/dev/null || true
  echo -e "${GREEN}✓${RESET} Legacy systemd unit removed"
fi

# Kill any lingering legacy 'edwin' gateway processes
if pgrep -f "edwin-gateway\|edwin.*gateway" -u "$(id -u)" &>/dev/null; then
  echo -e "\n${YELLOW}→ Killing lingering legacy edwin processes...${RESET}"
  pkill -f "edwin-gateway" -u "$(id -u)" 2>/dev/null || true
  sleep 1
  pkill -9 -f "edwin-gateway" -u "$(id -u)" 2>/dev/null || true
  echo -e "${GREEN}✓${RESET} Legacy processes killed"
fi

# Clear stale CLI session IDs (they break --resume after upgrades)
SESSIONS_FILE="$EDWINPAI_HOME/agents/main/sessions/sessions.json"
if [ -f "$SESSIONS_FILE" ] && command -v python3 &>/dev/null; then
  python3 -c "
import json, sys
try:
    with open('$SESSIONS_FILE', 'r+') as f:
        d = json.load(f)
        changed = False
        for v in d.values():
            if isinstance(v, dict):
                changed = v.pop('cliSessionIds', None) is not None or changed
                changed = v.pop('claudeCliSessionId', None) is not None or changed
        if changed:
            f.seek(0); f.truncate(); json.dump(d, f, indent=2)
            print('  Cleared stale CLI session IDs')
except Exception:
    pass
" 2>/dev/null
  echo -e "${GREEN}✓${RESET} Session cleanup"
fi

# Create data directory
mkdir -p "$EDWINPAI_HOME/agents/main/sessions"
mkdir -p "$EDWINPAI_HOME/workspace/memory"

# Generate config if it doesn't exist
CONFIG_FILE="$EDWINPAI_HOME/edwinpai.json"
LEGACY_CONFIG_FILE="$EDWINPAI_HOME/config.yaml"
if [ ! -f "$CONFIG_FILE" ]; then
  echo -e "\n${BLUE}→ Creating default config...${RESET}"
  GATEWAY_TOKEN="$(node -e 'console.log(require("node:crypto").randomBytes(24).toString("hex"))')"
  cat > "$CONFIG_FILE" << EOF
{
  // EdwinPAI configuration (JSON5 syntax is supported, so comments and trailing commas are OK)
  // Docs: https://docs.edwinpai.com
  gateway: {
    mode: "local",
    port: 18789,
    bind: "loopback",
    auth: {
      mode: "token",
      token: "$GATEWAY_TOKEN"
    }
  },
  agents: {
    defaults: {
      workspace: "~/.edwinpai/workspace"
    }
  },
  ui: {
    assistant: {
      name: "EdwinPAI"
    }
  }
}
EOF
  echo -e "${GREEN}✓${RESET} Config created at $CONFIG_FILE"
fi

if [ -f "$LEGACY_CONFIG_FILE" ]; then
  LEGACY_CONFIG_BAK="$EDWINPAI_HOME/config.yaml.unused.bak.$(date +%Y%m%d-%H%M%S)"
  echo -e "\n${BLUE}→ Archiving unused legacy config.yaml...${RESET}"
  mv "$LEGACY_CONFIG_FILE" "$LEGACY_CONFIG_BAK"
  echo -e "${GREEN}✓${RESET} Archived to $LEGACY_CONFIG_BAK"
fi

# Stamp lastTouchedVersion in edwinpai.json
EDWINPAI_VERSION=$(node -e "console.log(require('./package.json').version)")
EDWINPAI_JSON="$EDWINPAI_HOME/edwinpai.json"
if [ -f "$EDWINPAI_JSON" ] && command -v jq &>/dev/null; then
  jq --arg v "$EDWINPAI_VERSION" '.meta //= {} | .meta.lastTouchedVersion = $v' "$EDWINPAI_JSON" > "${EDWINPAI_JSON}.tmp" && mv "${EDWINPAI_JSON}.tmp" "$EDWINPAI_JSON"
  echo -e "${GREEN}✓${RESET} Set lastTouchedVersion=$EDWINPAI_VERSION in edwinpai.json"
elif [ -f "$EDWINPAI_JSON" ]; then
  echo -e "${YELLOW}⚠${RESET} jq not found — skipping lastTouchedVersion stamp"
fi

# Install globally
echo -e "\n${BLUE}→ Installing globally...${RESET}"
npm install -g . 2>/dev/null || sudo npm install -g .

# Clean stale .edwin references from crontab (migration from edwin → edwinpai)
if crontab -l 2>/dev/null | grep -q '\.edwin/\|\.edwin '; then
  if ! crontab -l 2>/dev/null | grep -q '\.edwinpai'; then
    echo -e "\n${BLUE}→ Cleaning legacy .edwin crontab entries...${RESET}"
    crontab -l 2>/dev/null | grep -v '\.edwin/' | crontab -
    echo -e "${GREEN}✓${RESET} Stale crontab entries removed (workflows/setup.sh will add new ones)"
  fi
fi

# Run workflow/qmd setup (non-fatal — a crash here must not abort the rest of the install)
echo -e "\n${BLUE}→ Setting up workflows and memory...${RESET}"
if [ -f "$INSTALL_DIR/extensions/workflows/setup.sh" ]; then
  EDWINPAI_HOME="$EDWINPAI_HOME" EDWINPAI_CONFIG_PATH="$CONFIG_FILE" bash "$INSTALL_DIR/extensions/workflows/setup.sh" || {
    echo -e "${YELLOW}⚠${RESET} workflows/setup.sh exited non-zero — continuing install"
    echo -e "  ${DIM}Re-run manually: EDWINPAI_HOME=$EDWINPAI_HOME EDWINPAI_CONFIG_PATH=$CONFIG_FILE bash $INSTALL_DIR/extensions/workflows/setup.sh${RESET}"
  }
fi

# Run CLI bridge setup (Claude Code, Codex, Gemini CLI)
echo -e "\n${BLUE}→ Setting up LLM CLI integrations...${RESET}"
if [ -f "$INSTALL_DIR/extensions/cli-bridge/setup.sh" ]; then
  EDWINPAI_HOME="$EDWINPAI_HOME" EDWINPAI_CONFIG_PATH="$CONFIG_FILE" bash "$INSTALL_DIR/extensions/cli-bridge/setup.sh" || {
    echo -e "${YELLOW}⚠${RESET} cli-bridge/setup.sh exited non-zero — continuing install"
    echo -e "  ${DIM}Re-run manually: EDWINPAI_HOME=$EDWINPAI_HOME EDWINPAI_CONFIG_PATH=$CONFIG_FILE bash $INSTALL_DIR/extensions/cli-bridge/setup.sh${RESET}"
  }
fi

# Persist service-safe env defaults used by both the CLI and daemon.
SHAD_COLLECTION_PATH="$EDWINPAI_HOME/workspace"
EDWINPAI_ENV_FILE="$EDWINPAI_HOME/.env"

echo -e "\n${BLUE}→ Writing shared EdwinPAI env to $EDWINPAI_ENV_FILE...${RESET}"
upsert_env_file_var "$EDWINPAI_ENV_FILE" "SHAD_COLLECTION_PATH" "$SHAD_COLLECTION_PATH"
echo -e "${GREEN}✓${RESET} SHAD_COLLECTION_PATH saved to $EDWINPAI_ENV_FILE"

if [ -n "${OPENAI_API_KEY:-}" ]; then
  upsert_env_file_var "$EDWINPAI_ENV_FILE" "OPENAI_API_KEY" "$OPENAI_API_KEY"
  echo -e "${GREEN}✓${RESET} OPENAI_API_KEY saved to $EDWINPAI_ENV_FILE for daemon-safe QMD embeddings"
else
  echo -e "${YELLOW}⚠${RESET} OPENAI_API_KEY not set in this shell — skipping $EDWINPAI_ENV_FILE write"
  echo -e "  ${DIM}If you want service-safe QMD embeddings later, add OPENAI_API_KEY to $EDWINPAI_ENV_FILE${RESET}"
  echo -e "  ${DIM}or set memory.qmd.embeddingApiKey in $CONFIG_FILE.${RESET}"
fi

# Also export SHAD_COLLECTION_PATH in an interactive shell profile when available
# so direct terminal qmd/shad usage works without extra manual setup.
SHELL_PROFILE=""
if [ -f "$HOME/.zshrc" ]; then
  SHELL_PROFILE="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
  SHELL_PROFILE="$HOME/.bashrc"
elif [ -f "$HOME/.profile" ]; then
  SHELL_PROFILE="$HOME/.profile"
fi

if [ -n "$SHELL_PROFILE" ]; then
  if ! grep -qF 'SHAD_COLLECTION_PATH' "$SHELL_PROFILE" 2>/dev/null; then
    echo -e "\n${BLUE}→ Adding SHAD_COLLECTION_PATH to $SHELL_PROFILE for interactive shells...${RESET}"
    cat >> "$SHELL_PROFILE" << EOF

# EdwinPAI — Shad collection path for memory system
export SHAD_COLLECTION_PATH="$SHAD_COLLECTION_PATH"
EOF
    echo -e "${GREEN}✓${RESET} SHAD_COLLECTION_PATH exported in $SHELL_PROFILE"
  else
    echo -e "${GREEN}✓${RESET} SHAD_COLLECTION_PATH already set in $SHELL_PROFILE"
  fi
fi
export SHAD_COLLECTION_PATH

# Ensure sub-agent workspace instructions exist for retrieval-first orchestration
SUBAGENT_INSTRUCTIONS_FILE="$EDWINPAI_HOME/workspace/memory/subagent-instructions.md"
if [ ! -f "$SUBAGENT_INSTRUCTIONS_FILE" ]; then
  echo -e "
${BLUE}→ Creating sub-agent instructions at $SUBAGENT_INSTRUCTIONS_FILE...${RESET}"
  cat > "$SUBAGENT_INSTRUCTIONS_FILE" << 'EOF'
# Subagent Instructions

You are a sub-agent working for the main Edwin agent.

## Mission

Do the assigned task well, stay within scope, and leave behind a structured synthesis artifact the main agent can trust and integrate.

You do **not** own canonical long-term memory. You contribute findings; the main agent decides what gets promoted.

## Mandatory startup sequence

Before doing substantive work:

1. Read `memory/tasks/today.md`.
2. Read this file: `memory/subagent-instructions.md`.
3. Retrieve task context from the shared memory layer.
4. Read any explicitly named files from the parent handoff.
5. Only then start analysis or edits.

## Shared memory retrieval hook

Use the same retrieval layer the main agent uses.

### Primary retrieval

- BM25 search:
  - `qmd search "<task/topic query>" --collection workspace --limit 10`

### Additional retrieval when you know the file

Read the most relevant known files directly, for example:

- `memory/YYYY-MM-DD.md`
- `memory/tasks/today.md`
- `memory/contacts.md`
- repo-specific ledgers, docs, or planning files named in the handoff

### Retrieval rule

Do not assume the parent's live context is available to you.
Use the shared memory layer first, then the repo/filesystem, then reason.
If retrieval is weak or ambiguous, say so explicitly in your artifact.

## Working rules

- Stay tightly scoped to the assigned task.
- Prefer direct evidence from files, search results, commands, tests, and diffs.
- Distinguish facts from inferences.
- Do not write to canonical memory files unless the parent explicitly told you to write to a specific location.
- If you create notes/artifacts, keep them task-specific and easy for the parent to inspect.
- Do not message external people unless explicitly tasked.

## Required final output: structured synthesis artifact

Your final response must use exactly these sections, in this order:

### task
A short restatement of the assigned task.

### scope / files examined
List the key files, directories, searches, commands, or sources you used.

### actions taken
What you actually did.

### findings
Concrete observations, evidence, and results.

### conclusions
Your bottom-line synthesis from the findings.

### confidence
Use one of: `high`, `medium`, or `low`, with a brief reason.

### open questions / uncertainties
Anything unresolved, ambiguous, unverified, or worth follow-up.

## Artifact quality bar

Good artifact traits:

- evidence-based
- explicit about what was examined
- clear about what changed vs what was only observed
- honest about uncertainty
- compact but information-dense

Bad artifact traits:

- vague claims without evidence
- no file or command trail
- mixing findings with guesses
- pretending a task is complete when it is only partially explored

## Default stance

Retrieve first.
Work second.
Synthesize clearly.
Leave integration to the main agent.
EOF
  echo -e "${GREEN}✓${RESET} Sub-agent instructions created"
else
  echo -e "${GREEN}✓${RESET} Sub-agent instructions already present at $SUBAGENT_INSTRUCTIONS_FILE"
fi

# Ensure AGENTS.md includes the default main-only git workflow guidance
WORKSPACE_AGENTS_FILE="$EDWINPAI_HOME/workspace/AGENTS.md"
if [ -f "$WORKSPACE_AGENTS_FILE" ]; then
  if ! grep -qF '## Git Workflow' "$WORKSPACE_AGENTS_FILE" 2>/dev/null; then
    echo -e "\n${BLUE}→ Adding main-only git workflow guidance to $WORKSPACE_AGENTS_FILE...${RESET}"
    python3 -c 'from pathlib import Path; import sys; p = Path(sys.argv[1]); t = p.read_text(); block = "## Git Workflow\n\n- Default to committing directly on `main` for this workspace/project setup.\n- Do not create separate fix/feature branches unless Jake explicitly asks for branch-based work.\n- If there are stray local branches from past work, merge them back to `main` and continue on `main`.\n"; marker = "## Make It Yours\n"; t = t if "## Git Workflow" in t else (t.replace(marker, block + "\n" + marker, 1) if marker in t else t.rstrip() + "\n\n" + block + "\n"); p.write_text(t)' "$WORKSPACE_AGENTS_FILE"
    echo -e "${GREEN}✓${RESET} Added git workflow guidance"
  else
    echo -e "${GREEN}✓${RESET} Git workflow guidance already present in $WORKSPACE_AGENTS_FILE"
  fi
fi

# Verify Claude Code hooks are wired
if [ -f "$HOME/.claude/settings.json" ]; then
  HOOK_COUNT=$(jq '[.hooks // {} | to_entries[] | .value[] | .hooks[]? | .command // "" | select(test("before-agent-start|agent-end|before-compaction|message-sent"))] | length' "$HOME/.claude/settings.json" 2>/dev/null || echo "0")
  if [ "$HOOK_COUNT" -ge 4 ]; then
    echo -e "${GREEN}✓${RESET} All 4 memory hooks registered in Claude Code settings"
  else
    echo -e "${YELLOW}⚠ Only $HOOK_COUNT/4 memory hooks found in ~/.claude/settings.json${RESET}"
    echo -e "  ${DIM}Expected: before_agent_start, agent_end, before_compaction, message_sent${RESET}"
    echo -e "  ${DIM}Re-run: bash $INSTALL_DIR/extensions/cli-bridge/setup.sh${RESET}"
  fi
fi

# Verify CLI auth (Claude Code OAuth tokens can go stale after upgrades)
if command -v claude &>/dev/null; then
  if ! claude -p --output-format json "ping" 2>/dev/null | grep -q '"is_error":false'; then
    echo -e "\n${YELLOW}⚠ Claude CLI auth may be stale — if you get 'out of extra usage' errors:${RESET}"
    echo -e "  ${DIM}claude auth logout && claude auth login${RESET}"
  fi
fi

# Verify
echo -e "\n${BOLD}${GREEN}✅ EdwinPAI installed successfully!${RESET}\n"
echo -e "  ${BOLD}Quick start:${RESET}"
echo -e "  1. Log into a frontier CLI (pick one or more):"
echo -e "     ${DIM}claude         — Claude Code (claude.ai/code)${RESET}"
echo -e "     ${DIM}codex          — OpenAI Codex CLI${RESET}"
echo -e "     ${DIM}gemini         — Google Gemini CLI${RESET}"
echo -e "     ${DIM}...or set an API key in $EDWINPAI_HOME/.env (preferred) or export ANTHROPIC_API_KEY=sk-...${RESET}"
echo -e "  2. Edit config:       ${DIM}nano $CONFIG_FILE${RESET}"
echo -e "  3. Start EdwinPAI:    ${DIM}edwinpai gateway start${RESET}"
echo -e "  4. Check status:      ${DIM}edwinpai status${RESET}"
echo -e ""
echo -e "  ${DIM}Data directory: $EDWINPAI_HOME${RESET}"
echo -e "  ${DIM}Config file:    $CONFIG_FILE${RESET}"
echo -e ""
echo -e "  ${BOLD}Troubleshooting:${RESET}"
echo -e "  ${DIM}If you see 'out of extra usage' errors but your plan has capacity,${RESET}"
echo -e "  ${DIM}re-authenticate the CLI: claude auth logout && claude auth login${RESET}"
echo -e "  ${DIM}OAuth tokens can go stale after upgrades or long idle periods.${RESET}"
echo -e "  ${DIM}For qmd/OpenAI memory embeddings, prefer $EDWINPAI_HOME/.env for OPENAI_API_KEY${RESET}"
echo -e "  ${DIM}(loaded by both the CLI and daemon), or set memory.qmd.embeddingApiKey${RESET}"
echo -e "  ${DIM}(or plugins.entries[\"shad-context\"].config.embeddingApiKey) in $CONFIG_FILE.${RESET}"
echo -e ""
echo -e "  ${BOLD}⚡ Welcome to EdwinPAI.${RESET}"
