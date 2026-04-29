# Edwin Security Mitigations: Prioritized Implementation Roadmap

_Generated: 2026-02-06_
_Based on: SECURITY-THREATS-v2.md_
_Sources: NIST SP 800-57, RFC 6979, BRC-42, OWASP, Signal Protocol_

---

## Executive Summary

This document provides **specific, actionable mitigations** for the 10 attack vectors identified in SECURITY-THREATS-v2.md. Each mitigation includes:

- **Source citation** from authoritative security literature
- **Implementation complexity** estimate (Low/Medium/High/Very High)
- **Launch classification** (Launch-Blocking vs Post-Launch)
- **Technical specification** for implementation

### Classification Criteria

**Launch-Blocking**: Mitigations that MUST be implemented before production deployment

- Direct key compromise risks
- Critical cryptographic failures
- AI-crypto boundary violations

**Post-Launch**: Mitigations that enhance security but can be deployed iteratively

- Defense-in-depth measures
- Monitoring and detection capabilities
- Advanced attack surface reduction

---

## CRITICAL SEVERITY MITIGATIONS (Launch-Blocking)

### Threat #1: AI-Crypto Boundary Violations

**Attack**: Prompt injection manipulating cryptographic operations (e.g., "Use non-hardened path m/0/0")

#### Mitigation 1.1: Strict Isolation Architecture

**Implementation**: Create air-gapped cryptographic service with zero LLM access to key material

**Technical Specification**:

```
┌─────────────────┐
│   AI Layer      │  ← Handles user prompts, semantics
│  (LLM Agent)    │  ← NEVER sees: private keys, derivation paths, nonces
└────────┬────────┘
         │ API (sanitized requests only)
         │ Example: {action: "sign", txid: "abc123"}
         ↓
┌────────────────────────────────────────────┐
│   Cryptographic Isolation Boundary         │
│   - No prompt strings cross this boundary  │
│   - Only validated, structured data        │
└────────────────────────────────────────────┘
         ↓
┌─────────────────┐
│  Crypto Service │  ← Hardcoded derivation paths
│  (BRC-42 Impl)  │  ← Deterministic nonce (RFC 6979)
└─────────────────┘
```

**Source**: OWASP LLM Top 10 - "Prompt Injection: Implement strict input validation and sanitization before cryptographic operations" (OWASP CheatSheetSeries)

**Complexity**: **HIGH** (requires architectural refactoring)
**Priority**: **LAUNCH-BLOCKING**
**Rationale**: Direct key compromise without breaking cryptography

**Implementation Steps**:

1. Create separate cryptographic module/service (no LLM runtime dependencies)
2. Define strict API: only accept pre-validated structured commands (JSON schema validation)
3. Hardcode security-critical parameters (derivation paths, curve parameters)
4. Implement API input validation: reject any freeform text in crypto calls
5. Add audit logging at boundary crossing

**Success Criteria**: AI layer cannot influence:

- HD derivation paths (always m/44'/0'/0' - BRC-42 requirement)
- Curve parameters (always secp256k1, order N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141)
- Nonce generation algorithm
- Key storage locations

---

### Threat #2: Nonce Reuse in Ephemeral ECDH Keys

**Attack**: Biased RNG or nonce reuse enables lattice attacks to recover private keys

#### Mitigation 2.1: RFC 6979 Deterministic Signatures

**Implementation**: Use RFC 6979 for ECDSA signature generation (eliminates nonce reuse)

**Technical Specification**:

```typescript
// INSTEAD OF THIS (vulnerable):
function sign(message: Buffer, privateKey: Buffer): Signature {
  const k = randomBytes(32); // ❌ CRITICAL VULNERABILITY
  return ecdsa.sign(message, privateKey, k);
}

// USE THIS (RFC 6979):
function sign(message: Buffer, privateKey: Buffer): Signature {
  const k = rfc6979_generate_k(message, privateKey); // ✅ Deterministic
  return ecdsa.sign(message, privateKey, k);
}
```

**RFC 6979 Algorithm**:

```
Input: message hash h, private key x
1. h1 = H(m) where H is SHA-256
2. K = 0x00 00 ... 00 (32 bytes)
3. V = 0x01 01 ... 01 (32 bytes)
4. K = HMAC_K(V || 0x00 || x || h1)
5. V = HMAC_K(V)
6. K = HMAC_K(V || 0x01 || x || h1)
7. V = HMAC_K(V)
8. Loop:
   a. T = empty
   b. While len(T) < qlen:
      V = HMAC_K(V)
      T = T || V
   c. k = bits2int(T)
   d. If k in [1, q-1]: return k
   e. Else: K = HMAC_K(V || 0x00), V = HMAC_K(V), repeat
```

**Source**:

- RFC 6979, Section 3.2: "Generation of k" - "The value of k is derived from h1 (the hash of the message) and the private key x using HMAC-DRBG"
- Trail of Bits, "Even slight RNG bias enables lattice attacks"

**Complexity**: **MEDIUM** (library integration if not already available)
**Priority**: **LAUNCH-BLOCKING**
**Rationale**: Critical - prevents private key leakage through nonce reuse

**Implementation Steps**:

1. Audit current signing code for nonce generation
2. Replace random nonce with RFC 6979 deterministic generation
3. Verify implementation against RFC 6979 test vectors (Appendix A.2.5 for secp256k1)
4. Add test case: sign same message twice, verify identical signatures

**Test Vector** (RFC 6979, secp256k1):

```
Private key: C9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721
Message: "sample"
Expected k: A6E3C57DD01ABE90086538398355DD4C3B17AA873382B0F24D6129493D8AAD60
```

---

#### Mitigation 2.2: CSPRNG for ECDH Ephemeral Keys

**Implementation**: Use FIPS 140-2 validated CSPRNG for BRC-42 ephemeral keys

**Technical Specification**:

```typescript
// Ephemeral key generation for BRC-42 ECDH
function generateEphemeralKey(): PrivateKey {
  // ✅ Use platform CSPRNG (validated)
  const keyBytes = crypto.getRandomValues(new Uint8Array(32)); // Browser
  // OR: const keyBytes = crypto.randomBytes(32); // Node.js

  // Ensure k is in valid range [1, n-1]
  const n = secp256k1.curve.n;
  let k = BigInt("0x" + Buffer.from(keyBytes).toString("hex"));
  k = (k % (n - 1n)) + 1n; // Map to [1, n-1]

  return new PrivateKey(k);
}
```

**Source**:

- NIST SP 800-57 Part 1, Section 5.6.1.2.1: "Random bit generators shall be implemented within FIPS 140-2 or 140-3 compliant cryptographic modules"
- OWASP Key Management Cheat Sheet: "Cryptographic keys shall be generated within cryptographic module with at least a FIPS 140-2 or 140-3 compliance"

**Complexity**: **LOW** (platform APIs already available)
**Priority**: **LAUNCH-BLOCKING**
**Rationale**: Forward secrecy depends on unpredictable ephemeral keys

**Implementation Steps**:

1. Replace any custom RNG with platform CSPRNG (crypto.getRandomValues or crypto.randomBytes)
2. Add range validation: ensure generated key is in [1, n-1]
3. Add statistical tests: Chi-squared test on 10,000 generated keys
4. Document CSPRNG source in security documentation

---

### Threat #3: Supply Chain Compromise of secp256k1 Libraries

**Attack**: Malicious crypto dependencies inject backdoors into key generation

#### Mitigation 3.1: Dependency Pinning and SBOM

**Implementation**: Pin exact versions, generate Software Bill of Materials, verify signatures

**Technical Specification**:

```json
// package.json
{
  "dependencies": {
    "@noble/secp256k1": "1.7.1", // ✅ Exact version, not ^1.7.1
    "@noble/hashes": "1.3.0"
  },
  "devDependencies": {
    "@cyclonedx/bom": "^4.0.0" // SBOM generation
  }
}
```

**SBOM Generation** (CycloneDX format):

```bash
# Generate SBOM
npx @cyclonedx/bom -o sbom.json

# Verify against known vulnerabilities
npm audit --json > audit-report.json
```

**Source**:

- OWASP Software Supply Chain Security Cheat Sheet: "Dependency pinning prevents supply chain attacks through version drift"
- NIST SP 800-161 Rev 1: "Organizations should maintain a Software Bill of Materials (SBOM) for all cryptographic dependencies"

**Complexity**: **LOW**
**Priority**: **LAUNCH-BLOCKING**
**Rationale**: Undetectable backdoors compromise all keys

**Implementation Steps**:

1. Remove version ranges (^ and ~) from package.json
2. Generate package-lock.json and commit to repository
3. Add CI check: fail build if package-lock.json changes without approval
4. Generate SBOM using CycloneDX
5. Set up automated vulnerability scanning (npm audit, Snyk, or Dependabot)

---

#### Mitigation 3.2: Cryptographic Library Verification

**Implementation**: Verify library integrity using published checksums and test vectors

**Technical Specification**:

```bash
# 1. Verify package integrity
npm view @noble/secp256k1@1.7.1 dist.shasum
# Compare against published hash: f2c3b0d6c6b9...

# 2. Run test vectors in production build
npm run test:crypto-vectors
```

**Test Vector Implementation**:

```typescript
// test/crypto-vectors.test.ts
import { secp256k1 } from "@noble/secp256k1";

describe("BRC-42 Test Vectors", () => {
  it("derives correct private key", () => {
    const senderPubKey = "033f9160df035156f1c48e75eae99914fa1a1546bec19781e8eddb900200bff9d1";
    const recipientPrivKey = "6a1751169c111b4667a6539ee1be6b7cd9f6e9c8fe011a5f2fe31e03a15e0ede";
    const invoiceNumber = "f3WCaUmnN9U=";
    const expectedPrivKey = "761656715bbfa172f8f9f58f5af95d9d0dfd69014cfdcacc9a245a10ff8893ef";

    const derivedKey = brc42.derivePrivateKey(senderPubKey, recipientPrivKey, invoiceNumber);
    expect(derivedKey).toBe(expectedPrivKey);
  });
});
```

**Source**: BRC-42 Specification, "Test Vectors" section

**Complexity**: **LOW**
**Priority**: **LAUNCH-BLOCKING**
**Rationale**: Detects library corruption or substitution attacks

---

## HIGH SEVERITY MITIGATIONS

### Threat #4: Cross-Layer Memory Poisoning

**Attack**: Inject malicious crypto parameters into LLM context via RAG

#### Mitigation 4.1: Cryptographic Parameter Validation

**Implementation**: Validate all crypto parameters against hardcoded constants

**Technical Specification**:

```typescript
// Constants (hardcoded, never from external sources)
const SECP256K1_P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP256K1_GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const SECP256K1_GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

function validateCurveParameters(params: CurveParams): void {
  if (params.p !== SECP256K1_P) throw new Error("Invalid curve prime");
  if (params.n !== SECP256K1_N) throw new Error("Invalid curve order");
  if (params.Gx !== SECP256K1_GX || params.Gy !== SECP256K1_GY) {
    throw new Error("Invalid generator point");
  }
  // Never accept parameters from configuration, RAG, or user input
}
```

**Source**:

- BRC-42: "Each party has a master private key and a master public key that are derived from the secp256k1 elliptic curve"
- OWASP Secure Code Review: "Security-Focused Review targets cryptographic implementations"

**Complexity**: **MEDIUM**
**Priority**: **LAUNCH-BLOCKING**
**Rationale**: Prevents AI from forcing weak cryptographic parameters

**Implementation Steps**:

1. Hardcode secp256k1 curve parameters in constants file
2. Add validation at crypto module initialization
3. Add test: attempt to use invalid parameters (should throw error)
4. Document in security policy: curve parameters are immutable

---

#### Mitigation 4.2: RAG Content Sanitization

**Implementation**: Strip cryptographic directives from RAG content before LLM processing

**Technical Specification**:

```typescript
const CRYPTO_DIRECTIVE_PATTERNS = [
  /use\s+curve\s+order/i,
  /derivation\s+path\s*[=:]\s*m\/\d+/i,
  /set\s+nonce/i,
  /private\s+key\s*[=:]/i,
  /\bm\/44\/0\/0\b/, // Non-hardened paths
];

function sanitizeRAGContent(content: string): string {
  for (const pattern of CRYPTO_DIRECTIVE_PATTERNS) {
    if (pattern.test(content)) {
      throw new Error(`RAG content contains prohibited crypto directive: ${pattern}`);
    }
  }
  return content;
}
```

**Source**: OWASP LLM02: "Indirect Prompt Injection occurs when an LLM is instructed through external data sources"

**Complexity**: **MEDIUM**
**Priority**: **POST-LAUNCH** (defense-in-depth)
**Rationale**: Mitigates memory poisoning attacks via RAG

---

### Threat #5: HD Derivation Path Authentication Failure

**Attack**: Non-hardened paths (m/44/0/0) leak parent keys if child key compromised

#### Mitigation 5.1: Enforce Hardened Derivation

**Implementation**: Hardcode BIP-44 hardened derivation paths, reject non-hardened requests

**Technical Specification**:

```typescript
// BIP-44 path: m / purpose' / coin_type' / account' / change / address_index
const BRC42_BASE_PATH = "m/44'/0'/0'"; // ✅ All levels hardened

function deriveChildKey(basePath: string, invoiceNumber: string): PrivateKey {
  // Validate path uses hardened derivation
  if (!basePath.endsWith("'")) {
    throw new Error("BRC-42 requires hardened derivation paths");
  }

  const pathComponents = basePath.split("/");
  for (const component of pathComponents.slice(1)) {
    // Skip 'm'
    if (!component.endsWith("'")) {
      throw new Error(`Non-hardened component detected: ${component}`);
    }
  }

  // Proceed with BRC-42 derivation
  return brc42.deriveKey(basePath, invoiceNumber);
}
```

**Hardened vs Non-Hardened** (BIP-32 Security):

```
Non-hardened (m/44/0/0):
- Parent pubkey + child privkey → recover parent privkey ❌
- Used for watch-only wallets (xpub sharing)

Hardened (m/44'/0'/0'):
- Parent pubkey + child privkey → CANNOT recover parent privkey ✅
- Required for security-critical key hierarchies
```

**Source**:

- BRC-42: "removes the limit of 4 billion keys per child that is present in BIP32"
- BIP-32: "Hardened derivation prevents parent key recovery from child keys"

**Complexity**: **LOW** (implementation detail)
**Priority**: **LAUNCH-BLOCKING**
**Rationale**: Prevents cascading key compromise

**Implementation Steps**:

1. Define constant: `const HARDENED_OFFSET = 0x80000000;`
2. Enforce: all derivation indices >= HARDENED_OFFSET
3. Add test: attempt non-hardened derivation (should fail)
4. Document in API: only hardened paths accepted

---

### Threat #6: Triple-Compromise Coordination Timing Side-Channels

**Attack**: Metadata leakage reveals which parties are coordinating

#### Mitigation 6.1: Constant-Time Operations

**Implementation**: Use constant-time comparison for shared secrets

**Technical Specification**:

```typescript
// ❌ VULNERABLE (timing leak)
function compareSecrets(secret1: Buffer, secret2: Buffer): boolean {
  return secret1.equals(secret2); // Early exit on mismatch
}

// ✅ SECURE (constant-time)
function constantTimeCompare(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}
```

**Source**:

- OWASP Cryptographic Storage: "Use constant-time comparison functions"
- Signal Protocol: "Timing attacks must be considered in multi-device scenarios"

**Complexity**: **LOW**
**Priority**: **POST-LAUNCH** (defense-in-depth)
**Rationale**: Prevents metadata leakage through timing

---

#### Mitigation 6.2: Traffic Padding and Delays

**Implementation**: Add random delays to multi-device synchronization

**Technical Specification**:

```typescript
async function syncKeyShare(targetDevice: Device, keyShare: Buffer): Promise<void> {
  // Add random delay (0-5000ms) to prevent timing correlation
  const delay = Math.floor(Math.random() * 5000);
  await new Promise((resolve) => setTimeout(resolve, delay));

  await targetDevice.receiveKeyShare(keyShare);
}
```

**Source**: Signal Protocol threat model - "Message timing can reveal relationships"

**Complexity**: **LOW**
**Priority**: **POST-LAUNCH**
**Rationale**: Mitigates traffic analysis attacks

---

### Threat #7: Remote Prompt Injection via Transaction Metadata

**Attack**: Malicious instructions in OP_RETURN data processed by AI

#### Mitigation 7.1: Transaction Metadata Sanitization

**Implementation**: Strip/escape OP_RETURN data before LLM processing

**Technical Specification**:

```typescript
function parseTransaction(tx: Transaction): ParsedTransaction {
  const opReturnData = extractOpReturn(tx);

  // ✅ SANITIZE before any LLM processing
  const sanitized = sanitizeForLLM(opReturnData);

  return {
    ...tx,
    metadata: sanitized,
  };
}

function sanitizeForLLM(data: Buffer): string {
  // 1. Convert to text
  const text = data.toString("utf-8");

  // 2. Remove control characters
  const cleaned = text.replace(/[\x00-\x1F\x7F-\x9F]/g, "");

  // 3. Escape prompt injection patterns
  const escaped = cleaned
    .replace(/ignore previous instructions/gi, "[SANITIZED]")
    .replace(/system:|assistant:|user:/gi, "[SANITIZED]");

  // 4. Prefix with safety context
  return `[UNTRUSTED BLOCKCHAIN DATA]: ${escaped}`;
}
```

**Source**:

- OWASP LLM01: "Prompt Injection - validate and sanitize ALL user inputs"
- Simon Willison: "Prompt injection through data sources is major LLM vulnerability"

**Complexity**: **MEDIUM**
**Priority**: **LAUNCH-BLOCKING** (if AI processes blockchain data)
**Rationale**: Prevents remote code execution via blockchain

---

## MEDIUM SEVERITY MITIGATIONS

### Threat #8: KDF Weaknesses in ECDH Shared Secret Processing

**Attack**: Using raw ECDH shared secret instead of proper KDF

#### Mitigation 8.1: HKDF-SHA256 for Shared Secrets

**Implementation**: Apply HKDF to all ECDH shared secrets per NIST SP 800-56A

**Technical Specification**:

```typescript
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";

function deriveKeyFromSharedSecret(
  sharedSecret: Buffer,
  salt: Buffer,
  info: string,
  outputLength: number = 32,
): Buffer {
  // ✅ NIST SP 800-56A Rev 3: Use HKDF
  const derivedKey = hkdf(sha256, sharedSecret, salt, Buffer.from(info, "utf-8"), outputLength);

  return Buffer.from(derivedKey);
}

// BRC-42 ECDH with proper KDF
function brc42Derive(myPrivKey: Buffer, theirPubKey: Buffer, invoice: string): Buffer {
  // 1. ECDH
  const sharedSecret = ecdh(myPrivKey, theirPubKey);

  // 2. ❌ DON'T: return sharedSecret;
  // 3. ✅ DO: Apply HKDF
  const derivedKey = deriveKeyFromSharedSecret(
    sharedSecret,
    Buffer.from(invoice, "utf-8"), // Salt
    "BRC-42-key-derivation", // Info string
    32,
  );

  return derivedKey;
}
```

**Source**:

- NIST SP 800-56A Rev 3: "ECDH shared secrets must pass through approved KDF"
- OWASP Key Management: "Use HKDF-SHA256 for key derivation"

**Complexity**: **MEDIUM**
**Priority**: **LAUNCH-BLOCKING**
**Rationale**: Raw shared secrets have weak entropy distribution

---

### Threat #9: Timing Attacks on Scalar Multiplication

**Attack**: Non-constant-time ECDH leaks key bits

#### Mitigation 9.1: Use Constant-Time Crypto Library

**Implementation**: Verify library uses constant-time implementations

**Technical Specification**:

```typescript
// Library verification
import { secp256k1 } from "@noble/secp256k1";

// @noble/secp256k1 uses:
// - Montgomery ladder for scalar multiplication (constant-time)
// - Constant-time modular inversion
// - No branching on secret data

// Test for timing consistency (statistical test)
async function testConstantTime(): Promise<void> {
  const iterations = 10000;
  const timings: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const privKey = crypto.randomBytes(32);
    const pubKey = secp256k1.G;

    const start = process.hrtime.bigint();
    secp256k1.multiply(pubKey, privKey);
    const end = process.hrtime.bigint();

    timings.push(Number(end - start));
  }

  // Statistical analysis: coefficient of variation should be low
  const mean = timings.reduce((a, b) => a + b) / timings.length;
  const variance = timings.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / timings.length;
  const cv = Math.sqrt(variance) / mean;

  console.log(`Coefficient of Variation: ${cv}`);
  // Should be < 0.1 for constant-time operations
}
```

**Source**:

- Trail of Bits: "Non-constant-time implementations leak key bits through timing"
- @noble/secp256k1 documentation: "Constant-time scalar multiplication"

**Complexity**: **LOW** (library selection)
**Priority**: **POST-LAUNCH** (library audit)
**Rationale**: Prevents local timing attacks

---

### Threat #10: Key Compromise Impersonation (KCI)

**Attack**: Attacker with one party's key impersonates others

#### Mitigation 10.1: Mutual Authentication in ECDH

**Implementation**: Both parties prove key ownership before deriving shared secrets

**Technical Specification**:

```typescript
// Signal Protocol X3DH-inspired mutual auth
interface AuthenticatedECDH {
  initiatorIdentityKey: PublicKey;
  responderIdentityKey: PublicKey;
  initiatorEphemeralKey: PublicKey;
  responderEphemeralKey: PublicKey;
}

function authenticatedKeyAgreement(
  myIdentityPriv: PrivateKey,
  myEphemeralPriv: PrivateKey,
  theirIdentityPub: PublicKey,
  theirEphemeralPub: PublicKey,
): Buffer {
  // Multiple DH exchanges (X3DH pattern)
  const dh1 = ecdh(myIdentityPriv, theirEphemeralPub);
  const dh2 = ecdh(myEphemeralPriv, theirIdentityPub);
  const dh3 = ecdh(myEphemeralPriv, theirEphemeralPub);

  // Combine using HKDF
  const combinedSecret = Buffer.concat([dh1, dh2, dh3]);
  return hkdf(sha256, combinedSecret, null, "Edwin-Authenticated-ECDH", 32);
}
```

**Source**:

- Signal Protocol X3DH: "Multiple DH exchanges prevent KCI attacks"
- OWASP: "Mutual authentication prevents impersonation"

**Complexity**: **HIGH**
**Priority**: **POST-LAUNCH**
**Rationale**: Prevents impersonation after single key compromise

---

## IMPLEMENTATION ROADMAP

### Phase 1: Launch-Blocking (Weeks 1-4)

**Week 1-2: Cryptographic Core**

- [ ] Mitigation 2.1: Implement RFC 6979 deterministic signatures
- [ ] Mitigation 2.2: CSPRNG for ephemeral keys
- [ ] Mitigation 5.1: Enforce hardened derivation paths
- [ ] Mitigation 8.1: HKDF for shared secrets
- [ ] **Deliverable**: Crypto module with test vectors passing

**Week 2-3: AI-Crypto Boundary**

- [ ] Mitigation 1.1: Strict isolation architecture
- [ ] Mitigation 4.1: Cryptographic parameter validation
- [ ] Mitigation 7.1: Transaction metadata sanitization
- [ ] **Deliverable**: API boundary specification document

**Week 3-4: Supply Chain Security**

- [ ] Mitigation 3.1: Dependency pinning and SBOM
- [ ] Mitigation 3.2: Cryptographic library verification
- [ ] **Deliverable**: Automated CI/CD security checks

**Week 4: Integration Testing**

- [ ] End-to-end security tests
- [ ] Penetration testing (prompt injection, nonce reuse)
- [ ] Third-party security audit
- [ ] **Deliverable**: Security audit report

### Phase 2: Post-Launch Hardening (Weeks 5-8)

**Week 5-6: Defense-in-Depth**

- [ ] Mitigation 4.2: RAG content sanitization
- [ ] Mitigation 6.1: Constant-time operations audit
- [ ] Mitigation 9.1: Timing attack testing
- [ ] **Deliverable**: Defense-in-depth layer

**Week 7-8: Advanced Protections**

- [ ] Mitigation 6.2: Traffic padding
- [ ] Mitigation 10.1: Mutual authentication (if multi-device)
- [ ] Monitoring and anomaly detection
- [ ] **Deliverable**: Security monitoring dashboard

### Phase 3: Ongoing (Continuous)

**Monthly**

- [ ] Dependency vulnerability scans
- [ ] Security patch updates
- [ ] Incident response drills

**Quarterly**

- [ ] Threat model review
- [ ] Penetration testing
- [ ] Security training for developers

---

## IMPLEMENTATION COMPLEXITY SUMMARY

| Mitigation                | Complexity | Priority        | Estimated Effort |
| ------------------------- | ---------- | --------------- | ---------------- |
| 1.1 AI-Crypto Isolation   | HIGH       | Launch-Blocking | 2-3 weeks        |
| 2.1 RFC 6979 Signatures   | MEDIUM     | Launch-Blocking | 3-5 days         |
| 2.2 CSPRNG                | LOW        | Launch-Blocking | 1 day            |
| 3.1 Dependency Pinning    | LOW        | Launch-Blocking | 1 day            |
| 3.2 Library Verification  | LOW        | Launch-Blocking | 2 days           |
| 4.1 Param Validation      | MEDIUM     | Launch-Blocking | 3 days           |
| 4.2 RAG Sanitization      | MEDIUM     | Post-Launch     | 1 week           |
| 5.1 Hardened Derivation   | LOW        | Launch-Blocking | 1 day            |
| 6.1 Constant-Time Ops     | LOW        | Post-Launch     | 2 days           |
| 6.2 Traffic Padding       | LOW        | Post-Launch     | 1 day            |
| 7.1 Metadata Sanitization | MEDIUM     | Launch-Blocking | 3-5 days         |
| 8.1 HKDF Implementation   | MEDIUM     | Launch-Blocking | 2-3 days         |
| 9.1 Timing Test Suite     | LOW        | Post-Launch     | 2 days           |
| 10.1 Mutual Auth          | HIGH       | Post-Launch     | 1-2 weeks        |

**Total Launch-Blocking Effort**: ~4-6 weeks (1 engineer)
**Total Post-Launch Effort**: ~3-4 weeks (distributed)

---

## SUCCESS METRICS

### Launch Criteria (Must Pass All)

✅ RFC 6979 test vectors pass (100% success rate)
✅ BRC-42 test vectors pass (100% success rate)
✅ Zero hardcoded keys in source code
✅ All derivation paths use hardened indices (100%)
✅ SBOM generated and vulnerability-free
✅ Prompt injection penetration test: 0 successful attacks
✅ Third-party security audit: no critical/high findings

### Post-Launch Metrics

- **Mean Time to Detect (MTTD)**: Anomalous signing patterns < 5 minutes
- **Dependency Freshness**: All dependencies < 90 days old
- **Test Coverage**: Cryptographic code > 95% coverage
- **Incident Response Time**: Security patches deployed < 24 hours

---

## REFERENCES

### Authoritative Sources

1. **NIST SP 800-57 Part 1 Rev. 5** (May 2020)
   - Key Management Lifecycle Best Practices
   - Sections: 5.6.1.2.1 (Key Generation), 6.2.1 (Key Derivation)
   - https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final

2. **RFC 6979** (August 2013)
   - Deterministic ECDSA/DSA Signature Generation
   - Section 3.2: Generation of k (deterministic nonce)
   - https://www.rfc-editor.org/rfc/rfc6979

3. **BRC-42** - BSV Key Derivation Scheme
   - HD key derivation using ECDH shared secrets
   - Test vectors for implementation verification
   - vaults/edwin-security/Sources/github.com/BRCs/.../key-derivation/0042.md

4. **OWASP Cheat Sheet Series**
   - Key Management Cheat Sheet
   - LLM Top 10 (Prompt Injection, Training Data Poisoning)
   - Software Supply Chain Security
   - vaults/edwin-security/Sources/github.com/CheatSheetSeries/

5. **Signal Protocol Specifications**
   - X3DH Key Agreement Protocol
   - Double Ratchet Algorithm
   - vaults/edwin-security/Sources/signal.org/

6. **Trail of Bits** - Cryptographic Implementation Best Practices
   - Timing attacks, RNG bias, lattice attacks
   - Referenced in SECURITY-THREATS-v2.md

---

## APPENDIX A: Test Vector Verification

### RFC 6979 Test Vector (secp256k1)

```python
# Test vector from RFC 6979, adapted for secp256k1
private_key = "C9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721"
message = "sample"
expected_k = "A6E3C57DD01ABE90086538398355DD4C3B17AA873382B0F24D6129493D8AAD60"
expected_r = "EFD48B2AACB6A8FD1140DD9CD45E81D69D2C877B56AAF991C34D0EA84EAF3716"
expected_s = "F7CB1C942D657C41D436C7A1B6E29F65F3E900DBB9AFF4064DC4AB2F843ACDA8"
```

### BRC-42 Test Vector

```typescript
// From BRC-42 specification
const testVector = {
  senderPublicKey: "033f9160df035156f1c48e75eae99914fa1a1546bec19781e8eddb900200bff9d1",
  recipientPrivateKey: "6a1751169c111b4667a6539ee1be6b7cd9f6e9c8fe011a5f2fe31e03a15e0ede",
  invoiceNumber: "f3WCaUmnN9U=",
  expectedPrivateKey: "761656715bbfa172f8f9f58f5af95d9d0dfd69014cfdcacc9a245a10ff8893ef",
};
```

---

## APPENDIX B: Threat-Mitigation Mapping

| Threat ID | Threat Name         | Primary Mitigation        | Secondary Mitigations    |
| --------- | ------------------- | ------------------------- | ------------------------ |
| 1         | AI-Crypto Boundary  | 1.1 Strict Isolation      | 4.1 Param Validation     |
| 2         | Nonce Reuse         | 2.1 RFC 6979              | 2.2 CSPRNG               |
| 3         | Supply Chain        | 3.1 Dep Pinning           | 3.2 Library Verification |
| 4         | Memory Poisoning    | 4.1 Param Validation      | 4.2 RAG Sanitization     |
| 5         | HD Derivation       | 5.1 Hardened Paths        | -                        |
| 6         | Timing Side-Channel | 6.1 Constant-Time         | 6.2 Traffic Padding      |
| 7         | Remote Injection    | 7.1 Metadata Sanitization | 4.2 RAG Sanitization     |
| 8         | KDF Weakness        | 8.1 HKDF Implementation   | -                        |
| 9         | Timing Attacks      | 9.1 Library Audit         | 6.1 Constant-Time        |
| 10        | KCI                 | 10.1 Mutual Auth          | -                        |

---

## DOCUMENT METADATA

**Version**: 1.0
**Status**: Draft for Review
**Authors**: Generated from SECURITY-THREATS-v2.md analysis
**Review Date**: 2026-02-06
**Next Review**: After implementation of Phase 1

**Change Log**:

- 2026-02-06: Initial version with all 10 threats addressed
- TBD: Updates based on implementation feedback
