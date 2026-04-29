#!/bin/bash
# setup.sh — Install workflow extension for this EdwinPAI instance
# Replaces the built-in cron and heartbeat systems with lightweight YAML workflows.
#
# What this does:
#   0. Installs qmd (memory search backend) if not present
#   1. Copies bundled workflow YAMLs into ~/.edwinpai/workspace/workflows/
#   2. Copies helper scripts and the workflow runner into workspace
#   3. Sets EDWINPAI_SKIP_CRON=1 and EDWINPAI_SKIP_HEARTBEAT=1 in gateway env
#   4. Installs crontab entries for all scheduled workflows
#   5. Initializes qmd collections and indexes workspace (using config-aware embedding keys when available)
#
# Usage: ./setup.sh
#   Run from any directory — script resolves paths relative to itself.
#   Safe to re-run (idempotent).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUNDLED_WORKFLOWS="$SCRIPT_DIR/workflows"
WORKSPACE_WORKFLOWS="$HOME/.edwinpai/workspace/workflows"
RUNNER="$WORKSPACE_WORKFLOWS/run.sh"
RUNNER_SOURCE="$SCRIPT_DIR/run.sh"
GATEWAY_ENV_DIR="$HOME/.config/systemd/user/edwinpai-gateway.service.d"
GATEWAY_ENV_FILE="$GATEWAY_ENV_DIR/env.conf"
EDWINPAI_HOME="${EDWINPAI_HOME:-$HOME/.edwinpai}"
EDWINPAI_CONFIG="${EDWINPAI_CONFIG_PATH:-$EDWINPAI_HOME/edwinpai.json}"

echo "=== EdwinPAI Workflows Setup ==="
echo "Extension dir: $SCRIPT_DIR"
echo "Workspace dir: $WORKSPACE_WORKFLOWS"
echo ""

resolve_qmd_embedding_api_key() {
  if ! command -v node &>/dev/null; then
    printf '%s' "${OPENAI_API_KEY:-}"
    return 0
  fi

  node - "$EDWINPAI_CONFIG" "$SCRIPT_DIR/../../node_modules/json5" <<'NODE'
const fs = require("node:fs");
const configPath = process.argv[2];
const json5ModulePath = process.argv[3];
let JSON5;
try {
  JSON5 = require("json5");
} catch {
  try {
    JSON5 = require(json5ModulePath);
  } catch {
    JSON5 = { parse: JSON.parse };
  }
}
let parsed = {};
try {
  if (configPath && fs.existsSync(configPath)) {
    parsed = JSON5.parse(fs.readFileSync(configPath, "utf8"));
  }
} catch {}
function pick(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}
const key = pick(
  parsed?.memory?.qmd?.embeddingApiKey,
  parsed?.plugins?.entries?.["shad-context"]?.config?.embeddingApiKey,
  parsed?.env?.vars?.OPENAI_API_KEY,
  parsed?.env?.OPENAI_API_KEY,
  process.env.OPENAI_API_KEY,
);
process.stdout.write(key);
NODE
}

# ── 0. Install qmd (memory search backend) ────────────────────────────────
echo "Checking qmd..."
QMD_REPO="github:jonesj38/qmd#feat/openai-embeddings"
if command -v qmd &>/dev/null; then
  echo "  [ok] qmd found at $(which qmd)"
else
  echo "  [install] Installing qmd from fork ($QMD_REPO)..."
  if command -v bun &>/dev/null; then
    bun install -g "$QMD_REPO" 2>&1 | sed 's/^/  /'
  elif command -v npm &>/dev/null; then
    npm install -g "$QMD_REPO" 2>&1 | sed 's/^/  /'
  else
    echo "  [error] Neither bun nor npm found. Install qmd manually: npm install -g $QMD_REPO"
  fi
fi
echo ""

# ── 1. Copy workflow YAMLs into workspace ──────────────────────────────────
mkdir -p "$WORKSPACE_WORKFLOWS"

echo "Installing workflows..."
if [ -d "$BUNDLED_WORKFLOWS" ]; then
  for f in "$BUNDLED_WORKFLOWS"/*.yaml "$BUNDLED_WORKFLOWS"/*.yml; do
    [ -f "$f" ] || continue
    name=$(basename "$f")
    target="$WORKSPACE_WORKFLOWS/$name"
    if [ -L "$target" ]; then
      rm "$target"
      cp "$f" "$target"
      echo "  [migrate] $name (replaced old symlink with workspace copy)"
    elif [ -f "$target" ]; then
      if ! diff -q "$f" "$target" &>/dev/null; then
        cp "$f" "$target"
        echo "  [update] $name"
      else
        echo "  [ok] $name (up to date)"
      fi
    else
      cp "$f" "$target"
      echo "  [copy] $name"
    fi
  done
fi

# ── 2. Copy helper scripts and runner ─────────────────────────────────────
echo ""
echo "Installing scripts..."
cp "$RUNNER_SOURCE" "$RUNNER"
chmod +x "$RUNNER"
echo "  [copy] $(basename "$RUNNER")"
for f in "$BUNDLED_WORKFLOWS"/*.sh; do
  [ -f "$f" ] || continue
  name=$(basename "$f")
  target="$WORKSPACE_WORKFLOWS/$name"
  if [ ! -f "$target" ]; then
    cp "$f" "$target"
    chmod +x "$target"
    echo "  [copy] $name"
  elif ! diff -q "$f" "$target" &>/dev/null; then
    cp "$f" "$target"
    chmod +x "$target"
    echo "  [update] $name (overwritten with newer version)"
  else
    echo "  [ok] $name (up to date)"
  fi
done

# ── 3. Disable built-in cron and heartbeat ─────────────────────────────────
echo ""
echo "Disabling built-in cron and heartbeat..."

if [ -f "$GATEWAY_ENV_FILE" ]; then
  ENV_CHANGED=false

  if ! grep -q "EDWINPAI_SKIP_CRON" "$GATEWAY_ENV_FILE"; then
    if grep -q '^\[Service\]' "$GATEWAY_ENV_FILE"; then
      echo 'Environment="EDWINPAI_SKIP_CRON=1"' >> "$GATEWAY_ENV_FILE"
    fi
    ENV_CHANGED=true
    echo "  [set] EDWINPAI_SKIP_CRON=1"
  else
    echo "  [skip] EDWINPAI_SKIP_CRON already set"
  fi

  if ! grep -q "EDWINPAI_SKIP_HEARTBEAT" "$GATEWAY_ENV_FILE"; then
    if grep -q '^\[Service\]' "$GATEWAY_ENV_FILE"; then
      echo 'Environment="EDWINPAI_SKIP_HEARTBEAT=1"' >> "$GATEWAY_ENV_FILE"
    fi
    ENV_CHANGED=true
    echo "  [set] EDWINPAI_SKIP_HEARTBEAT=1"
  else
    echo "  [skip] EDWINPAI_SKIP_HEARTBEAT already set"
  fi

  if [ "$ENV_CHANGED" = true ]; then
    echo "  [note] Run 'systemctl --user daemon-reload && systemctl --user restart edwinpai-gateway' to apply"
  fi
else
  echo "  [warn] Gateway env file not found at $GATEWAY_ENV_FILE"
  echo "  [note] Set these env vars manually for your deployment:"
  echo "         EDWINPAI_SKIP_CRON=1"
  echo "         EDWINPAI_SKIP_HEARTBEAT=1"
fi

# ── 4. Install crontab entries ─────────────────────────────────────────────
echo ""
echo "Configuring crontab..."

CURRENT_CRON=$(crontab -l 2>/dev/null || true)
CRON_CHANGED=false

# Remove old repo-pinned runner entries if present.
OLD_RUNNERS=(
  "$SCRIPT_DIR/run.sh"
  "$HOME/Desktop/edwin/extensions/workflows/run.sh"
  "$HOME/edwin/extensions/workflows/run.sh"
)
for old_runner in "${OLD_RUNNERS[@]}"; do
  if echo "$CURRENT_CRON" | grep -qF "$old_runner"; then
    CURRENT_CRON=$(printf '%s\n' "$CURRENT_CRON" | grep -vF "$old_runner" || true)
    CRON_CHANGED=true
    echo "  [migrate] Removed old runner entry: $old_runner"
  fi
done

# System workflow schedules only — personal workflows should be added
# per-instance via: crontab -e
# Format: "schedule|workflow-name|comment"
SCHEDULE_LIST=(
  "*/30 * * * *|heartbeat|Heartbeat — memory flush + task triage"
  "0 3 * * *|memory-consolidation|Dreamer — nightly memory consolidation"
)

for entry in "${SCHEDULE_LIST[@]}"; do
  IFS='|' read -r schedule workflow comment <<< "$entry"

  if echo "$CURRENT_CRON" | grep -qF "$RUNNER $workflow"; then
    echo "  [skip] $workflow (already scheduled)"
  else
    CURRENT_CRON=$(printf '%s\n# %s\n%s %s %s' "$CURRENT_CRON" "$comment" "$schedule" "$RUNNER" "$workflow")
    CRON_CHANGED=true
    echo "  [add]  $schedule  $workflow"
  fi
done

# User-defined workflows in ~/.edwinpai/workspace/workflows/ are auto-detected.
# Add personal schedules to crontab manually:
#   crontab -e
#   0 9 * * *  ~/.edwinpai/workspace/workflows/run.sh my-workflow

if [ "$CRON_CHANGED" = true ]; then
  echo "$CURRENT_CRON" | crontab -
  echo ""
  echo "Crontab updated."
else
  echo ""
  echo "Crontab already up to date."
fi

# ── 5. Initialize qmd collections ──────────────────────────────────────────
echo ""
echo "Initializing qmd..."
if command -v qmd &>/dev/null; then
  WORKSPACE_DIR="$HOME/.edwinpai/workspace"

  if ! qmd collection list 2>/dev/null | grep -q "workspace"; then
    qmd collection add "$WORKSPACE_DIR" --name workspace --mask "**/*.md" 2>&1 | sed 's/^/  /' || true
    echo "  [add] workspace collection → $WORKSPACE_DIR"
  else
    echo "  [skip] workspace collection (already exists)"
  fi

  echo "  [run] qmd update..."
  qmd update 2>&1 | tail -1 | sed 's/^/  /' || true

  QMD_EMBEDDING_API_KEY="$(resolve_qmd_embedding_api_key)"
  if [ -n "$QMD_EMBEDDING_API_KEY" ]; then
    echo "  [run] qmd embed (OpenAI embeddings)..."
    OPENAI_API_KEY="$QMD_EMBEDDING_API_KEY" QMD_OPENAI=1 qmd embed 2>&1 | tail -1 | sed 's/^/  /' || true
  else
    echo "  [skip] qmd embed (no embedding key in config/env — set memory.qmd.embeddingApiKey, shad-context.embeddingApiKey, or OPENAI_API_KEY)"
  fi
else
  echo "  [warn] qmd not found — memory search will fall back to builtin"
fi

# ── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "=== Setup Complete ==="
echo ""
echo "Installed workflows:"
ls -1 "$WORKSPACE_WORKFLOWS"/*.yaml "$WORKSPACE_WORKFLOWS"/*.yml 2>/dev/null | while read -r f; do
  echo "  - $(basename "$f" | sed 's/\.ya\?ml$//')"
done
echo ""
echo "Built-in cron:     DISABLED (use EDWINPAI_LEGACY_CRON=1 to re-enable)"
echo "Built-in heartbeat: DISABLED (use EDWINPAI_SKIP_HEARTBEAT=0 to re-enable)"
echo "Memory backend:    qmd (BM25 + vector search)"
echo ""
echo "Run a workflow:    $RUNNER <workflow-name>"
echo "Search memory:     qmd query 'your search query'"
echo "Check crontab:     crontab -l"
echo "View logs:         cat ~/.edwinpai/workspace/workflows/.logs/<name>.log"
