#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/export-public-repo.sh --target-dir <dir> [--dry-run]

Exports the sanitized public gateway tree from the private development repo.
This is intentionally a copy/squash export: it never copies .git history.
USAGE
}

TARGET_DIR=""
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-dir)
      TARGET_DIR="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$TARGET_DIR" ]]; then
  echo "--target-dir is required" >&2
  usage >&2
  exit 2
fi

mkdir -p "$TARGET_DIR"

RSYNC_ARGS=(
  -a
  --delete
  --delete-excluded
  --exclude '/.git/'
  --exclude '/.github/workflows/publish-to-public.yml'
  --exclude '/.agent/'
  --exclude '/.claude/'
  --exclude '/.pi/'
  --exclude '/.pnpm-store/'
  --exclude '/.secrets.baseline'
  --exclude '/node_modules/'
  --exclude '/**/node_modules/'
  --exclude '/dist/'
  --exclude '/**/dist/'
  --exclude '/.tmp/'
  --exclude '/tmp/'
  --exclude '/coverage/'
  --exclude '/.nyc_output/'
  --exclude '/.env'
  --exclude '/.env.*'
  --exclude '/npm-debug.log*'
  --exclude '/pnpm-debug.log*'
  --exclude '/docs/internal/'
  --exclude '/archive/'
  --exclude '/packages/identity-core/'
  --exclude '/packages/shad-core/'
  --exclude '/src/identity-core*'
  --exclude '/src/shad-core*'
  --exclude '/src/memory/'
  --exclude '/extensions/shad-context/'
  --exclude '/skills/shad-protocol/'
  --exclude '/docs/concepts/memory.mdx'
  --exclude '/docs/reference/templates/memory/'
  --exclude '/SHAD_ARCHITECTURE_SPEC.md'
  --exclude '/src/agents/memory-search*'
  --exclude '/src/agents/tools/memory-tool*'
  --exclude '/src/cli/memory-cli*'
  --exclude '/src/commands/status.scan.ts'
  --exclude '/scripts/sqlite-vec-smoke.mjs'
  --exclude '/scripts/prepare-identity-core-base-package.ts'
  --exclude '/scripts/prepare-identity-core-platform-packages.ts'
  --exclude '/scripts/sync-identity-core-artifacts.ts'
  --exclude '/src/gateway/*memory*'
  --exclude '/src/gateway/__tests__/*memory*'
  --exclude '/src/__tests__/e2e-crypto-flow.test.ts'
  --exclude '/src/auto-reply/reply/*memory*'
  --exclude '/src/commands/doctor-knowledge.ts'
  --exclude '/src/commands/status.command.ts'
  --exclude '/src/cli/program/command-registry.ts'
  --exclude '/src/plugins/runtime/index.ts'
  --exclude '/src/plugins/runtime/types.ts'
  --exclude '/src/agents/knowledge-discipline-profiles.ts'
  --exclude '/src/agents/pi-embedded-runner/system-prompt.ts'
  --exclude '/src/agents/tools/sessions-spawn-tool.ts'
  --exclude '/src/agents/subagent-announce.ts'
  --exclude '/src/agents/subagent-registry.ts'
  --exclude '/src/agents/system-prompt.ts'
  --exclude '/src/auto-reply/reply/agent-runner.ts'
  --exclude '/src/config/types.memory.ts'
  --exclude '/src/auto-reply/reply/agent-runner.reasoning-tags.test.ts'
  --exclude '/src/config/types.agent-defaults.ts'
  --exclude '/src/config/types.edwinpai.ts'
  --exclude '/src/config/types.agents.ts'
  --exclude '/src/config/types.ts'
  --exclude '/packages/identity-core/native-staging/'
  --exclude '/.DS_Store'
)

if [[ "$DRY_RUN" == "1" ]]; then
  RSYNC_ARGS+=(--dry-run --itemize-changes)
fi

rsync "${RSYNC_ARGS[@]}" ./ "$TARGET_DIR"/

# Public gateway owns the root @edwinpai/edwinpai package release path. Keep the
# dev-only public-copy workflow out of the exported repo, but leave normal CI and
# future public release workflows available in the copied tree.

if [[ "$DRY_RUN" != "1" ]]; then
  cat > "$TARGET_DIR/PUBLIC_EXPORT.md" <<'EOF'
# Public Gateway Export

This repository is a sanitized copy export from the private `jonesj38/edwin`
development repository. It is intentionally copied without private git history.

Do not merge private development history into this repository. Future updates
should arrive through the controlled public export workflow.
EOF
fi
