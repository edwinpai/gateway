# Credential Vault — Desktop Implementation Guide

**For:** Edwin's MacBook (edwin-desktop Tauri app)
**Date:** 2026-04-08
**Context:** The gateway side is built. This doc describes what the desktop needs to implement.

## What the Gateway Does (already built)

The gateway has three new files:

1. **`credential-cache.ts`** — In-memory TTL cache. Credentials never touch disk on the gateway.
2. **`credential-vault-client.ts`** — Requests credentials from desktop via WebSocket. Checks cache first, broadcasts `credential.requested` event if cache miss, waits for response.
3. **`server-methods/credential-vault.ts`** — WebSocket handlers:
   - `credential.request` — gateway component asks for a credential
   - `credential.resolve` — desktop sends back credential or denial
   - `credential.cache.status` — diagnostics
   - `credential.evict` — manual cache eviction

## What the Desktop Needs to Build

### 1. Listen for `credential.requested` Events

The gateway broadcasts this event when it needs a credential:

```typescript
// WebSocket event: "credential.requested"
{
  id: string; // Request ID (e.g., "cred-1712563200000-1")
  credentialId: string; // e.g., "anthropic-api-key"
  name: string; // Human-readable: "Anthropic API Key"
  purpose: string; // Why: "agent chat completion"
  requester: string; // Who: "agent" or "channel:telegram"
  leaseDurationMs: number; // How long: 300000 (5 min)
  createdAtMs: number; // When request was created
  expiresAtMs: number; // When it times out (120s from created)
}
```

### 2. Show Approval UI

Add a new approval type to `ExecApprovalsPanel.tsx`. When a `credential.requested` event arrives:

```
┌─────────────────────────────────────────┐
│  🔑 Credential Request                  │
│                                          │
│  Anthropic API Key                      │
│  Purpose: agent chat completion         │
│  Requester: agent                       │
│  Lease: 5 minutes                       │
│                                          │
│  [Grant]  [Always Grant]  [Deny]        │
└─────────────────────────────────────────┘
```

**"Always Grant"** adds the credential to a local allowlist so future requests auto-approve without prompting.

### 3. Respond via `credential.resolve`

Send a WebSocket request to the gateway:

```typescript
// Method: "credential.resolve"
{
  requestId: string;         // The id from the request event
  decision: "granted" | "denied";
  credential?: string;       // The actual secret value (only if granted)
  leaseMs?: number;          // Override lease duration (optional)
  grantedBy?: string;        // BSV public key or display name
}
```

### 4. Encrypted Vault Store

Store credentials in an encrypted database on the desktop:

```
~/.edwinpai/vault/
├── vault.enc              # AES-256-GCM encrypted credential database
└── vault.policy.json      # Access policy (allowlist, auto-approve rules)
```

**Master key:** Store in OS keychain (macOS Keychain / GNOME Keyring / Windows Credential Manager). Use Tauri's keychain plugin or the existing keychain integration pattern from `cli-credentials.ts`.

**Vault entry structure:**

```typescript
interface VaultEntry {
  id: string; // e.g., "anthropic-api-key"
  name: string; // "Anthropic API Key"
  type: "api_key" | "token" | "oauth" | "session";
  provider: string; // "anthropic", "telegram", "stripe"
  credential: string; // The actual secret
  metadata?: Record<string, string>;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
}
```

### 5. Access Policy

```json
// ~/.edwinpai/vault/vault.policy.json
{
  "version": 1,
  "defaults": {
    "ask": "always"
  },
  "rules": [
    {
      "credentialId": "anthropic-api-key",
      "ask": "auto-grant",
      "maxLeaseMs": 3600000,
      "comment": "Primary LLM — auto-grant, 1hr max lease"
    },
    {
      "credentialId": "stripe-secret-key",
      "ask": "always",
      "maxLeaseMs": 60000,
      "comment": "Financial — always prompt, 1min max lease"
    }
  ]
}
```

**Ask modes:**

- `always` — prompt every time (default, for sensitive credentials)
- `first-time` — prompt once per desktop session, auto-grant after
- `auto-grant` — never prompt, still logged (for high-frequency like LLM keys)
- `deny` — never grant (disable without deleting)

### 6. Auto-Approve Flow

When a `credential.requested` event arrives and the policy says `auto-grant`:

1. Look up credential in vault
2. Check policy allows auto-grant for this credentialId
3. Immediately send `credential.resolve` with the credential
4. Log the access (credentialId, timestamp, requester)

No UI prompt needed — but the access is still logged and visible in the vault panel.

### 7. Vault Management Panel

New panel in edwin-desktop (alongside Exec Approvals, Settings, etc.):

```
┌─────────────────────────────────────────┐
│  🔐 Credential Vault                    │
│                                          │
│  Anthropic API Key     [auto-grant] [⋯] │
│    Last used: 2 min ago, 47 accesses    │
│                                          │
│  Stripe Secret Key     [always ask] [⋯] │
│    Last used: 3 days ago, 2 accesses    │
│                                          │
│  Telegram Bot Token    [first-time] [⋯] │
│    Last used: 1 hr ago, 12 accesses     │
│                                          │
│  [+ Add Credential]                     │
└─────────────────────────────────────────┘
```

The `[⋯]` menu should have: Edit, Change Policy, View Access Log, Delete.

## Integration Order

1. **Phase 1:** Listen for `credential.requested`, show approval UI, respond manually
2. **Phase 2:** Add vault store (encrypted, keychain-backed), save credentials
3. **Phase 3:** Add policy file and auto-approve logic
4. **Phase 4:** Add vault management panel

Phase 1 is the MVP — even without persistent storage, the desktop can prompt the user and they can paste the credential value to approve.

## Testing

Once the desktop has Phase 1 working, test with:

```bash
# From this VPS (or any connected client):
# Send a WebSocket request:
{
  "method": "credential.request",
  "params": {
    "credentialId": "test-credential",
    "name": "Test Credential",
    "purpose": "testing vault flow"
  }
}

# Desktop should show approval prompt.
# Approve with any value → gateway should receive and cache it.
# Check cache: credential.cache.status
```

## Security Notes

- Credential values are transmitted over the existing WebSocket connection (localhost or Tailscale, already authenticated)
- BSV signature on the `credential.resolve` response ensures only the identity key owner can approve
- Credentials are in-memory only on the gateway — disk compromise yields nothing
- The vault encryption key lives in the OS keychain, not on disk
- All access is logged with timestamps and requester identity
