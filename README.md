# EdwinPAI Gateway

NPM wrapper for installing and running the EdwinPAI gateway runtime.

The EdwinPAI gateway is distributed as a small CLI wrapper plus companion runtime packages:

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

The current beta line is `1.0.0-beta.7`. The wrapper and companion runtime packages are versioned together so users see one coherent EdwinPAI system version.

## Development

```bash
pnpm install --no-frozen-lockfile
pnpm build
npm pack --dry-run
```

## Documentation

Canonical docs: https://docs.edwinpai.com
