# EdwinPAI Beta Release Checklist

This checklist captures the public beta release bar Jake set on 2026-04-30: the first beta should make the core happy path feel flawless before deeper hardening work expands.

## Release bar

Beta is ready when a new user can install EdwinPAI, connect/use chat channels, see memory/context work, and use Tasks as a reliable execution system without confusing failures.

## Gates

### 1. Install and package surface

- [x] `@edwinpai/edwinpai@beta` installs from npm in a clean directory.
- [x] `npx edwinpai --version` reports `1.0.0-beta.3` after clean npm install.
- [x] Private/protected npm package metadata resolves for:
  - `@edwinpai/edwinpai@beta`
  - `@edwinpai/gateway-core@beta`
  - `@edwinpai/identity-core@beta`
  - `@edwinpai/shad-core@beta`
- [x] Core hosted push CI is green on the lean beta validation matrix.
- [x] Desktop hosted push CI is green on the lean Desktop validation matrix.
- [x] GitHub Actions are currently disabled intentionally while the remaining beta gate is tightened; continue with local/focused validation only until workflows are re-enabled.

### 2. UI surface

- [x] Desktop app is the sole supported UI surface for beta; the legacy browser Control UI source/assets/build scripts and gateway HTTP serving path were removed.

### 2. Chat and channels

- [x] Verify the primary web/desktop chat happy path against a running gateway (`chat.send` accepted `/status` with run id `beta-chat-status-20260502-1815`; `chat.history` returned the target session transcript).
- [x] Verify at least one external messaging channel happy path in the intended beta configuration (Matrix is configured and this live Jake↔Edwin conversation verified inbound/outbound Matrix delivery while beta checks were being updated).
- [x] Confirmed focused no-leak/heartbeat envelope coverage locally:
  - `src/auto-reply/envelope.test.ts`
  - `src/infra/heartbeat-runner.respects-ackmaxchars-heartbeat-acks.test.ts`
- [x] Confirmed focused Telegram send fallback/empty-input behavior locally:
  - `src/telegram/send.returns-undefined-empty-input.test.ts`

### 3. Memory and context

- [x] Verify session facts are persisted to disk where expected.
- [x] Verify `qmd update --collection workspace` succeeds after writes.
- [x] Verify relevant context can be retrieved from disk/search before later turns (`qmd search beta -c workspace -n 3 --files` and `qmd search "Actions disabled" -c workspace -n 5 --files`).
- [x] Confirmed focused QMD memory manager behavior locally:
  - `src/memory/qmd-manager.test.ts`
- [x] Verify no stale-context behavior appears in the happy path (`memory/beta-release-checklist-runtime-proof.md` marker was written, indexed, and retrieved with `qmd search "live memory retrieval beats stale context" -c workspace -n 5 --files`).

### 4. Tasks

“Tasks” means both the Desktop Tasks tab and the underlying task creation, queueing, selection, progress, auto-continue, blocked/needs-user, and execution system.

- [x] Core task queue/model/API tests pass:
  - `src/gateway/tasks.test.ts`
  - `src/agents/tools/task-state-tool.test.ts`
  - `src/commands/agent/session-store.test.ts`
- [x] Desktop Tasks tab focused tests pass:
  - `src/components/tasks/TasksPanel.test.tsx`
- [x] Manually verify the live gateway task queue used by the Desktop Tasks tab against a running gateway:
  - create a task (`sessions.tasks.create`, disposable session `agent:main:beta-release-checklist-live-task`)
  - select it as current (`sessions.tasks.select`)
  - mark criteria complete (`sessions.tasks.update` with completed criteria)
  - mark blocked / needs-user (`sessions.tasks.update` with blocked and needs-user states)
  - reorder tasks (`sessions.tasks.reorder`)
  - execute queued tasks (`sessions.tasks.execute`, disposable session `agent:main:beta-release-checklist-execute-smoke`)
  - confirm session list/task counts refresh correctly (`sessions.tasks.list` returned expected task counts/order/status).

### 5. Known non-blocking debt for beta gate

These should be tracked, but they are not currently allowed to burn push-CI minutes:

- Desktop full test suite has stale failures in four files:
  - `src/App.test.tsx`
  - `src/test/hooks/useIdentity.test.ts`
  - `src/components/channels/__tests__/ChannelList.test.tsx`
  - `src/components/settings/__tests__/GeneralSettings.test.tsx`
- Desktop Tauri build matrix runs on PR/manual release contexts, not every push.

## Current proof commands

```bash
# Core Tasks/task-system focused proof
pnpm exec vitest run \
  src/gateway/tasks.test.ts \
  src/agents/tools/task-state-tool.test.ts \
  src/commands/agent/session-store.test.ts

# Desktop Tasks tab focused proof
cd ../edwin-desktop
npm test -- src/components/tasks/TasksPanel.test.tsx

# Focused memory / heartbeat / channel-send proof
cd ../edwin
pnpm exec vitest run \
  src/auto-reply/envelope.test.ts \
  src/infra/heartbeat-runner.respects-ackmaxchars-heartbeat-acks.test.ts \
  src/memory/qmd-manager.test.ts \
  src/telegram/send.returns-undefined-empty-input.test.ts
```

## Manual runtime checks still required

Do these against a running local gateway/Desktop session before calling beta ready:

Completed locally on 2026-05-02 while GitHub Actions were disabled:

1. Gateway chat RPC accepted a primary chat send and history retrieval returned the target session transcript.
2. Matrix external channel was verified by this live Jake↔Edwin conversation during beta checklist work.
3. Live task queue APIs used by the Desktop Tasks tab were exercised against the running gateway with disposable beta-check sessions.
4. A small memory fact was written, `qmd update --collection workspace` was run, and focused `qmd search` retrieved the new marker.

### 6. Gateway status runtime check

- [x] `edwinpai gateway status --no-probe --json` returns promptly against the installed/running LaunchAgent environment.
- [x] `edwinpai gateway status --json` returns promptly and reports `rpc.ok=true` against the local gateway.
