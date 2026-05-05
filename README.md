# EdwinPAI Gateway

Public npm wrapper for the EdwinPAI gateway runtime.

This repository is intentionally small: it contains the public package wrapper, release workflow, and guard scripts needed to publish `@edwinpai/edwinpai`. The compiled gateway implementation is distributed through the companion runtime packages:

- `@edwinpai/gateway-core`
- `@edwinpai/identity-core`
- `@edwinpai/shad-core`

## Install

```bash
npm install -g @edwinpai/edwinpai@beta
edwinpai --help
```

Requires Node.js 22.12 or newer.

## Current beta

The current public beta line is `1.0.0-beta.7`. The wrapper and companion runtime packages are versioned together so users see one coherent EdwinPAI system version.

## Development

```bash
pnpm install --no-frozen-lockfile
pnpm build
npm pack --dry-run
```

## Repository scope

This is not the private EdwinPAI development monorepo and it should not contain unrelated apps, docs sites, experiments, private source packages, generated session data, or legacy OpenClaw/Clawd branding.

Canonical docs: https://docs.edwinpai.com
