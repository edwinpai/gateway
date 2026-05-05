# EdwinPAI Gateway

NPM wrapper for installing and running the EdwinPAI gateway runtime.

The EdwinPAI gateway is distributed as a small CLI wrapper plus companion runtime packages:

- `@edwinpai/gateway-core`
- `@edwinpai/identity-core`
- `@edwinpai/shad-core`

## Install

Requires Node.js 22.12 or newer.

```bash
npm install -g @edwinpai/edwinpai@beta
edwinpai --version
```

## Brand-new user happy path

```bash
edwinpai setup
edwinpai onboard
edwinpai gateway start
edwinpai status
edwinpai agent --message "What can you do?"
```

For API-key auth, prefer EdwinPAI's service-safe env file so both the CLI and Gateway service can read it:

```bash
mkdir -p ~/.edwinpai
printf 'OPENAI_API_KEY=sk-...\n' >> ~/.edwinpai/.env
chmod 600 ~/.edwinpai/.env
edwinpai gateway restart
```

## Current beta

The current beta line is `1.0.0-beta.7`. The wrapper and companion runtime packages are versioned together so users see one coherent EdwinPAI system version.

## Installer script

The historical installer URL is:

```bash
curl -fsSL https://edwinpai.com/install.sh | bash
```

Use the npm beta install as the primary CTA until that URL is confirmed live for the current beta.

## Development

```bash
pnpm install --no-frozen-lockfile
pnpm build
npm pack --dry-run
```

## Documentation

Canonical docs: https://docs.edwinpai.com
