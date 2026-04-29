# Edwin Desktop — Technical Specification

**Version:** 0.2.0-draft
**Date:** 2026-02-09
**Author:** Edwin Desktop Instance + Jake (OCI)
**Companion doc:** [PLAN.md](./PLAN.md)

---

## 1. Architecture Overview

### 1.1 System Context

Edwin Desktop is a native desktop application (Tauri v2) that operates in one of two modes:

- **Gateway Mode:** Runs a local Edwin AI agent gateway as a sidecar, with full channel integrations and local AI reasoning.
- **Client Mode:** Thin client connecting over HTTPS to a remote Edwin gateway, authenticating via BRC-103 signed requests.

In both modes, a separate **Crypto Domain** sidecar handles all private key operations. The AI Domain and Crypto Domain communicate exclusively through a typed IPC channel — private key material never crosses this boundary.

### 1.2 System Context Diagram

```
                        ┌──────────────────────────┐
                        │     External Services     │
                        │                           │
                        │  WhatsApp  Telegram       │
                        │  Matrix    Discord        │
                        │  Slack     Signal         │
                        │  LLM APIs (Anthropic etc) │
                        │  WhatsOnChain (SPV)       │
                        └─────────┬────────────────┘
                                  │ HTTPS
                                  ▼
┌─────────────────────────────────────────────────────────────┐
│                     Edwin Desktop (Tauri v2)                 │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │               React UI (WebView)                      │  │
│  │   shadcn/ui + Tailwind CSS 4 + Zustand state          │  │
│  └────────────────────┬──────────────────────────────────┘  │
│                       │ Tauri IPC (invoke / events)         │
│  ┌────────────────────┴──────────────────────────────────┐  │
│  │               Rust Backend (Tauri core)                │  │
│  │   Window mgmt · System tray · IPC routing              │  │
│  │   Sidecar lifecycle · Auto-update · Notifications      │  │
│  └──────┬──────────────────────────────┬─────────────────┘  │
│         │                              │                    │
│  ┌──────┴──────────┐   ┌──────────────┴───────────────┐    │
│  │   AI Domain     │   │      Crypto Domain            │    │
│  │   (Node.js      │   │      (Node.js sidecar)        │    │
│  │    sidecar)     │   │                               │    │
│  │                 │◄──┤   Unix socket / named pipe     │    │
│  │  Gateway server │   │                               │    │
│  │  LLM reasoning  │   │   Keychain ←→ Private key     │    │
│  │  Channel I/O    │   │   Signing · Verification      │    │
│  │  Tool execution │   │   Key derivation · Audit log  │    │
│  └─────────────────┘   └───────────────────────────────┘    │
│                                     │                       │
│                          ┌──────────┴──────────┐            │
│                          │  OS Keychain         │            │
│                          │  macOS: Keychain     │            │
│                          │  Windows: DPAPI      │            │
│                          │  Linux: libsecret    │            │
│                          └─────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 Technology Stack

| Layer             | Technology                                            |
| ----------------- | ----------------------------------------------------- |
| Native shell      | Tauri v2 (Rust backend, WebView frontend)             |
| Frontend          | React 18+ with TypeScript                             |
| UI components     | shadcn/ui + Tailwind CSS 4                            |
| Build targets     | macOS (.dmg), Windows (.msi), Linux (.deb, .AppImage) |
| State management  | Zustand                                               |
| BSV crypto        | `@bsv/sdk`                                            |
| Avatar generation | `jdenticon`                                           |

---

## 2. Component Catalog

### 2.1 Tauri Shell

The Rust-native host process. Responsibilities:

- Window management (main window, system tray, dialogs)
- System tray with status indicator (green/yellow/red) and menu (Open, Status, Channels, Settings, Quit)
- Sidecar process lifecycle: spawn, monitor, restart on crash, graceful shutdown
- IPC routing between React UI and sidecars via Tauri's `invoke` / `event` API
- Auto-update via `tauri-plugin-updater`
- Native notifications via `tauri-plugin-notification`
- Configurable auto-start on OS boot

### 2.2 React UI

WebView-rendered frontend. Key screens:

- **Onboarding wizard** — mode selection, identity creation, subscription (optional), channels (optional)
- **Chat interface** — message list, input box, streaming SSE responses
- **Channel dashboard** — real-time status per channel, message counts, quick actions
- **Settings panel** — model selection, system prompt, temperature, gateway config editor
- **Subscription badge** — "Active" / "Verifying…" / "Expired"
- **Log viewer** — collapsible panel tailing gateway logs

**UI toolkit:** shadcn/ui components — Card, Button, Input, Dialog, Progress, Avatar, Badge, Tabs, Select, Switch, Accordion.

### 2.3 BSV Identity Module

Runs inside the Crypto Domain sidecar. Responsibilities:

- Keypair generation: `PrivateKey.fromRandom()` via `@bsv/sdk`
- OS keychain storage: service `com.onchaininnovation.edwin`, account `owner-identity`, secret = private key hex (64 chars)
- Petname derivation: SHA-256 of compressed pubkey → adjective-noun from wordlists
- Avatar: identicon from pubkey hash (`jdenticon` or custom SVG)
- Never exposes private key outside this module — only public key, petname, and avatar cross the IPC boundary

### 2.4 Subscription Engine

Runs inside the Crypto Domain sidecar. Responsibilities:

- BRC-42 shared key derivation (user + OCI) for subscription UTXOs
- Subscription payment flow: create transaction → broadcast → confirm
- SPV verification: fetch BRC-62 Merkle proof → verify against block header → confirm UTXO unspent
- Cached proof storage at `~/.edwin/subscription/proof.json`
- Daily re-verification background task
- Offline grace period enforcement (0–24h full, 24–72h warning, 72h+ degraded)
- Cancellation: mutual spend or time-locked unilateral (requires GUI confirmation)
- **Invariant:** AI domain cannot initiate UTXO spending

### 2.5 Channel Adapters

Run inside the AI Domain sidecar (gateway). Each adapter:

- Implements a common interface: `connect()`, `disconnect()`, `sendMessage()`, `onMessage()`
- Handles channel-specific auth (QR scan, bot token, OAuth2, device pairing)
- Writes channel config to `~/.edwin/edwin.json` under `channels.<name>`
- Supports hot-reload: config change signals gateway to reload without full restart

Supported adapters: WhatsApp, Telegram, Matrix, Discord, Slack, Signal.

### 2.6 Signing Daemon

The core of the Crypto Domain sidecar:

- **Startup:** Reads private key from OS keychain into memory
- **Runtime:** Listens on Unix domain socket (Linux/macOS) or named pipe (Windows); accepts only the typed IPC API commands
- **Shutdown:** Zeroes key material in memory before exit
- **Crash recovery:** Tauri restarts sidecar automatically
- **Network isolation:** No network access except the IPC socket; unreachable from outside the machine
- **Audit:** Logs every operation (sign, verify, derive) to append-only JSONL

---

## 3. Data Models

### 3.1 Identity Record

```typescript
/** Stored in ~/.edwin/edwin.json (public fields only) */
interface IdentityRecord {
  publicKey: string; // compressed hex, 33 bytes (e.g., "0324b7...")
  petname: string; // deterministic adjective-noun (e.g., "swift-falcon")
  avatarSeed: string; // = publicKey; used by jdenticon to render avatar
  createdAt: number; // unix ms, time of first keypair generation
}

/** Private key storage — OS keychain only, never written to disk */
// Service: "com.onchaininnovation.edwin"
// Account: "owner-identity"
// Secret:  private key hex (64 chars)
```

### 3.2 Subscription UTXO

```typescript
interface SubscriptionUTXO {
  txid: string; // transaction ID on BSV blockchain
  outputIndex: number; // vout
  satoshis: number; // locked value
  derivedPublicKey: string; // BRC-42 derived key locking the UTXO
  protocolID: [number, string]; // [2, "edwin-subscription"]
  keyID: string; // e.g., "sub-2026-02"
  counterpartyPubKey: string; // OCI's public key
  createdAt: number; // unix ms
}

interface SubscriptionStatus {
  valid: boolean;
  txid: string;
  proof: MerkleProof; // BRC-62 format (see §6.1)
  lastVerified: number; // unix ms
  expiresAt: number; // unix ms (grace period end)
}

interface MerkleProof {
  // BRC-62
  txid: string;
  rawTx: Uint8Array;
  merklePath: Array<{ hash: string; offset: "left" | "right" }>;
  blockHeader: Uint8Array; // 80 bytes
  blockHeight: number;
}
```

### 3.3 Channel Config

```typescript
interface ChannelConfig {
  enabled: boolean;
  autoReply: boolean;
  allowedUsers: string[]; // empty = allow all
  customPrompt?: string; // per-channel system prompt override
}

interface WhatsAppConfig extends ChannelConfig {
  session: object; // WhatsApp Web session data (opaque)
}

interface TelegramConfig extends ChannelConfig {
  botToken: string;
}

interface MatrixConfig extends ChannelConfig {
  homeserver: string; // e.g., "https://matrix.org"
  accessToken: string;
  rooms: Array<{
    roomId: string;
    autoReply: boolean;
  }>;
}

interface DiscordConfig extends ChannelConfig {
  botToken: string;
  guilds: Array<{
    guildId: string;
    channelIds: string[];
  }>;
}

interface SlackConfig extends ChannelConfig {
  botToken: string;
  signingSecret: string;
  channels: string[]; // channel IDs
}

interface SignalConfig extends ChannelConfig {
  deviceLink: object; // Signal linked device session (opaque)
}
```

### 3.4 Audit Log Entry

```typescript
/** Appended to ~/.edwin/audit/crypto.jsonl (one JSON object per line) */
interface AuditLogEntry {
  ts: number; // unix ms
  op: "sign" | "verify-sub" | "derive-key" | "get-identity";
  // Fields vary by operation:
  path?: string; // for sign: HTTP request path
  nonce?: string; // for sign: request nonce
  identity?: string; // compressed pubkey
  txid?: string; // for verify-sub
  result?: "valid" | "invalid" | "error";
  protocol?: string; // for derive-key
  keyID?: string; // for derive-key
  error?: string; // if operation failed
}
```

**Retention:** Rotated daily, retained 30 days. AI domain has read-only access (for user queries about signing history). AI domain cannot write to or delete audit logs.

---

## 4. IPC API

Command definitions for communication between the AI Domain and Crypto Domain. All messages are JSON over Unix domain socket (Linux/macOS) or named pipe (Windows).

### 4.1 AI Domain → Crypto Domain (Requests)

```typescript
/** Sign an outbound HTTP request per BRC-103 */
interface SignRequest {
  type: "sign";
  method: string; // HTTP method (GET, POST, etc.)
  path: string; // request path
  bodyHash: string; // SHA-256 hex of request body (empty string hash if no body)
  timestamp: number; // unix ms
  nonce: string; // random 32-byte hex
}

/** Verify a subscription UTXO is still valid */
interface VerifySubscriptionRequest {
  type: "verify-subscription";
  txid: string;
}

/** Get the user's public identity (never private key) */
interface GetIdentityRequest {
  type: "get-identity";
}

/** Derive a shared key with a counterparty per BRC-42 */
interface DeriveSharedKeyRequest {
  type: "derive-shared-key";
  counterpartyPubKey: string;
  protocolID: [number, string]; // e.g., [2, "edwin-subscription"]
  keyID: string; // e.g., "sub-2026-02"
}
```

### 4.2 Crypto Domain → AI Domain (Responses)

```typescript
interface SignResponse {
  type: "sign-result";
  signature: string; // DER-encoded ECDSA
  identityKey: string; // compressed pubkey hex
  timestamp: number;
  nonce: string;
}

interface VerifySubscriptionResponse {
  type: "verify-subscription-result";
  valid: boolean;
  proof?: MerkleProof;
  expiresAt?: number; // unix ms (grace period end)
}

interface GetIdentityResponse {
  type: "get-identity-result";
  publicKey: string; // compressed hex
  petname: string;
}

interface DeriveSharedKeyResponse {
  type: "derive-shared-key-result";
  derivedPublicKey: string; // the derived public key (never the private counterpart)
}

interface ErrorResponse {
  type: "error";
  requestType: string; // which request failed
  message: string;
  code: string; // e.g., 'KEYCHAIN_LOCKED', 'INVALID_TXID', 'DERIVATION_FAILED'
}
```

### 4.3 Invariants

- The **private key NEVER crosses** the IPC boundary. Only public keys, signatures, and derived public keys are returned.
- All IPC requests are logged to the audit log before processing.
- The Crypto Domain rejects any message type not in the contract above.
- The IPC socket/pipe has filesystem permissions restricting access to the Tauri host process UID.

---

## 5. Security Model

### 5.1 Domain Isolation Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                      Tauri Rust Host                             │
│                                                                 │
│  ┌──────────────────────────┐  ┌──────────────────────────────┐ │
│  │      AI Domain            │  │      Crypto Domain           │ │
│  │      (Node.js sidecar)    │  │      (Node.js sidecar)       │ │
│  │                           │  │                              │ │
│  │  CAN:                     │  │  CAN:                        │ │
│  │  · LLM reasoning          │  │  · Read private key from     │ │
│  │  · Tool execution         │  │    OS keychain               │ │
│  │  · Channel I/O            │  │  · Sign payloads             │ │
│  │  · Sandboxed file access  │  │  · Verify subscriptions      │ │
│  │  · Read audit log (R/O)   │  │  · Derive keys (BRC-42)      │ │
│  │                           │  │  · Write audit log           │ │
│  │  CANNOT:                  │  │                              │ │
│  │  · Read private keys      │  │  CANNOT:                     │ │
│  │  · Sign transactions      │  │  · Execute AI tools          │ │
│  │  · Derive keys            │  │  · Access channels           │ │
│  │  · Spend UTXOs            │  │  · Read user files           │ │
│  │  · Write audit log        │  │  · Make LLM calls            │ │
│  └──────────┬───────────────┘  └──────────┬───────────────────┘ │
│             │         IPC (typed, narrow)  │                     │
│             └──────────────┬──────────────┘                     │
│                            │                                    │
│                  ┌─────────┴─────────┐                          │
│                  │   IPC API Layer   │                          │
│                  │  Unix socket /    │                          │
│                  │  named pipe       │                          │
│                  └───────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Signing Daemon Protocol

1. **Startup sequence:**
   - Tauri spawns Crypto Domain sidecar
   - Sidecar reads private key from OS keychain (`com.onchaininnovation.edwin` / `owner-identity`)
   - Key held in memory only; never written to a file or env var
   - Sidecar creates IPC socket with restrictive permissions (owner-only: `0600`)
   - Sidecar sends `ready` event to Tauri host

2. **Request handling:**
   - Each incoming IPC message is validated against the type contract (§4)
   - Unknown message types are rejected and logged
   - Each valid request is audit-logged before processing
   - Response is sent back over the same socket connection

3. **Shutdown sequence:**
   - On SIGTERM or Tauri shutdown signal: zero private key buffer
   - Close IPC socket
   - Flush and close audit log
   - Exit

4. **Crash recovery:**
   - Tauri detects sidecar exit and restarts automatically
   - On restart, sidecar re-reads key from keychain
   - In-flight requests from AI Domain receive a timeout error

### 5.3 Keychain Access

| OS      | Backend                             | Notes                                                                |
| ------- | ----------------------------------- | -------------------------------------------------------------------- |
| macOS   | Keychain Services                   | Accessed via `tauri-plugin-stronghold` or `keytar`                   |
| Windows | Windows Credential Store (DPAPI)    | Accessed via `tauri-plugin-stronghold` or `keytar`                   |
| Linux   | libsecret (GNOME Keyring / KWallet) | Fallback: encrypted file (libsodium sealed box) if no keyring daemon |

**Storage schema:**

- Service: `com.onchaininnovation.edwin`
- Account: `owner-identity`
- Secret: private key hex (64 chars)

### 5.4 Client Mode Security

- Client generates its own keypair (stored in its own OS keychain)
- All client→gateway requests signed with BRC-103
- Gateway verifies client identity against an allowlist
- Client **never** receives gateway's private key material
- TLS required for client→gateway communication (enforced in client mode config)

---

## 6. BRC Integration Map

How BSV Request for Comments (BRC) standards map to Edwin app operations.

### 6.1 BRC-42 — BSV Key Derivation Scheme → Subscription Key Derivation

**Standard:** Two parties derive shared keys via secp256k1 ECDH + HMAC-SHA256, parameterized by an "invoice number" string. Each unique invoice number yields a unique key pair. Neither party reveals their private key.

**Edwin operations:**
| Operation | protocolID | keyID | Purpose |
|-----------|-----------|-------|---------|
| Subscription UTXO locking | `[2, "edwin-subscription"]` | `"sub-{YYYY-MM}"` | Lock subscription payment to a key derived between user and OCI |
| Per-channel encryption (future) | `[2, "edwin-channel"]` | `"{channelName}-{id}"` | Derive per-channel encryption keys |
| Session keys | `[1, "edwin-session"]` | `"{sessionId}"` | Self-derivation for session-scoped operations |

**Source:** [BRC-42](https://github.com/bitcoin-sv/BRCs/blob/master/key-derivation/0042.md)

### 6.2 BRC-43 — Security Levels & Protocol IDs → Key Organization

**Standard:** Defines three security levels and a naming convention for protocol IDs and key IDs.

**Edwin mapping:**
| Security Level | Usage | Example |
|---------------|-------|---------|
| Level 0 (public) | Not used by Edwin | — |
| Level 1 (self-only) | Request signing identity derivation | `[1, "edwin-session"]` |
| Level 2 (counterparty) | Subscription keys (user ↔ OCI) | `[2, "edwin-subscription"]` |

**Source:** [BRC-43](https://github.com/bitcoin-sv/BRCs/blob/master/key-derivation/0043.md)

### 6.3 BRC-100 — Wallet Interface → Crypto Domain API Surface

**Standard:** Abstract interface for BSV wallet operations: `createAction`, `signAction`, `getPublicKey`, `encrypt`, `decrypt`, `verifyHmac`.

**Edwin subset implemented:**
| BRC-100 Method | Edwin IPC Command | Notes |
|---------------|-------------------|-------|
| `getPublicKey` | `get-identity` | Returns compressed pubkey + petname |
| `createSignature` | `sign` | Signs HTTP request payloads (BRC-103) |
| `verifySignature` | (internal) | Used by gateway to verify inbound requests |
| `createAction` | (Phase 2) | Creates subscription payment transaction |

The Crypto Domain implements a **subset** of BRC-100. The AI Domain accesses these through the IPC API — never directly.

**Source:** [BRC-100](https://github.com/bitcoin-sv/BRCs/blob/master/wallet/0100.md)

### 6.4 BRC-103 — Mutual Authentication → Request Signing

**Standard:** HTTP request authentication using BSV keypairs. No certificates required.

**Edwin implementation:**

| Header            | Value                                |
| ----------------- | ------------------------------------ |
| `x-bsv-identity`  | Compressed public key hex (33 bytes) |
| `x-bsv-timestamp` | Unix milliseconds                    |
| `x-bsv-nonce`     | Random 32-byte hex                   |
| `x-bsv-signature` | DER-encoded ECDSA signature          |

**Signed message format:** `METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY_HASH`

**Security properties (verified via test battery 2026-02-09):**

- Replay protection: nonce-based, duplicate nonces rejected (401)
- Timestamp validation: requests older than tolerance window rejected (401)
- Signature integrity: tampered signatures rejected (401)
- Rate limiting: concurrent request anomaly detection (429)

**Known issue:** Gateway currently does not include body hash in signature verification. Fix required in Phase 1 before production.

**Source:** [BRC-103](https://github.com/bitcoin-sv/BRCs/blob/master/wallet/0103.md)

### 6.5 BRC-62 — Merkle Proof Format → Subscription SPV Verification

**Standard:** Format for transmitting BSV transaction Merkle proofs: raw tx, Merkle path, block header, block height.

**Edwin usage:** The subscription engine fetches a BRC-62 proof for the subscription UTXO, verifies the Merkle path against the block header, and caches the proof locally. Daily re-verification confirms the UTXO remains unspent.

**Source:** [BRC-62](https://github.com/bitcoin-sv/BRCs/blob/master/transactions/0062.md)

---

## 7. Onboarding Flows

### 7.1 Gateway Mode State Machine

```
┌───────────┐
│  INSTALL   │
└─────┬─────┘
      │
      ▼
┌───────────┐    select "Gateway"    ┌────────────────┐
│ MODE_SEL  │ ─────────────────────→ │ GEN_IDENTITY   │
└───────────┘                        └───────┬────────┘
                                             │ keypair generated,
                                             │ stored in keychain
                                             ▼
                                     ┌────────────────┐
                                     │ SHOW_IDENTITY  │
                                     │ (petname+avatar)│
                                     └───────┬────────┘
                                             │
                              ┌──────────────┼──────────────┐
                              │ skip         │ subscribe    │
                              ▼              ▼              │
                     ┌──────────┐   ┌───────────────┐      │
                     │ CHAN_SEL  │   │ SUB_PAYMENT   │      │
                     │ (skip ok)│   │ create UTXO   │      │
                     └────┬─────┘   └──────┬────────┘      │
                          │                │ verified       │
                          │                ▼              │
                          │        ┌───────────────┐      │
                          │        │ SUB_CONFIRMED │      │
                          │        └──────┬────────┘      │
                          │               │               │
                          ▼               ▼               │
                     ┌────────────────────────┐           │
                     │      CHAN_WIZARD       │ ◄─────────┘
                     │  (per-channel setup,   │   skip
                     │   can add 0..N)        │
                     └───────────┬────────────┘
                                 │
                                 ▼
                          ┌────────────┐
                          │  DASHBOARD │
                          │  (ready)   │
                          └────────────┘
```

**States:**
| State | Description | Next |
|-------|-------------|------|
| INSTALL | App installed, first launch detected | MODE_SEL |
| MODE_SEL | User picks Gateway or Client | GEN_IDENTITY (Gateway) or ENTER_URL (Client) |
| GEN_IDENTITY | Auto-create secp256k1 keypair, store in keychain | SHOW_IDENTITY |
| SHOW_IDENTITY | Display petname + avatar, "This is your Edwin identity" | SUB_PAYMENT or CHAN_SEL (skip) |
| SUB_PAYMENT | Subscription payment transaction created and broadcast | SUB_CONFIRMED |
| SUB_CONFIRMED | UTXO verified on-chain, subscription active | CHAN_WIZARD |
| CHAN_SEL | Optional channel selection screen | CHAN_WIZARD or DASHBOARD (skip all) |
| CHAN_WIZARD | Per-channel 4-step wizard (§8) | DASHBOARD (when done or skipped) |
| DASHBOARD | Main app screen — chat, channels, settings | — |

### 7.2 Client Mode State Machine

```
┌───────────┐
│  INSTALL   │
└─────┬─────┘
      │
      ▼
┌───────────┐    select "Client"     ┌────────────────┐
│ MODE_SEL  │ ─────────────────────→ │ ENTER_URL      │
└───────────┘                        └───────┬────────┘
                                             │ URL entered,
                                             │ health check passed
                                             ▼
                                     ┌────────────────┐
                                     │ GEN_IDENTITY   │
                                     │ (or import)    │
                                     └───────┬────────┘
                                             │ keypair generated
                                             ▼
                                     ┌────────────────┐
                                     │ AUTH_HANDSHAKE │
                                     │ BRC-103 signed │
                                     │ request to gw  │
                                     └───────┬────────┘
                                             │ gateway returns
                                             │ auth level
                                             ▼
                                     ┌────────────────┐
                                     │ CHAT_READY     │
                                     │ (thin client)  │
                                     └────────────────┘
```

**States:**
| State | Description | Next |
|-------|-------------|------|
| ENTER_URL | Input gateway URL, test connection (health check) | GEN_IDENTITY |
| GEN_IDENTITY | Create or import keypair, store in keychain | AUTH_HANDSHAKE |
| AUTH_HANDSHAKE | Send BRC-103 signed request; gateway verifies and returns authorization level | CHAT_READY |
| CHAT_READY | Chat interface connected to remote gateway | — |

---

## 8. Channel Integration Specs

### 8.1 Wizard Framework (Shared)

All channel wizards follow a consistent 4-step pattern:

```
Step 1: SELECT     Step 2: AUTH        Step 3: CONFIGURE    Step 4: TEST
┌──────────┐      ┌──────────┐        ┌──────────┐        ┌──────────┐
│ Channel  │ ───→ │ Channel- │ ────→  │ Room/    │ ────→  │ Send     │
│ icon grid│      │ specific │        │ channel  │        │ test msg │
│ pick one │      │ auth UI  │        │ selection│        │ confirm  │
└──────────┘      └──────────┘        │ auto-    │        │ round-   │
                                      │ reply    │        │ trip     │
                                      │ toggles  │        └──────────┘
                                      └──────────┘
```

On completion, the wizard writes to `~/.edwin/edwin.json` under `channels.<name>` and sends a hot-reload signal to the gateway sidecar.

### 8.2 WhatsApp

| Property        | Value                                                                               |
| --------------- | ----------------------------------------------------------------------------------- |
| Auth method     | QR code scan (WhatsApp Web protocol)                                                |
| Auth UI         | Live QR code rendered in a Dialog component; refreshes on expiry                    |
| Session storage | `channels.whatsapp.session` (opaque object, encrypted at rest)                      |
| Message schema  | Inbound: `{ from: string, body: string, timestamp: number, mediaUrl?: string }`     |
|                 | Outbound: `{ to: string, body: string, mediaUrl?: string }`                         |
| Known risks     | Protocol is reverse-engineered and may break; wizard designed to be easily disabled |
| Config key      | `channels.whatsapp`                                                                 |

### 8.3 Telegram

| Property       | Value                                                                                 |
| -------------- | ------------------------------------------------------------------------------------- |
| Auth method    | Bot token from @BotFather                                                             |
| Auth UI        | Text input for bot token + link to @BotFather instructions                            |
| Message schema | Inbound: `{ chat_id: number, from: { id: number, username?: string }, text: string }` |
|                | Outbound: `{ chat_id: number, text: string, parse_mode?: 'Markdown' \| 'HTML' }`      |
| Polling        | Long-polling via `getUpdates` (or webhook if gateway is publicly accessible)          |
| Config key     | `channels.telegram`                                                                   |

### 8.4 Matrix

| Property       | Value                                                                                 |
| -------------- | ------------------------------------------------------------------------------------- |
| Auth method    | Homeserver URL + username/password (or access token)                                  |
| Auth UI        | Homeserver URL input → login form → room list picker with auto-reply toggles per room |
| Message schema | Inbound: `{ room_id: string, sender: string, body: string, event_id: string }`        |
|                | Outbound: `{ room_id: string, body: string, msgtype: 'm.text' }`                      |
| Sync           | `/sync` long-polling with `since` token for incremental updates                       |
| Config key     | `channels.matrix`                                                                     |

### 8.5 Discord

| Property       | Value                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------- |
| Auth method    | OAuth2 bot authorization flow or bot token paste                                             |
| Auth UI        | "Add to Server" button (OAuth2 redirect) or token input; server/channel picker               |
| Message schema | Inbound: `{ channel_id: string, author: { id: string, username: string }, content: string }` |
|                | Outbound: `{ channel_id: string, content: string, embeds?: object[] }`                       |
| Connection     | WebSocket gateway (`wss://gateway.discord.gg`)                                               |
| Config key     | `channels.discord`                                                                           |

### 8.6 Slack

| Property        | Value                                                                         |
| --------------- | ----------------------------------------------------------------------------- |
| Auth method     | OAuth2 install flow (workspace-scoped)                                        |
| Auth UI         | "Add to Slack" button → OAuth redirect → workspace selection → channel picker |
| Required scopes | `chat:write`, `channels:history`, `channels:read`, `app_mentions:read`        |
| Message schema  | Inbound: `{ channel: string, user: string, text: string, ts: string }`        |
|                 | Outbound: `{ channel: string, text: string, blocks?: object[] }`              |
| Connection      | Socket Mode (WebSocket) or Events API (webhook)                               |
| Config key      | `channels.slack`                                                              |

### 8.7 Signal

| Property       | Value                                                                          |
| -------------- | ------------------------------------------------------------------------------ |
| Auth method    | QR code pairing (Signal linked device protocol)                                |
| Auth UI        | QR code rendered in Dialog; user scans with Signal mobile app                  |
| Message schema | Inbound: `{ source: string, body: string, timestamp: number }`                 |
|                | Outbound: `{ recipient: string, body: string }`                                |
| Known risks    | Linked device protocol is undocumented; may break. Marked as **experimental**. |
| Config key     | `channels.signal`                                                              |

### 8.8 Channel Status Dashboard

Real-time dashboard visible from the main app:

| Column              | Description                                                        |
| ------------------- | ------------------------------------------------------------------ |
| Channel icon + name | Identifies the channel                                             |
| Status indicator    | Green (connected), yellow (reconnecting), red (error/disconnected) |
| Message count       | Today / total since configured                                     |
| Last message        | Timestamp of most recent message                                   |
| Actions             | Reconnect, Disable, Reconfigure (opens wizard at step 2)           |

---

## Appendix A: Configuration Schema

```jsonc
// ~/.edwin/edwin.json
{
  "mode": "gateway" | "client",
  "identity": {
    "publicKey": "0324b74da05bd6aa...",
    "petname": "swift-falcon",
    "avatarSeed": "0324b74da05bd6aa...",
    "createdAt": 1707436800000
  },
  "gateway": {
    "bsvAuth": {
      "enabled": true,
      "ownerPublicKey": "0324b7...",
      "allowUnauthenticated": false,
      "requireOwner": false,
      "timestampToleranceMs": 30000,
      "replayWindowMs": 300000
    }
  },
  "client": {
    "gatewayUrl": "https://my-edwin.example.com",
    "autoSign": true
  },
  "subscription": {
    "txid": "abc123...",
    "outputIndex": 0,
    "lastVerified": 1707436800000,
    "gracePeriodHours": 72,
    "ociPublicKey": "<OCI's public key for BRC-42 derivation>"
  },
  "channels": {
    "whatsapp": { "enabled": true, "autoReply": true, "allowedUsers": [], "session": {} },
    "telegram": { "enabled": true, "autoReply": true, "allowedUsers": [], "botToken": "..." },
    "matrix": { "enabled": false },
    "discord": { "enabled": false },
    "slack": { "enabled": false },
    "signal": { "enabled": false }
  }
}
```

## Appendix B: Key Dependencies

| Package                     | Purpose                      |
| --------------------------- | ---------------------------- |
| `@tauri-apps/api` v2        | Frontend Tauri bindings      |
| `tauri-plugin-stronghold`   | Secure key storage           |
| `tauri-plugin-shell`        | Sidecar process management   |
| `tauri-plugin-notification` | Native OS notifications      |
| `tauri-plugin-updater`      | Auto-updates                 |
| `@bsv/sdk`                  | BSV cryptographic operations |
| `react` 18+                 | UI framework                 |
| `shadcn/ui`                 | Component library            |
| `tailwindcss` 4             | Styling                      |
| `zustand`                   | State management             |
| `jdenticon`                 | Avatar generation            |
