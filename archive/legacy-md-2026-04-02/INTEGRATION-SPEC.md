# Edwin Crypto Integration Specification

**Date:** 2026-02-07  
**Status:** Implementation Ready  
**Version:** 1.0

---

## Executive Summary

This document specifies the integration of Edwin's crypto layer (72/72 tests passing) into the authentication and gateway infrastructure. Three integration points are covered:

1. **BRC-103 Signature Verification** - Wire BSV SDK wrapper into identity verification
2. **BRC-42 Key Derivation Service** - Complete key derivation with hardened path enforcement
3. **ECIES Encryption** - End-to-end message encryption per BRC-78

---

## 1. BRC-103 Signature Verification

### 1.1 Current State

- `src/auth/verification.ts` uses Node.js `crypto` with PEM-encoded keys
- Works but doesn't leverage `BSVCrypto` wrapper with its security guarantees
- `src/auth/identity.ts` → `verifyIdentity()` calls `verifySignedRequest()`

### 1.2 Integration Target

Replace/augment PEM-based verification with BSV SDK wrapper.

### 1.3 Function Signatures

```typescript
// src/auth/verification.ts - EXISTING (keep as fallback)
export function verifySignature(
  message: string | Buffer,
  signature: Signature,
  publicKey: PublicKey,
): boolean;

// src/auth/verification.ts - NEW (primary)
export function verifySignatureBSV(
  messageHash: HexString, // 32 bytes hex (64 chars)
  signature: Buffer, // DER-encoded
  publicKey: PublicKey, // Compressed, 33 bytes hex
): boolean;

// src/auth/verification.ts - NEW (unified)
export function verifySignatureUnified(
  message: string | Buffer,
  signature: Signature,
  publicKey: PublicKey,
  options?: { useBSVSDK?: boolean },
): boolean;
```

### 1.4 Import Chain

```
src/auth/verification.ts
  └── ../crypto/bsv-sdk-wrapper.js → { BSVCrypto, SecurePublicKey }
  └── ../crypto/kdf.js → { constantTimeCompare } (for timing-safe ops)
```

### 1.5 Security Constraints

| Constraint                  | Enforcement                                  |
| --------------------------- | -------------------------------------------- |
| Compressed public keys only | Validate 33 bytes, prefix 02/03              |
| SHA-256 message hashing     | Hash message before verification             |
| DER signature format        | Validate DER encoding                        |
| Constant-time comparison    | Use `constantTimeCompare` for sensitive data |

### 1.6 Error Handling

| Error Case                    | Exception                        | HTTP Code |
| ----------------------------- | -------------------------------- | --------- |
| Invalid public key format     | `AuthError("INVALID_FORMAT")`    | 400       |
| Invalid signature format      | `AuthError("INVALID_FORMAT")`    | 400       |
| Signature verification failed | `AuthError("INVALID_SIGNATURE")` | 401       |
| Expired timestamp             | `AuthError("EXPIRED")`           | 401       |

### 1.7 Test Cases Required

```typescript
// In src/auth/__tests__/verification.test.ts
describe("BRC-103 Signature Verification", () => {
  it("should verify valid signature using BSV SDK wrapper");
  it("should reject invalid signature");
  it("should reject malformed public key");
  it("should reject malformed signature (non-DER)");
  it("should produce same result as PEM-based verification");
  it("should enforce compressed public key format");
  it("should reject expired timestamps");
  it("should reject replayed nonces");
});
```

---

## 2. BRC-42 Key Derivation Service

### 2.1 Purpose

Provide a clean service interface for BRC-42/43 key derivation with:

- Protocol ID + Key ID → Invoice Number construction
- Hardened path enforcement (always)
- Support for security levels 0, 1, 2

### 2.2 File Location

```
src/auth/key-derivation.ts  (NEW)
```

### 2.3 Type Definitions (from src/types/bsv-auth.ts)

```typescript
type SecurityLevel = 0 | 1 | 2;
type ProtocolID = [SecurityLevel, string];
type Counterparty = string | "self" | "anyone";

interface KeyDerivationParams {
  protocolID: ProtocolID;
  keyID: string;
  counterparty?: Counterparty;
  privileged?: boolean;
  reason?: string;
}
```

### 2.4 Function Signatures

```typescript
/**
 * Build BRC-43 invoice number from protocol ID and key ID
 */
export function buildInvoiceNumber(protocolID: ProtocolID, keyID: string): string;

/**
 * Derive a child private key using BRC-42
 */
export function deriveChildPrivateKey(
  masterPrivateKey: SecurePrivateKey,
  counterpartyPublicKey: SecurePublicKey,
  params: KeyDerivationParams,
): SecurePrivateKey;

/**
 * Derive a child public key using BRC-42
 */
export function deriveChildPublicKey(
  senderPrivateKey: SecurePrivateKey,
  recipientPublicKey: SecurePublicKey,
  params: KeyDerivationParams,
): SecurePublicKey;

/**
 * Key Derivation Service class for stateful operations
 */
export class KeyDerivationService {
  constructor(masterPrivateKey: SecurePrivateKey);

  derivePrivateKey(
    counterpartyPublicKey: SecurePublicKey | string,
    params: KeyDerivationParams,
  ): SecurePrivateKey;

  derivePublicKey(
    recipientPublicKey: SecurePublicKey | string,
    params: KeyDerivationParams,
  ): SecurePublicKey;

  deriveSharedSecret(counterpartyPublicKey: SecurePublicKey | string, context?: string): Buffer;

  getIdentityPublicKey(): SecurePublicKey;
}
```

### 2.5 Import Chain

```
src/auth/key-derivation.ts
  └── ../crypto/bsv-sdk-wrapper.js → { BSVCrypto, SecurePrivateKey, SecurePublicKey }
  └── ../crypto/derivation.js → { enforceHardenedPath, validateBRC42Path }
  └── ../types/bsv-auth.js → { ProtocolID, KeyDerivationParams, ... }
```

### 2.6 Security Constraints

| Constraint              | Enforcement                                           |
| ----------------------- | ----------------------------------------------------- |
| Hardened paths only     | Call `enforceHardenedPath()` on all invoice numbers   |
| Valid security levels   | Validate `securityLevel ∈ {0, 1, 2}`                  |
| Non-empty key IDs       | Reject empty or whitespace-only keyID                 |
| Protocol ID format      | Validate `[SecurityLevel, string]` tuple              |
| Counterparty validation | For level 2, counterparty MUST be specific public key |
| Invoice number length   | Max 1024 characters                                   |

### 2.7 Invoice Number Format (BRC-43)

```
{securityLevel} {protocolID} {keyID}
```

Examples:

- `2 message encryption abc123` → Level 2, protocol "message encryption", keyID "abc123"
- `1 auth nonce-xyz` → Level 1, protocol "auth", keyID "nonce-xyz"

### 2.8 Error Handling

| Error Case                       | Exception                                      | HTTP Code |
| -------------------------------- | ---------------------------------------------- | --------- |
| Invalid security level           | `KeyDerivationError("INVALID_SECURITY_LEVEL")` | 400       |
| Empty protocol ID                | `KeyDerivationError("INVALID_PROTOCOL_ID")`    | 400       |
| Empty key ID                     | `KeyDerivationError("INVALID_KEY_ID")`         | 400       |
| Non-hardened path detected       | `KeyDerivationError("NON_HARDENED_PATH")`      | 400       |
| Invalid counterparty for level 2 | `KeyDerivationError("INVALID_COUNTERPARTY")`   | 400       |
| Invoice number too long          | `KeyDerivationError("INVOICE_TOO_LONG")`       | 400       |

### 2.9 Test Cases Required

```typescript
// In src/auth/__tests__/key-derivation.test.ts
describe("BRC-42 Key Derivation Service", () => {
  describe("buildInvoiceNumber()", () => {
    it("should construct valid invoice number from protocol ID and key ID");
    it("should reject invalid security level");
    it("should reject empty protocol ID");
    it("should reject empty key ID");
    it("should handle special characters in key ID");
  });

  describe("deriveChildPrivateKey()", () => {
    it("should derive deterministic private key");
    it("should match BSV SDK derivation output");
    it("should enforce hardened paths");
    it("should validate counterparty for security level 2");
  });

  describe("deriveChildPublicKey()", () => {
    it("should derive deterministic public key");
    it("should match BSV SDK derivation output");
    it("should allow 'anyone' counterparty for level 1");
    it("should reject 'anyone' counterparty for level 2");
  });

  describe("KeyDerivationService", () => {
    it("should maintain consistent identity key");
    it("should derive shared secrets correctly");
    it("should produce symmetric shared secrets (Alice-Bob = Bob-Alice)");
    it("should derive different keys for different params");
  });
});
```

---

## 3. ECIES Encryption

### 3.1 Purpose

Implement BRC-78 compliant message encryption using:

- Ephemeral keys for forward secrecy
- ECDH + HKDF for key derivation
- AES-256-GCM for authenticated encryption

### 3.2 File Location

```
src/crypto/ecies.ts  (NEW)
```

### 3.3 BRC-78 Message Format

| Field        | Length   | Description                                      |
| ------------ | -------- | ------------------------------------------------ |
| Version      | 4 bytes  | `0x42421033`                                     |
| Sender ID    | 33 bytes | Sender's identity public key                     |
| Recipient ID | 33 bytes | Recipient's identity public key                  |
| Key ID       | 32 bytes | Random key ID for BRC-43 derivation              |
| Ciphertext   | Variable | IV (12 bytes) + ciphertext + auth tag (16 bytes) |

### 3.4 Function Signatures

```typescript
/**
 * ECIES encryption options
 */
export interface ECIESOptions {
  /** Protocol ID for key derivation (default: [2, "message encryption"]) */
  protocolID?: ProtocolID;
  /** Additional authenticated data for AES-GCM */
  aad?: Buffer;
}

/**
 * ECIES encryption result
 */
export interface ECIESCiphertext {
  /** Version (0x42421033) */
  version: number;
  /** Sender's identity public key */
  senderPublicKey: string;
  /** Recipient's identity public key */
  recipientPublicKey: string;
  /** Random key ID (32 bytes hex) */
  keyID: string;
  /** IV + ciphertext + auth tag */
  ciphertext: Buffer;
}

/**
 * Encrypt a message using BRC-78 ECIES
 */
export function encrypt(
  plaintext: Buffer,
  senderPrivateKey: SecurePrivateKey,
  recipientPublicKey: SecurePublicKey,
  options?: ECIESOptions,
): ECIESCiphertext;

/**
 * Decrypt a message using BRC-78 ECIES
 */
export function decrypt(
  ciphertext: ECIESCiphertext,
  recipientPrivateKey: SecurePrivateKey,
  senderPublicKey: SecurePublicKey,
  options?: ECIESOptions,
): Buffer;

/**
 * Serialize ECIES ciphertext to bytes (BRC-78 format)
 */
export function serializeCiphertext(ciphertext: ECIESCiphertext): Buffer;

/**
 * Deserialize ECIES ciphertext from bytes (BRC-78 format)
 */
export function deserializeCiphertext(data: Buffer): ECIESCiphertext;

/**
 * High-level ECIES class for stateful encryption
 */
export class ECIES {
  constructor(privateKey: SecurePrivateKey);

  encrypt(plaintext: Buffer, recipientPublicKey: SecurePublicKey | string): Buffer;
  decrypt(ciphertext: Buffer, senderPublicKey: SecurePublicKey | string): Buffer;

  getPublicKey(): SecurePublicKey;
}
```

### 3.5 Import Chain

```
src/crypto/ecies.ts
  └── ./bsv-sdk-wrapper.js → { BSVCrypto, SecurePrivateKey, SecurePublicKey }
  └── ./kdf.js → { deriveKeyFromSharedSecret, deriveEncryptionKeys }
  └── ./ephemeral.js → { generateEphemeralKeyPair }
  └── node:crypto → { createCipheriv, createDecipheriv, randomBytes }
  └── ../types/bsv-auth.js → { ProtocolID }
```

### 3.6 Cryptographic Parameters

| Parameter        | Value                 |
| ---------------- | --------------------- |
| Symmetric cipher | AES-256-GCM           |
| IV length        | 12 bytes (96 bits)    |
| Auth tag length  | 16 bytes (128 bits)   |
| Key derivation   | HKDF-SHA256           |
| HKDF info        | `"BRC-78-encryption"` |
| HKDF output      | 32 bytes (256 bits)   |

### 3.7 Security Constraints

| Constraint               | Enforcement                         |
| ------------------------ | ----------------------------------- |
| Random IV per encryption | `crypto.randomBytes(12)`            |
| HKDF on shared secrets   | Never use raw ECDH output           |
| Auth tag verification    | GCM mode (automatic)                |
| Key ID uniqueness        | Random 32 bytes per message         |
| BRC-42 key derivation    | Use derived keys, not identity keys |
| Version validation       | Reject unknown versions             |

### 3.8 Error Handling

| Error Case                   | Exception                             | HTTP Code |
| ---------------------------- | ------------------------------------- | --------- |
| Invalid recipient public key | `ECIESError("INVALID_RECIPIENT")`     | 400       |
| Invalid sender public key    | `ECIESError("INVALID_SENDER")`        | 400       |
| Ciphertext too short         | `ECIESError("INVALID_CIPHERTEXT")`    | 400       |
| Invalid version              | `ECIESError("INVALID_VERSION")`       | 400       |
| Decryption failed (auth tag) | `ECIESError("DECRYPTION_FAILED")`     | 400       |
| Key derivation failed        | `ECIESError("KEY_DERIVATION_FAILED")` | 500       |

### 3.9 Test Cases Required

```typescript
// In src/crypto/__tests__/ecies.test.ts
describe("ECIES Encryption (BRC-78)", () => {
  describe("encrypt()", () => {
    it("should encrypt plaintext and return valid ciphertext structure");
    it("should use random IV for each encryption");
    it("should use random keyID for each encryption");
    it("should set correct version (0x42421033)");
    it("should include sender and recipient public keys");
  });

  describe("decrypt()", () => {
    it("should decrypt ciphertext back to original plaintext");
    it("should reject tampered ciphertext");
    it("should reject wrong sender public key");
    it("should reject wrong recipient private key");
    it("should reject invalid version");
    it("should reject truncated ciphertext");
  });

  describe("serializeCiphertext() / deserializeCiphertext()", () => {
    it("should round-trip serialize and deserialize");
    it("should produce BRC-78 compliant byte format");
    it("should match hex examples from BRC-78 spec");
  });

  describe("ECIES class", () => {
    it("should provide stateful encryption/decryption");
    it("should handle string public keys");
    it("should maintain consistent identity");
  });

  describe("Cross-party encryption", () => {
    it("should allow Alice to encrypt for Bob");
    it("should allow Bob to decrypt message from Alice");
    it("should prevent Eve from decrypting message");
  });

  describe("Edge cases", () => {
    it("should handle empty plaintext");
    it("should handle large plaintext (1MB)");
    it("should handle binary data with null bytes");
  });
});
```

---

## 4. Dependency Graph

```
                    ┌─────────────────────────────┐
                    │     src/types/bsv-auth.ts   │
                    │  (ProtocolID, KeyDerivation │
                    │   Params, etc.)             │
                    └─────────────┬───────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         │                        │                        │
         ▼                        ▼                        ▼
┌────────────────┐    ┌──────────────────────┐    ┌────────────────┐
│ src/crypto/    │    │ src/auth/            │    │ src/crypto/    │
│ ecies.ts       │    │ key-derivation.ts    │    │ bsv-sdk-       │
│ (NEW)          │    │ (NEW)                │    │ wrapper.ts     │
└───────┬────────┘    └──────────┬───────────┘    └───────┬────────┘
        │                        │                        │
        │                        │                        │
        ▼                        ▼                        ▼
┌────────────────┐    ┌──────────────────────┐    ┌────────────────┐
│ src/crypto/    │    │ src/crypto/          │    │ @bsv/sdk       │
│ kdf.ts         │    │ derivation.ts        │    │ (external)     │
│                │    │                      │    └────────────────┘
└───────┬────────┘    └──────────────────────┘
        │
        ▼
┌────────────────┐
│ src/crypto/    │
│ ephemeral.ts   │
└────────────────┘
```

---

## 5. Implementation Checklist

### Phase 1: BRC-103 Signature Verification (HIGH, 2hrs)

- [ ] Add `verifySignatureBSV()` to `src/auth/verification.ts`
- [ ] Wire `BSVCrypto.verify()` call
- [ ] Add fallback to PEM-based verification
- [ ] Update `verifySignedRequest()` to use new function
- [ ] Add tests

### Phase 2: BRC-42 Key Derivation (HIGH, 4-6hrs)

- [ ] Create `src/auth/key-derivation.ts`
- [ ] Implement `buildInvoiceNumber()`
- [ ] Implement `deriveChildPrivateKey()`
- [ ] Implement `deriveChildPublicKey()`
- [ ] Implement `KeyDerivationService` class
- [ ] Add comprehensive tests
- [ ] Create test directory `src/auth/__tests__/`

### Phase 3: ECIES Encryption (MEDIUM, 6-8hrs)

- [ ] Create `src/crypto/ecies.ts`
- [ ] Implement `encrypt()`
- [ ] Implement `decrypt()`
- [ ] Implement serialization (BRC-78)
- [ ] Implement `ECIES` class
- [ ] Add comprehensive tests
- [ ] Validate against BRC-78 hex examples

---

## 6. Security Review Points

Before merging, verify:

1. **No direct @bsv/sdk imports** in new files (only via wrapper)
2. **All derivation paths hardened** (audit `enforceHardenedPath` calls)
3. **HKDF on all shared secrets** (no raw ECDH outputs)
4. **Random IV per encryption** (audit `randomBytes` calls)
5. **Constant-time comparisons** for auth tags and secrets
6. **Input validation** before any crypto operation
7. **Error messages don't leak sensitive data**

---

## Appendix A: BRC-78 Reference Implementation

Based on the BRC-78 specification, the encryption flow is:

```
1. Generate random keyID (32 bytes)
2. Build invoice number: "2 message encryption {base64(keyID)}"
3. senderChildPriv = derivePrivateKey(senderMasterPriv, recipientMasterPub, invoiceNumber)
4. recipientChildPub = derivePublicKey(senderMasterPriv, recipientMasterPub, invoiceNumber)
5. sharedSecret = ECDH(senderChildPriv, recipientChildPub)
6. encryptionKey = HKDF-SHA256(sharedSecret, info="BRC-78-encryption")
7. iv = randomBytes(12)
8. ciphertext = AES-256-GCM(encryptionKey, iv, plaintext)
9. output = version || senderPub || recipientPub || keyID || iv || ciphertext || authTag
```

---

**Document Version:** 1.0  
**Prepared By:** Subagent f26aa3ae  
**Last Updated:** 2026-02-07 04:35 UTC
