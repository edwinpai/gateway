#!/bin/bash
# Workflow runner — designed to live under ~/.edwinpai/workspace/workflows/run.sh
# Usage: ./run.sh <workflow-name>
#
# The workflow definitions, logs, and state live under ~/.edwinpai/workspace/workflows.
# The execution engine still comes from an Edwin source checkout for now, but this
# wrapper avoids hardcoding repo paths into crontab or workflow files.

set -euo pipefail

WORKFLOW_NAME="${1:?Usage: run.sh <workflow-name>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKFLOWS_DIR="${EDWINPAI_WORKFLOWS_DIR:-$HOME/.edwinpai/workspace/workflows}"
LOG_DIR="$WORKFLOWS_DIR/.logs"
LOG_FILE="$LOG_DIR/$WORKFLOW_NAME.log"

mkdir -p "$LOG_DIR"

find_node_bin() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  local candidate
  local candidates=()
  for candidate in     "$HOME/.config/nvm/versions/node"/*/bin/node     "$HOME/.nvm/versions/node"/*/bin/node     "$HOME/.local/bin/node"     /usr/local/bin/node     /usr/bin/node
  do
    if [ -x "$candidate" ]; then
      candidates+=("$candidate")
    fi
  done

  if [ ${#candidates[@]} -gt 0 ]; then
    printf '%s
' "${candidates[@]}" | sort -V | tail -n 1
    return 0
  fi

  return 1
}

detect_repo_dir() {
  local candidate

  if [ -n "${EDWINPAI_REPO_DIR:-}" ] && [ -f "$EDWINPAI_REPO_DIR/extensions/workflows/src/engine.ts" ]; then
    printf '%s\n' "$EDWINPAI_REPO_DIR"
    return 0
  fi

  for candidate in \
    "$HOME/Desktop/edwin" \
    "$HOME/edwin"
  do
    if [ -f "$candidate/extensions/workflows/src/engine.ts" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

# Source env vars (API keys etc.) — export so child processes see them
set -a
[ -f "$HOME/.edwinpai/.env" ] && source "$HOME/.edwinpai/.env"
set +a

# Unset invalid OAuth tokens that can't be used as raw API keys
if [[ "${ANTHROPIC_API_KEY:-}" == sk-ant-oat* ]]; then
  unset ANTHROPIC_API_KEY
fi

NODE_BIN="$(find_node_bin || true)"
if [ -z "$NODE_BIN" ]; then
  echo "=== $(date -Iseconds) === Running: $WORKFLOW_NAME ===" >> "$LOG_FILE"
  echo "Runner error: node binary not found. Install Node.js or set PATH for cron." >> "$LOG_FILE"
  echo "=== Done ===" >> "$LOG_FILE"
  exit 1
fi

REPO_DIR="$(detect_repo_dir || true)"
if [ -z "$REPO_DIR" ]; then
  echo "=== $(date -Iseconds) === Running: $WORKFLOW_NAME ===" >> "$LOG_FILE"
  echo "Runner error: Edwin source repo with workflows engine not found. Set EDWINPAI_REPO_DIR if needed." >> "$LOG_FILE"
  echo "=== Done ===" >> "$LOG_FILE"
  exit 1
fi

echo "=== $(date -Iseconds) === Running: $WORKFLOW_NAME ===" >> "$LOG_FILE"
echo "Runner: $SCRIPT_DIR/run.sh" >> "$LOG_FILE"
echo "Engine repo: $REPO_DIR" >> "$LOG_FILE"
echo "Node: $NODE_BIN" >> "$LOG_FILE"

cd "$REPO_DIR"
"$NODE_BIN" --import tsx -e "
import { WorkflowEngine } from './extensions/workflows/src/engine.js';
const engine = new WorkflowEngine();
engine.executeWorkflow('$WORKFLOW_NAME').then(result => {
  const status = result.success ? 'OK' : 'FAILED';
  const steps = Object.entries(result.stepResults)
    .map(([id, o]) => \`  \${o.success ? '✓' : '✗'} \${id}\`)
    .join('\\n');
  console.log(\`[\${status}] \${result.workflowName} (\${result.duration}ms)\\n\${steps}\`);
  if (!result.success) process.exit(1);
}).catch(err => {
  console.error('Engine error:', err.message);
  process.exit(1);
});
" >> "$LOG_FILE" 2>&1

echo "=== Done ===" >> "$LOG_FILE"
