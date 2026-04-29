#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMPT_BUILDER="$SCRIPT_DIR/build_edwin_subprocess_prompt.py"
CODEX_BIN="${CODEX_BIN:-codex}"
MODE="full-auto"
TASK=""
QUERY=""
WAKE_TEXT=""
EXTRA_INSTRUCTION=""
LIMIT="6"
COLLECTION="memory-dir"
READ_FILES=()
BUILDER_ARGS=()

usage() {
  cat <<'EOF'
Usage:
  run_edwin_codex.sh --task "..." [options]

Options:
  --task TEXT              Required task for Codex.
  --query TEXT             Optional memory retrieval query (defaults to task text).
  --read PATH              Explicit handoff file to inject (repeatable).
  --full-auto              Run `codex exec --full-auto` (default).
  --plain                  Run plain `codex exec`.
  --wake-text TEXT         Append an Edwin wake command instruction.
  --extra-instruction TXT  Append an extra instruction block to the prompt.
  --limit N                Memory hit limit for retrieval (default: 6).
  --collection NAME        Memory collection for qmd search (default: memory-dir).
  --print-prompt           Print the generated prompt and exit.
  --                      Stop parsing; remaining args are ignored.
EOF
}

PRINT_PROMPT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task)
      TASK="${2:-}"
      shift 2
      ;;
    --query)
      QUERY="${2:-}"
      shift 2
      ;;
    --read)
      READ_FILES+=("${2:-}")
      shift 2
      ;;
    --full-auto)
      MODE="full-auto"
      shift
      ;;
    --plain)
      MODE="plain"
      shift
      ;;
    --wake-text)
      WAKE_TEXT="${2:-}"
      shift 2
      ;;
    --extra-instruction)
      EXTRA_INSTRUCTION="${2:-}"
      shift 2
      ;;
    --limit)
      LIMIT="${2:-}"
      shift 2
      ;;
    --collection)
      COLLECTION="${2:-}"
      shift 2
      ;;
    --print-prompt)
      PRINT_PROMPT=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$TASK" ]]; then
  echo "--task is required" >&2
  usage >&2
  exit 1
fi

if ! command -v "$CODEX_BIN" >/dev/null 2>&1; then
  echo "Codex CLI not found on PATH: $CODEX_BIN" >&2
  exit 1
fi

if [[ ! -x "$PROMPT_BUILDER" ]]; then
  chmod +x "$PROMPT_BUILDER"
fi

BUILDER_ARGS+=(--task "$TASK" --limit "$LIMIT" --collection "$COLLECTION")
if [[ -n "$QUERY" ]]; then
  BUILDER_ARGS+=(--query "$QUERY")
fi
if [[ -n "$WAKE_TEXT" ]]; then
  BUILDER_ARGS+=(--wake-text "$WAKE_TEXT")
fi
if [[ -n "$EXTRA_INSTRUCTION" ]]; then
  BUILDER_ARGS+=(--extra-instruction "$EXTRA_INSTRUCTION")
fi
if (( ${#READ_FILES[@]} > 0 )); then
  for path in "${READ_FILES[@]}"; do
    BUILDER_ARGS+=(--read "$path")
  done
fi

PROMPT_FILE="$(mktemp -t edwin-codex-prompt.XXXXXX.md)"
cleanup() {
  rm -f "$PROMPT_FILE"
}
trap cleanup EXIT

python3 "$PROMPT_BUILDER" "${BUILDER_ARGS[@]}" > "$PROMPT_FILE"

if [[ "$PRINT_PROMPT" == "1" ]]; then
  cat "$PROMPT_FILE"
  exit 0
fi

if [[ "$MODE" == "plain" ]]; then
  exec "$CODEX_BIN" exec - < "$PROMPT_FILE"
fi

exec "$CODEX_BIN" exec --full-auto - < "$PROMPT_FILE"
