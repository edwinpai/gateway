#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${1:-}"
if [[ -z "$WORK_DIR" ]]; then
  WORK_DIR="$(mktemp -d -t edwinpai-public-wrapper-smoke.XXXXXX)"
fi
PACK_DIR="$WORK_DIR/packs"
EXPORT_DIR="$WORK_DIR/export"
SMOKE_DIR="$WORK_DIR/smoke"

mkdir -p "$PACK_DIR" "$EXPORT_DIR"

pack_package() {
  local rel_dir="$1"
  local pkg_name="$2"
  printf 'packing %s...\n' "$pkg_name" >&2
  pnpm --dir "$ROOT/$rel_dir" build >/dev/null
  local packed
  packed="$(cd "$ROOT/$rel_dir" && npm pack --pack-destination "$PACK_DIR" --json | node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => { const parsed = JSON.parse(data); console.log(parsed[0].filename); });')"
  printf '%s\n' "$PACK_DIR/$packed"
}

IDENTITY_TGZ="$(pack_package packages/identity-core @edwinpai/identity-core)"
SHAD_TGZ="$(pack_package packages/shad-core @edwinpai/shad-core)"
GATEWAY_TGZ="$(pack_package packages/gateway-core @edwinpai/gateway-core)"

"$ROOT/scripts/export-public-repo.sh" --target-dir "$EXPORT_DIR" >/dev/null
"$ROOT/scripts/public-export-guard.sh" "$EXPORT_DIR"
node "$ROOT/scripts/public-package-manifest-check.mjs" "$EXPORT_DIR"

rm -rf "$SMOKE_DIR"
cp -R "$EXPORT_DIR" "$SMOKE_DIR"

node - "$SMOKE_DIR/package.json" "$IDENTITY_TGZ" "$SHAD_TGZ" "$GATEWAY_TGZ" <<'NODE'
const fs = require('node:fs');
const [packagePath, identityTgz, shadTgz, gatewayTgz] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.pnpm = pkg.pnpm && typeof pkg.pnpm === 'object' ? pkg.pnpm : {};
pkg.pnpm.overrides = {
  ...(pkg.pnpm.overrides ?? {}),
  '@edwinpai/identity-core': `file:${identityTgz}`,
  '@edwinpai/shad-core': `file:${shadTgz}`,
  '@edwinpai/gateway-core': `file:${gatewayTgz}`,
};
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
NODE

(
  cd "$SMOKE_DIR"
  pnpm install --no-frozen-lockfile
  pnpm build
  node -e "const core = await import('@edwinpai/gateway-core'); if (typeof core.runCli !== 'function') throw new Error('gateway-core runCli export missing');"
  node edwinpai.mjs --help >/dev/null
  npm pack --dry-run >/dev/null
)

printf 'public wrapper local smoke passed: %s\n' "$SMOKE_DIR"
