# Edwin AI-Crypto Isolation Architecture

**Date:** 2026-02-07  
**Status:** Implemented  
**Version:** 1.0

---

## Executive Summary

This document describes Edwin's AI-Crypto Isolation Boundary — the architectural centerpiece that separates AI agent operations from cryptographic key material. This is a fundamental security requirement: **the AI agent should NEVER have direct access to private keys.**

### The Thesis

> "Edwin trusts the AI with everything. Edwin trusts the AI with nothing sensitive."

Unlike systems that give AI full access to credentials, Edwin implements a strict isolation boundary where:

- AI agents operate with **opaque key handles** (UUIDs), not actual keys
- All cryptographic operations go through a **validated API boundary**
- Raw key material **never leaves the Crypto Core**
- Every operation is **audit logged** with the key ID (never the key itself)

---

## Trust Boundary Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     AI AGENT (Untrusted Zone)                       │
│                                                                     │
│  • Has key IDs (opaque UUID strings)                               │
│  • Can request operations: sign, encrypt, derive, etc.             │
│  • CANNOT access raw private keys                                  │
│  • CANNOT bypass the vault API                                     │
│  • CANNOT influence derivation paths or curve parameters           │
│                                                                     │
│  Example code in AI agent:                                         │
│    const keyId = await vault.generateKey("my-key");  // UUID       │
│    const sig = await vault.sign(keyId, messageHash); // Buffer     │
│    // keyId is "a1b2c3d4-..." — the AI never sees the private key  │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                     SecureVault API Boundary                        │
│                                                                     │
│  Security Controls:                                                 │
│  ✓ Input validation (all parameters validated before processing)   │
│  ✓ Rate limiting (configurable ops/minute per key)                 │
│  ✓ Audit logging (all operations logged with keyId, never key)     │
│  ✓ Auto-lock (vault locks after inactivity)                        │
│  ✓ Error sanitization (errors don't leak sensitive data)           │
│                                                                     │
│  Boundary Enforcement:                                              │
│  • No raw key export methods                                        │
│  • Keys stored in private Map, not exposed via API                  │
│  • Public keys (safe) returned, private keys never                  │
│  • Derivation paths hardcoded (BRC-42 compliance)                   │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                     Crypto Core (Trusted Zone)                      │
│                                                                     │
│  • Raw private key material lives here (SecurePrivateKey objects)   │
│  • BSV SDK wrapper with security constraints                        │
│  • RFC 6979 deterministic signatures (no nonce reuse)               │
│  • HKDF-SHA256 on all shared secrets (per NIST SP 800-56A)         │
│  • Hardened derivation paths only (BIP-32 security model)          │
│  • Curve parameter validation (secp256k1 hardcoded)                │
│                                                                     │
│  Internal structure (not exposed):                                  │
│    Map<string, {                                                    │
│      privateKey: SecurePrivateKey,  // ← NEVER leaves here         │
│      metadata: { keyId, label, publicKey, ... }                     │
│    }>                                                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Security Properties

### 1. Key Material Isolation

The vault maintains an internal `Map<string, InternalKeyEntry>` where:

```typescript
interface InternalKeyEntry {
  privateKey: SecurePrivateKey; // NEVER exposed
  metadata: VaultKeyMetadata; // Safe to expose
}
```

The `privateKey` field:

- Is never returned by any public method
- Is never serialized to logs or errors
- Is only accessed within vault methods for operations
- Is stored in memory (future: encrypted at-rest storage)

### 2. Opaque Key References

All external code works with **opaque key IDs** (UUIDs):

```typescript
// ✅ CORRECT: AI agent gets UUID, not key
const keyId = await vault.generateKey("signing-key");
// keyId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

// ✅ CORRECT: Operations use keyId, vault has the key
const signature = await vault.sign(keyId, messageHash);

// ❌ IMPOSSIBLE: No way to extract the private key
const privateKey = vault.getPrivateKey(keyId); // Method doesn't exist
const keys = vault.keys; // Private field, not accessible
```

### 3. Input Validation

Every vault method validates inputs before processing:

| Input        | Validation                                       |
| ------------ | ------------------------------------------------ |
| Key ID       | Non-empty string, key must exist in vault        |
| Public key   | 66 hex chars, prefix 02 or 03 (compressed)       |
| Message hash | 64 hex chars (32 bytes SHA-256)                  |
| Protocol ID  | Tuple `[SecurityLevel, string]`, level ∈ {0,1,2} |
| Signature    | Buffer, valid DER encoding                       |

### 4. Audit Trail

Every operation is logged with:

```typescript
interface VaultAuditEntry {
  id: string; // Unique entry ID
  timestamp: number; // When
  operation: string; // What (generate_key, sign, etc.)
  keyId?: string; // Which key (opaque ID)
  keyLabel?: string; // Human-readable label
  success: boolean; // Did it work
  error?: string; // What went wrong
  metadata?: object; // Extra context (NEVER key material)
}
```

**Critical:** Audit logs never contain:

- Private keys
- Raw key bytes
- Sensitive derivation inputs

### 5. Rate Limiting

Configurable per-key rate limits prevent abuse:

```typescript
const vault = await SecureVault.create({
  maxOperationsPerMinute: 1000, // Per key
});
```

Exceeding the limit throws `VaultError` with code `RATE_LIMITED`.

### 6. Auto-Lock

The vault automatically locks after inactivity:

```typescript
const vault = await SecureVault.create({
  autoLockMs: 300000, // 5 minutes
});
```

When locked:

- All operations throw `VAULT_LOCKED` error
- Unlock with `vault.unlock()` (future: requires master password)

---

## API Reference

### Key Management

```typescript
class SecureVault {
  // Create vault
  static async create(config?: VaultConfig): Promise<SecureVault>;

  // Generate new key, returns opaque ID
  generateKey(label: string): Promise<string>;

  // Import existing key (caller should wipe input after)
  importKey(label: string, privateKeyHex: string): Promise<string>;

  // Delete key from vault
  deleteKey(keyId: string): Promise<void>;

  // Get public key (safe to expose)
  getPublicKey(keyId: string): Promise<string>;

  // List all keys (metadata only)
  listKeys(): Promise<VaultKeyMetadata[]>;
}
```

### Cryptographic Operations

```typescript
class SecureVault {
  // Sign message hash (RFC 6979 deterministic)
  sign(keyId: string, messageHash: string): Promise<Buffer>;

  // Verify signature
  verify(publicKeyHex: string, messageHash: string, signature: Buffer): Promise<boolean>;

  // Derive child key (BRC-42), returns new key ID
  deriveChildKey(
    keyId: string,
    counterpartyPublicKey: string,
    params: VaultKeyDerivationParams,
  ): Promise<string>;

  // ECIES encrypt (BRC-78)
  encrypt(keyId: string, recipientPublicKey: string, plaintext: Buffer): Promise<Buffer>;

  // ECIES decrypt (BRC-78)
  decrypt(keyId: string, senderPublicKey: string, ciphertext: Buffer): Promise<Buffer>;

  // Derive shared secret (ECDH + HKDF)
  deriveSharedSecret(
    keyId: string,
    counterpartyPublicKey: string,
    context?: string,
  ): Promise<Buffer>;

  // Sign HTTP request (BRC-103)
  signRequest(
    keyId: string,
    params: { method: string; path: string; body?: string | object },
  ): Promise<Record<string, string>>;
}
```

### Vault Control

```typescript
class SecureVault {
  // Lock vault (blocks all operations)
  lock(): void;

  // Unlock vault
  unlock(): void;

  // Check lock status
  isLocked(): boolean;

  // Get audit log
  getAuditLog(limit?: number): VaultAuditEntry[];

  // Clear audit log
  clearAuditLog(): void;
}
```

---

## Attack Mitigations

### Threat: Prompt Injection to Extract Keys

**Attack Vector:** AI agent is tricked by malicious prompt to export keys.

**Mitigation:** No export method exists. The vault API has no way to retrieve private keys.

```typescript
// There is no such method:
vault.exportKey(keyId); // ❌ Doesn't exist
vault.getPrivateKey(keyId); // ❌ Doesn't exist
vault.keys.get(keyId); // ❌ Private field
```

### Threat: Prompt Injection to Use Weak Parameters

**Attack Vector:** AI agent is tricked into using non-hardened paths or weak curves.

**Mitigation:** All security-critical parameters are hardcoded in the Crypto Core:

```typescript
// Hardcoded in bsv-sdk-wrapper.ts and constants.ts:
- Curve: secp256k1 (validated on every operation)
- Derivation: BRC-42 hardened paths only
- Signatures: RFC 6979 deterministic k
- Shared secrets: Always HKDF-SHA256 (never raw ECDH)
```

### Threat: Timing Side-Channels

**Attack Vector:** Attacker measures operation timing to leak key bits.

**Mitigation:**

- Constant-time comparison for sensitive data (`constantTimeCompare`)
- BSV SDK uses Montgomery ladder for scalar multiplication

### Threat: Memory Scraping

**Attack Vector:** Attacker reads process memory to find keys.

**Mitigation (Current):**

- Keys isolated in vault, not scattered throughout application
- Deleted keys removed from Map (GC handles memory)

**Mitigation (Future):**

- Secure memory allocation (mlock, mprotect)
- Explicit memory wiping on key delete

### Threat: Nonce Reuse in Signatures

**Attack Vector:** Repeated use of same nonce leaks private key.

**Mitigation:** RFC 6979 deterministic nonce generation:

```typescript
// In rfc6979.ts:
const k = generateDeterministicK(messageHash, privateKey);
// k is derived deterministically from message + key
// Same message → same k → same signature (safe)
// No random nonce → no nonce reuse vulnerability
```

---

## Configuration

```typescript
interface VaultConfig {
  // Storage path (future: encrypted at-rest storage)
  storagePath?: string;

  // Master key source: 'env' | 'prompt' | 'keychain'
  masterKeySource?: MasterKeySource;

  // Env var for master key (default: EDWINPAI_VAULT_MASTER_KEY)
  masterKeyEnvVar?: string;

  // Auto-lock timeout (default: 300000ms = 5 min)
  autoLockMs?: number;

  // Enable audit logging (default: true)
  enableAuditLog?: boolean;

  // Max audit log entries (default: 10000)
  maxAuditLogSize?: number;

  // Rate limit per key (default: 1000 ops/min)
  maxOperationsPerMinute?: number;
}
```

---

## Usage Examples

### Basic Key Generation and Signing

```typescript
import { SecureVault } from "./crypto/vault.js";

// Create vault
const vault = await SecureVault.create();

// Generate key (returns UUID, not key)
const keyId = await vault.generateKey("api-signing-key");

// Sign a message
const message = "Hello, world!";
const hash = crypto.createHash("sha256").update(message).digest("hex");
const signature = await vault.sign(keyId, hash);

// Get public key for verification
const publicKey = await vault.getPublicKey(keyId);
```

### Encrypted Communication

```typescript
// Alice and Bob each have keys in the vault
const aliceKeyId = await vault.generateKey("alice");
const bobKeyId = await vault.generateKey("bob");

const alicePubKey = await vault.getPublicKey(aliceKeyId);
const bobPubKey = await vault.getPublicKey(bobKeyId);

// Alice encrypts message for Bob
const message = Buffer.from("Secret message");
const encrypted = await vault.encrypt(aliceKeyId, bobPubKey, message);

// Bob decrypts message from Alice
const decrypted = await vault.decrypt(bobKeyId, alicePubKey, encrypted);
```

### HTTP Request Signing (BRC-103)

```typescript
const identityKeyId = await vault.generateKey("identity");

// Sign an API request
const headers = await vault.signRequest(identityKeyId, {
  method: "POST",
  path: "/api/agent/run",
  body: { prompt: "Hello" },
});

// Attach headers to fetch
const response = await fetch("https://api.example.com/api/agent/run", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...headers,
  },
  body: JSON.stringify({ prompt: "Hello" }),
});
```

---

## Future Enhancements

### Phase 2: Encrypted At-Rest Storage

```typescript
// Store keys encrypted with master password
const vault = await SecureVault.create({
  storagePath: "/secure/keys.vault",
  masterKeySource: "env",
  masterKeyEnvVar: "EDWINPAI_MASTER_KEY",
});
```

### Phase 3: Hardware Security Module (HSM) Integration

```typescript
// Keys stored in hardware, never in process memory
const vault = await SecureVault.create({
  backend: "hsm",
  hsmConfig: { ... }
});
```

### Phase 4: Multi-Party Threshold Signatures

```typescript
// Key split across multiple parties (MPC)
const partialSig = await vault.signPartial(keyId, messageHash, threshold);
```

---

## Compliance Mapping

| Requirement              | Source                | Implementation             |
| ------------------------ | --------------------- | -------------------------- |
| Key isolation from LLM   | OWASP LLM Top 10      | SecureVault API boundary   |
| Hardened derivation      | BRC-42, BIP-32        | `enforceHardenedPath()`    |
| HKDF on shared secrets   | NIST SP 800-56A Rev 3 | `deriveSharedSecret()`     |
| Deterministic signatures | RFC 6979              | `generateDeterministicK()` |
| Input validation         | OWASP                 | All vault methods          |
| Audit logging            | SOC 2                 | `VaultAuditEntry`          |
| Rate limiting            | DoS prevention        | `checkRateLimit()`         |

---

## References

1. **SECURITY-MITIGATIONS-v2.md** — Mitigation 1.1: Strict Isolation Architecture
2. **BRC-42** — BSV Key Derivation Scheme
3. **BRC-78** — ECIES Encryption
4. **BRC-103** — Peer-to-peer Authentication
5. **RFC 6979** — Deterministic ECDSA Signatures
6. **NIST SP 800-56A Rev 3** — Key Derivation from Shared Secrets
7. **OWASP LLM Top 10** — Prompt Injection Prevention

---

**Document Version:** 1.0  
**Author:** Edwin Security Team  
**Last Updated:** 2026-02-07
