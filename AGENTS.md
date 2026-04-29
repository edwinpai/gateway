# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Identity

You are Edwin, Jake's CTO. Sharp, competent, resourceful.

## Memory System: Shad

**Collection context is auto-injected** by the `shad-context` plugin on every session start.
You do NOT need to manually recall context for routine questions — it's already in your prompt
as `<collection-context>...</collection-context>`.

For **deep reasoning** that requires decomposition beyond a single context brief:

```bash
~/.shad/bin/shad run "your query here" --collection ~/clawd -O sonnet --no-code-mode -q
```

Quick context retrieval (bypass auto-injection): `shad context "query" --collection ~/clawd --json`

Search only (no synthesis): `shad search "query" --collection ~/clawd -m hybrid -l 5`

### Plugin Config

Set collection paths in your Edwin config (`extensions.shad-context`):

```json
{
  "collectionPaths": ["~/clawd"],
  "maxChars": 4000,
  "autoRecall": true,
  "autoCapture": true
}
```

Or via environment: `export SHAD_COLLECTION_PATH=~/clawd`

## Core Rules

- Write things down (files > mental notes)
- `trash` > `rm`
- Ask before external actions
- In group chats: participate, don't dominate

## Project Overview

Edwin is a personal AI assistant platform. It bridges AI models (Claude, GPT, Gemini) with communication channels (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams, Google Chat, Matrix, etc.) through a local Gateway control plane.

**Runtime:** Node.js ≥22.12.0
**Package Manager:** pnpm@10.23.0
**Language:** TypeScript 5.9
**Bundler:** tsdown
**Linter/Formatter:** oxlint, oxfmt

## Common Commands

```bash
# Development
pnpm install              # Install dependencies
pnpm build                # Full build (canvas, TS, scripts)
pnpm dev                  # Run with auto-reload
pnpm gateway:dev          # Gateway-only dev (skips channels)
pnpm gateway:watch        # Gateway with file watching

# Quality
pnpm check                # TypeScript + lint + format check
pnpm lint:fix             # Auto-fix lint issues
pnpm format:fix           # Auto-fix formatting

# Testing
pnpm test                 # Run unit tests (parallel)
pnpm test:watch           # Watch mode
pnpm test:e2e             # End-to-end tests
pnpm test:live            # Live API tests (requires credentials)
pnpm test:coverage        # With coverage report

# Run single test file
pnpm vitest run src/path/to/file.test.ts

# Run tests matching pattern
pnpm vitest run -t "pattern"

# CLI (dev mode, runs TS directly)
pnpm edwin <command>
```

## Architecture

### Core Layers

```
src/
├── cli/                  # CLI interface & entry points
├── commands/             # 50+ command implementations
├── gateway/              # WebSocket/HTTP control plane
│   ├── server.ts         # Server implementation
│   ├── server-http.ts    # HTTP routes
│   ├── openai-http.ts    # OpenAI-compatible API
│   ├── client.ts         # WebSocket client handling
│   └── protocol/         # Message protocol definitions
├── agents/               # AI agent system
│   ├── pi-embedded-*.ts  # Pi framework integration
│   └── pi-tools.ts       # Tool definitions
├── channels/             # Channel adapters
├── config/               # Configuration management
├── memory/               # Semantic search & context
├── skills/               # Agent skill system
└── auth/                 # Authentication
```

### Extensions & Apps

```
extensions/               # 33 channel plugins (Discord, Telegram, Matrix, etc.)
skills/                   # 55+ skill packs (GitHub, 1Password, Notion, etc.)
apps/
├── ios/                  # iOS app (Swift)
├── android/              # Android app (Kotlin)
├── macos/                # macOS menu bar app (Swift)
└── shared/               # Shared mobile code (EdwinKit)
ui/                       # Web UI (Lit components, separate build)
```

### Key Patterns

- **Dependency injection:** Functions receive `deps` parameter with dependencies
- **Plugin registry:** Channel/skill plugins discovered via registry pattern
- **Streaming:** NDJSON for agent events, soft-chunking for UI
- **Session management:** File-based JSON stores with write locks
- **Hot reloading:** Config changes reload without restart

## Test Configurations

| Config                        | Purpose                            |
| ----------------------------- | ---------------------------------- |
| `vitest.config.ts`            | Default unit tests                 |
| `vitest.unit.config.ts`       | Unit-only (no integration)         |
| `vitest.e2e.config.ts`        | End-to-end tests                   |
| `vitest.live.config.ts`       | Live API tests (needs credentials) |
| `vitest.gateway.config.ts`    | Gateway-specific tests             |
| `vitest.extensions.config.ts` | Channel extension tests            |

Tests are colocated with source (`*.test.ts`). E2E tests use `.e2e.test.ts` suffix.

## Native Apps

```bash
# iOS
pnpm ios:open             # Open Xcode project
pnpm ios:build            # Build for simulator
pnpm ios:run              # Build and run

# Android
pnpm android:assemble     # Build debug APK
pnpm android:install      # Install to device
pnpm android:run          # Install and launch

# macOS
pnpm mac:package          # Build .app bundle
pnpm mac:open             # Open built app
```

## Protocol Generation

The Gateway protocol schema is source-of-truth for native apps:

```bash
pnpm protocol:gen         # Generate JSON schema
pnpm protocol:gen:swift   # Generate Swift models
pnpm protocol:check       # Verify protocol is in sync
```

## Code Style Notes

- Lit 3.3 with legacy decorators for UI components
- Zod for runtime validation
- TypeBox for JSON schema generation
- oxlint with type-aware checks (slower but comprehensive)
