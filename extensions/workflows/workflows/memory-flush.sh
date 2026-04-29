#!/bin/bash
# memory-flush.sh — Persist session context to disk
# Part of the heartbeat workflow replacement.
# Runs periodically to ensure memory files stay current.
set -euo pipefail

WORKSPACE="$HOME/.edwinpai/workspace"
MEMORY_DIR="$WORKSPACE/memory"
TODAY=$(date +%Y-%m-%d)
DAILY_FILE="$MEMORY_DIR/$TODAY.md"

echo "[$(date -Iseconds)] Memory flush starting..."

# 1. Ensure daily file exists
if [ ! -f "$DAILY_FILE" ]; then
  DAY_NAME=$(date +"%A, %B %-d, %Y")
  echo "# $DAY_NAME" > "$DAILY_FILE"
  echo "" >> "$DAILY_FILE"
  echo "---" >> "$DAILY_FILE"
  echo "" >> "$DAILY_FILE"
  echo "[$(date -Iseconds)] Created daily file: $DAILY_FILE"
fi

# 2. Update qmd index with any new/changed files
if command -v qmd &>/dev/null; then
  export QMD_OPENAI=1
  unset OPENAI_API_KEY 2>/dev/null || true
  qmd update -c workspace 2>&1 || echo "[warn] qmd update failed"
fi

echo "[$(date -Iseconds)] Memory flush complete."
