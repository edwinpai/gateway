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
