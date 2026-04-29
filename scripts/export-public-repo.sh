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
  --exclude '/packages/'
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
  node - "$TARGET_DIR/package.json" <<'NODE'
const fs = require("node:fs");
const packagePath = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
pkg.private = false;
pkg.publishConfig = {
  access: "restricted",
  tag: "beta",
};
pkg.bin = { edwinpai: "edwinpai.mjs" };
pkg.exports = {
  ".": "./dist/index.js",
  "./cli-entry": "./edwinpai.mjs",
};
pkg.files = ["dist/", "edwinpai.mjs", "LICENSE", "README.md", "README-header.png"];
pkg.scripts = {
  build: "tsdown",
  prepack: "pnpm build",
};
pkg.dependencies = {
  "@edwinpai/gateway-core": "1.0.0-beta.2",
  "@edwinpai/identity-core": "1.0.0-beta.2",
  "@edwinpai/shad-core": "1.0.0-beta.2",
};
delete pkg.peerDependencies;
delete pkg.peerDependenciesMeta;
pkg.devDependencies = {
  "@types/node": "^25.2.0",
  tsdown: "^0.20.1",
  tsx: "^4.21.0",
  typescript: "^5.9.3",
};
for (const section of ["dependencies", "devDependencies"]) {
  if (pkg[section]) {
    pkg[section] = Object.fromEntries(Object.entries(pkg[section]).sort(([a], [b]) => a.localeCompare(b)));
  }
}
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}
`);
NODE

  cat > "$TARGET_DIR/tsdown.config.ts" <<'EOF'
import { defineConfig } from "tsdown";

const env = {
  NODE_ENV: "production",
};

export default defineConfig([
  {
    entry: "src/index.ts",
    env,
    fixedExtension: false,
    platform: "node",
  },
  {
    entry: "src/entry.ts",
    env,
    fixedExtension: false,
    platform: "node",
  },
]);
EOF

  mkdir -p "$TARGET_DIR/src"
  cat > "$TARGET_DIR/src/index.ts" <<'EOF'
export const EDWINPAI_PUBLIC_WRAPPER_VERSION = "1.0.0-beta.2";
export const EDWINPAI_GATEWAY_CORE_PACKAGE = "@edwinpai/gateway-core";

export async function loadGatewayCore(): Promise<unknown> {
  const packageName = process.env.EDWINPAI_GATEWAY_CORE_PACKAGE ?? EDWINPAI_GATEWAY_CORE_PACKAGE;
  return import(packageName);
}
EOF

  cat > "$TARGET_DIR/src/entry.ts" <<'EOF'
#!/usr/bin/env node
import process from "node:process";
import { loadGatewayCore, EDWINPAI_GATEWAY_CORE_PACKAGE } from "./index.js";

async function main() {
  const runtime = await loadGatewayCore().catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `EdwinPAI protected gateway runtime is not installed. Expected compiled runtime package ${EDWINPAI_GATEWAY_CORE_PACKAGE}. ` +
        `Publish/install the protected runtime package before using this public wrapper. ${detail}`,
    );
  });
  const maybeRunCli = (runtime as { runCli?: (argv: string[]) => unknown }).runCli;
  if (typeof maybeRunCli !== "function") {
    throw new Error(`Protected gateway runtime package ${EDWINPAI_GATEWAY_CORE_PACKAGE} does not export runCli(argv).`);
  }
  await maybeRunCli(process.argv);
}

main().catch((error) => {
  console.error("[edwinpai]", error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
EOF

  mkdir -p "$TARGET_DIR/src/config" "$TARGET_DIR/src/agents/pi-embedded-runner"
  cat > "$TARGET_DIR/src/config/types.ts" <<'EOF'
// Public export type shim.
// Protected memory/config internals are intentionally excluded from this repo.
export type EdwinPAIConfig = Record<string, unknown>;
export type ConfigFileSnapshot = Record<string, unknown>;
export type ConfigValidationIssue = Record<string, unknown>;
export type LegacyConfigIssue = Record<string, unknown>;
export type DmPolicy = Record<string, unknown>;
export type DmConfig = Record<string, unknown>;
export type GroupPolicy = Record<string, unknown>;
export type GroupToolPolicyConfig = Record<string, unknown>;
export type GroupToolPolicyBySenderConfig = Record<string, unknown>;
export type MarkdownConfig = Record<string, unknown>;
export type MarkdownTableMode = string;
export type ReplyToMode = string;
export type TelegramAccountConfig = Record<string, unknown>;
export type TelegramGroupConfig = Record<string, unknown>;
export type TelegramTopicConfig = Record<string, unknown>;
export type WhatsAppConfig = Record<string, unknown>;
export type DiscordConfig = Record<string, unknown>;
EOF

  cat > "$TARGET_DIR/src/agents/pi-embedded-runner/system-prompt.ts" <<'EOF'
// Public export runtime shim.
// Full prompt/memory composition internals are protected and excluded from this repo.
export function buildEmbeddedSystemPrompt(params: { extraSystemPrompt?: string } = {}): string {
  return params.extraSystemPrompt?.trim() ?? "";
}

export function createSystemPromptOverride(systemPrompt: string): (defaultPrompt?: string) => string {
  const override = systemPrompt.trim();
  return (_defaultPrompt?: string) => override;
}

export function applySystemPromptOverrideToSession(
  session: { agent?: { state?: { systemPrompt?: string } }; _baseSystemPrompt?: string; _rebuildSystemPrompt?: () => string },
  override: string | ((defaultPrompt?: string) => string),
) {
  const prompt = typeof override === "function" ? override() : override.trim();
  if (session.agent?.state) {
    session.agent.state.systemPrompt = prompt;
  }
  session._baseSystemPrompt = prompt;
  session._rebuildSystemPrompt = () => prompt;
}
EOF

  mkdir -p "$TARGET_DIR/.github/workflows"
  cat > "$TARGET_DIR/.github/workflows/npm-publish.yml" <<'EOF'
name: Publish @edwinpai/edwinpai

on:
  workflow_dispatch:
    inputs:
      dry_run:
        description: "Build and pack without publishing"
        type: boolean
        default: true

permissions:
  contents: read

jobs:
  publish-root:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          registry-url: "https://registry.npmjs.org"

      - uses: pnpm/action-setup@v4

      - name: Guard protected source boundaries
        run: |
          chmod +x scripts/public-export-guard.sh scripts/public-package-manifest-check.mjs
          scripts/public-export-guard.sh .

      - name: Check public package manifest
        run: |
          node scripts/public-package-manifest-check.mjs .

      - name: Install dependencies
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: pnpm install --frozen-lockfile

      - name: Build sanitized gateway package
        run: pnpm build

      - name: Preview npm package contents
        run: npm pack --dry-run

      - name: Publish @edwinpai/edwinpai
        if: ${{ !inputs.dry_run }}
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: npm publish --access restricted --tag beta
EOF

  cat > "$TARGET_DIR/PUBLIC_EXPORT.md" <<'EOF'
# Public Gateway Export

This repository is a sanitized copy export from the private `jonesj38/edwin`
development repository. It is intentionally copied without private git history.

Do not merge private development history into this repository. Future updates
should arrive through the controlled public export workflow.
EOF
fi
