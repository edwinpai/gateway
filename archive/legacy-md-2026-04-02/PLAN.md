# Edwin Desktop — Phased Development Roadmap

**Version:** 0.2.0-draft
**Date:** 2026-02-09
**Companion doc:** [SPEC.md](./SPEC.md)

---

## Executive Summary

Edwin Desktop is a cross-platform Tauri v2 application that wraps the Edwin AI agent gateway in a native desktop shell with BSV-based cryptographic identity, UTXO subscription verification, and multi-channel messaging integrations. The core architectural invariant is **domain isolation**: the AI reasoning engine never touches private keys, and all signing operations flow through a separate, audited crypto sidecar process.

Development is organized into four sequential phases, each producing a usable, testable artifact. Security architecture is front-loaded in Phase 1 — not deferred to a hardening pass — because the signing daemon and IPC boundary are prerequisites for every feature that follows. The blockchain layer (subscriptions, SPV) is deferred to Phase 2 to avoid blocking the core user experience. Channel integrations (Phase 3) and the final security audit (Phase 4) build on top.

**Target:** Signed, auto-updating installers for macOS, Windows, and Linux with all six channel integrations and SPV-verified subscriptions.

---

## Phase Definitions

### Phase 1 — Core Shell + Identity

**Goal:** A Tauri v2 app that builds on all platforms, with a working signing daemon, OS keychain integration, BSV identity (petname + avatar), and the gateway running as a sidecar. The user can install, onboard, and chat — with every request cryptographically signed.

**Subphases:**

| Sub | Name                      | Description                                                                                                                                                                                                        |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1a  | Foundation & Scaffolding  | Tauri v2 + React + TypeScript project; Tailwind/shadcn; build targets; CI; system tray; dev workflow                                                                                                               |
| 1b  | Security Architecture     | Crypto domain as Node.js sidecar; OS keychain read/write; IPC transport (Unix socket / named pipe); typed IPC API (`sign`, `get-identity`, `verify-subscription`, `derive-shared-key`); audit log; isolation tests |
| 1c  | BSV Identity & Onboarding | First-run keypair generation; petname + avatar derivation; mode selection (Gateway vs Client); onboarding wizards; auto-signing middleware                                                                         |
| 1d  | Gateway Integration       | Edwin gateway as Node.js sidecar; sidecar lifecycle; health monitoring; chat UI (streaming SSE); settings panel; gateway config editor; log viewer                                                                 |

**Exit criteria:**

- Tauri app builds .dmg / .msi / .deb + .AppImage
- Signing daemon loads key from OS keychain, signs over IPC, logs to audit JSONL
- Integration test proves AI domain cannot reach keychain or signing socket
- User completes onboarding, sees petname + avatar, sends a chat message with BRC-103 signed request
- Gateway sidecar starts/stops/restarts cleanly; system tray shows health

### Phase 2 — Subscriptions + SPV

**Goal:** UTXO-based subscription verification via lightweight SPV Merkle proofs. The user sees "Active" or "Expired" — never hex, UTXOs, or blockchain terminology.

**Tasks:**

| #   | Task                                                                                            |
| --- | ----------------------------------------------------------------------------------------------- |
| 1   | BRC-42 key derivation: user + OCI shared key for subscription UTXO                              |
| 2   | Subscription payment flow: create transaction, broadcast, confirm                               |
| 3   | SPV verification engine: fetch Merkle proof (BRC-62), verify against block header               |
| 4   | UTXO unspent check: WhatsOnChain API (primary), direct peer (fallback)                          |
| 5   | Offline grace period: 0–24h full, 24–72h warning, 72h+ degraded                                 |
| 6   | Cached proof storage: `~/.edwin/subscription/proof.json`                                        |
| 7   | Subscription status UI: badge ("Active", "Verifying…", "Expired")                               |
| 8   | Daily re-verification: background task checks UTXO status                                       |
| 9   | Cancellation flow: mutual spend or time-locked unilateral (GUI confirmation required)           |
| 10  | **Critical guard:** AI domain cannot initiate UTXO spending — Crypto domain only, GUI-confirmed |

**Exit criteria:**

- User pays for subscription; UTXO created on-chain
- App verifies subscription daily via SPV without a full node
- Subscription badge shows correct state
- Offline grace period degrades gracefully
- AI domain provably cannot spend UTXOs

### Phase 3 — Channel Integrations

**Goal:** All six messaging channels (WhatsApp, Telegram, Matrix, Discord, Slack, Signal) have guided setup wizards and live status dashboards.

**Tasks:**

| #   | Task                                                                                 |
| --- | ------------------------------------------------------------------------------------ |
| 1   | Channel wizard framework: shared 4-step UI (select → auth → configure → test)        |
| 2   | WhatsApp wizard: QR code scanner, session storage                                    |
| 3   | Telegram wizard: bot token input, @BotFather link, test message                      |
| 4   | Matrix wizard: homeserver URL, login form, room picker + auto-reply toggles          |
| 5   | Discord wizard: OAuth2 / bot token paste, server/channel picker                      |
| 6   | Slack wizard: OAuth2 install button, workspace scoping, channel selection            |
| 7   | Signal wizard: QR code pairing (linked device protocol)                              |
| 8   | Channel status dashboard: real-time connection indicators, message counts            |
| 9   | Hot-reload: wizard writes config → signals gateway sidecar to reload without restart |
| 10  | Per-channel settings: allowed users, auto-reply toggle, custom prompts               |

**Exit criteria:**

- Each wizard completes end-to-end: auth → config → test message round-trip
- Dashboard shows live connection status for all configured channels
- Hot-reload works without gateway restart
- Per-channel settings persist across app restarts

### Phase 4 — Security Hardening + Audit

**Goal:** Production-ready installers, code signing, auto-updates, and a formal security audit of the IPC boundary, keychain access, and signing daemon.

**Tasks:**

| #   | Task                                                                                       |
| --- | ------------------------------------------------------------------------------------------ |
| 1   | Code signing: Apple Developer ID (macOS), Authenticode (Windows), GPG (Linux)              |
| 2   | Auto-update: Tauri updater plugin with OCI-hosted update server                            |
| 3   | Crash reporting: structured error capture (Sentry or self-hosted)                          |
| 4   | Performance targets: startup < 3s, idle memory < 200MB                                     |
| 5   | Accessibility: keyboard navigation, screen reader labels, high contrast                    |
| 6   | Dark/light mode: system preference detection + manual toggle                               |
| 7   | **Security audit:** penetration test of IPC boundary, keychain access, signing daemon      |
| 8   | Documentation: in-app help pages                                                           |
| 9   | Installer testing matrix: macOS (Intel + Apple Silicon), Windows 10/11, Ubuntu/Fedora/Arch |

**Exit criteria:**

- Signed installers for all three platforms
- Auto-update works end-to-end
- Security audit report with all critical/high findings resolved
- Accessibility pass complete
- Installer verified on all target OS variants

---

## Per-Phase Milestones

```
Phase 1 ─┬─ M1.1  Tauri app builds on all 3 platforms ("Hello Edwin" window)
          ├─ M1.2  Signing daemon passes isolation test
          ├─ M1.3  Onboarding wizard complete (identity + petname + avatar)
          └─ M1.4  Chat works end-to-end with BRC-103 signed requests

Phase 2 ─┬─ M2.1  BRC-42 shared key derivation working
          ├─ M2.2  Subscription payment creates on-chain UTXO
          ├─ M2.3  SPV verification (BRC-62 proof) validates subscription
          └─ M2.4  Offline grace period tested (24h / 72h boundaries)

Phase 3 ─┬─ M3.1  Wizard framework renders all 4 steps
          ├─ M3.2  First channel (Telegram) wizard end-to-end
          ├─ M3.3  All 6 channels configured and tested
          └─ M3.4  Dashboard shows live status + hot-reload works

Phase 4 ─┬─ M4.1  Code-signed installers for all platforms
          ├─ M4.2  Auto-update round-trip verified
          ├─ M4.3  Security audit report delivered
          └─ M4.4  Installer matrix fully tested — ready for distribution
```

---

## Dependency Graph

```
Phase 1a (Scaffolding)
   │
   ▼
Phase 1b (Crypto Domain) ◄─── SECURITY GATE: must pass before any key material flows
   │
   ├──────────────────────┐
   ▼                      │
Phase 1c (Identity)       │
   │                      │
   ▼                      ▼
Phase 1d (Gateway)    Phase 2 (Subscriptions + SPV)
   │                      │
   ▼                      │ (requires gateway for enforcement)
Phase 3 (Channels) ◄──────┘
   │
   ▼
Phase 4 (Security Hardening + Audit)
```

**Key constraints:**

- Phase 1b (Crypto Domain) is the **hard gate**. Nothing that touches key material can proceed without it.
- Phase 2 can begin its crypto-layer work (BRC-42 derivation, SPV engine) in parallel with Phases 1c/1d, but subscription enforcement requires the gateway (Phase 1d).
- Phase 3 depends on Phase 1d (gateway must be running for channels to connect).
- Phase 4 depends on everything — it's the final integration and hardening pass.

---

## Risk Register

| ID  | Risk                                                          | Likelihood | Impact | Mitigation                                                                                                  |
| --- | ------------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| R1  | Tauri v2 sidecar IPC flaky on Windows                         | Medium     | High   | Prototype sidecar communication in Phase 1a; fallback to embedded Node via WASM                             |
| R2  | OS keychain access denied (Linux headless)                    | Medium     | Medium | Fallback to encrypted file with passphrase (libsodium sealed box)                                           |
| R3  | WhatsApp Web protocol breaks                                  | High       | Medium | WhatsApp is the most fragile channel; design wizard to be easily disabled; deprioritize vs. stable channels |
| R4  | SPV verification fails (no peers available)                   | Low        | Medium | Multiple fallback providers (WhatsOnChain, mirror, direct peer); cached proof grace period                  |
| R5  | Body-not-in-signature bug exploited before fix                | Low        | High   | Fix in Phase 1b before any production deployment; add integration test                                      |
| R6  | Apple/Windows code signing costs and lead time                | Medium     | Low    | Budget for certs early; distribute unsigned during beta                                                     |
| R7  | Signal linked device protocol undocumented/breaks             | High       | Low    | Deprioritize Signal if fragile; keep wizard but mark as experimental                                        |
| R8  | Tauri Stronghold vs keytar: neither works well cross-platform | Medium     | High   | Prototype both in Phase 1b; if both fail, use libsodium sealed box with OS-level file permissions           |
| R9  | Subscription pricing model undecided                          | Medium     | Medium | Design UTXO structure to support flat, per-query, and tiered models; decide before Phase 2 implementation   |

---

## Open Questions

1. **Subscription pricing model** — flat fee per month? Per-query? Tiered? (Affects UTXO structure in Phase 2)
2. **OCI's public key distribution** — hardcoded in app binary? Fetched from well-known URL? Both?
3. **Client mode authorization levels** — what can a non-owner client do? Read-only? Limited queries?
4. **Tauri Stronghold vs keytar** — Stronghold is Rust-native but less mature on Linux; keytar is Node-native and battle-tested. Need to prototype both in Phase 1b.
5. **Signal integration feasibility** — undocumented protocol, may break. Deprioritize if fragile.
