#!/bin/bash
# task-triage.sh — Check for overdue/stale tasks
# Part of the heartbeat workflow replacement.
set -euo pipefail

WORKSPACE="$HOME/.edwinpai/workspace"
MEMORY_DIR="$WORKSPACE/memory"
TASKS_DIR="$MEMORY_DIR/tasks"
TODAY=$(date +%Y-%m-%d)

echo "[$(date -Iseconds)] Task triage starting..."

# 1. Check today.md for any items
if [ -f "$TASKS_DIR/today.md" ]; then
  TASK_COUNT=$(grep -c '^\s*- \[ \]' "$TASKS_DIR/today.md" 2>/dev/null || echo 0)
  echo "[$(date -Iseconds)] Open tasks today: $TASK_COUNT"
fi

# 2. Check waiting.md for stale items (> 3 days old)
if [ -f "$TASKS_DIR/waiting.md" ]; then
  WAITING_COUNT=$(grep -c '^\s*- \[ \]' "$TASKS_DIR/waiting.md" 2>/dev/null || echo 0)
  echo "[$(date -Iseconds)] Waiting items: $WAITING_COUNT"
fi

# 3. Check inbox for unprocessed items
if [ -f "$TASKS_DIR/inbox.md" ]; then
  INBOX_COUNT=$(grep -c '^\s*- ' "$TASKS_DIR/inbox.md" 2>/dev/null || echo 0)
  if [ "$INBOX_COUNT" -gt 0 ]; then
    echo "[$(date -Iseconds)] Inbox items to process: $INBOX_COUNT"
  fi
fi

echo "[$(date -Iseconds)] Task triage complete."
