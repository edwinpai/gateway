#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
ROOT="$(cd "$ROOT" && pwd)"

PROTECTED_PATH_PATTERNS=(
  'packages/identity-core/*'
  'packages/shad-core/*'
  'src/identity-core*'
  'src/shad-core*'
  'src/memory/*'
  'extensions/shad-context/*'
  'skills/1password/*'
  'skills/apple-notes/*'
  'skills/apple-reminders/*'
  'skills/bear-notes/*'
  'skills/bird/*'
  'skills/blogwatcher/*'
  'skills/blucli/*'
  'skills/bluebubbles/*'
  'skills/camsnap/*'
  'skills/canvas/*'
  'skills/discord/*'
  'skills/eightctl/*'
  'skills/food-order/*'
  'skills/gemini/*'
  'skills/gifgrep/*'
  'skills/goplaces/*'
  'skills/gws/*'
  'skills/local-places/*'
  'skills/mcporter/*'
  'skills/model-usage/*'
  'skills/nano-banana-pro/*'
  'skills/notion/*'
  'skills/obsidian/*'
  'skills/openhue/*'
  'skills/oracle/*'
  'skills/ordercli/*'
  'skills/sag/*'
  'skills/shad-protocol/*'
  'skills/sherpa-onnx-tts/*'
  'skills/slack/*'
  'skills/songsee/*'
  'skills/sonoscli/*'
  'skills/spotify-player/*'
  'skills/summarize/*'
  'skills/things-mac/*'
  'skills/trello/*'
  'skills/voice-call/*'
  'docs/reference/templates/memory/*'
  'SHAD_ARCHITECTURE_SPEC.md'
  'src/agents/memory-search*'
  'src/agents/tools/memory-tool*'
  'src/cli/memory-cli*'
  'scripts/sqlite-vec-smoke.mjs'
)

failures=0
for pattern in "${PROTECTED_PATH_PATTERNS[@]}"; do
  while IFS= read -r -d '' match; do
    rel="${match#"$ROOT/"}"
    printf 'forbidden package-export path present: %s\n' "$rel" >&2
    failures=$((failures + 1))
  done < <(find "$ROOT" -path "$ROOT/.git" -prune -o -path "$ROOT/node_modules" -prune -o -path "$ROOT/.pnpm-store" -prune -o -path "$ROOT/$pattern" -print0)
done

if rg -n --hidden --glob '!.git/**' --glob '!node_modules/**' --glob '!pnpm-lock.yaml' --glob '!package-lock.json' --glob '!Cargo.lock' \
  '(from|import).*(["'"'']\.\.?/.*(memory|shad-core|identity-core)|["'"'']@edwinpai/(edwinpai|identity-core|shad-core).*/src/)' "$ROOT" >/tmp/edwinpai-public-export-guard-rg.txt 2>/dev/null; then
  cat /tmp/edwinpai-public-export-guard-rg.txt >&2
  failures=$((failures + 1))
fi

if (( failures > 0 )); then
  printf 'package export guard failed with %d forbidden finding(s)\n' "$failures" >&2
  exit 1
fi

printf 'package export guard passed: %s\n' "$ROOT"
