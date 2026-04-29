# EdwinPAI Security Mitigations

Specific mitigations for each threat identified in SECURITY-THREATS.md, with severity ratings, BRC references, implementation complexity, and launch-blocking priority.

---

## Priority Classification

- **MUST-HAVE-FOR-LAUNCH (P0):** Critical vulnerabilities that could compromise entire system. No launch without these.
- **SHOULD-HAVE-FOR-LAUNCH (P1):** High-severity issues. Acceptable temporary risk with monitoring, but ship within 30 days.
- **POST-LAUNCH (P2/P3):** Medium/low severity. Address in subsequent releases.

---

## CRITICAL Severity Threats

### Threat 1.2: ECDSA Nonce Weakness

**Severity:** CRITICAL  
**Priority:** MUST-HAVE-FOR-LAUNCH (P0)

**Mitigation Approach:**

1. **RFC 6979 Deterministic Nonces**
   - Generate k = HMAC_DRBG(private_key, message_hash)
   - Eliminates RNG dependency
   - Same inputs → same signature → consistent, safe
   - **BRC Reference:** Not specified in BRC-3, but compatible

2. **Nonce Verification Layer**
   - Before signing, verify k is not previously used
   - Maintain nonce usage log
   - Reject signing request if collision detected

3. **Hardware RNG with Entropy Pool**
   - If not using RFC 6979, require hardware entropy
   - Mix multiple entropy sources
   - Continuous entropy health checks

**Implementation:**

```typescript
// Use deterministic nonces per RFC 6979
import { signWithRFC6979 } from "secp256k1-rfc6979";

function signMessage(message: Buffer, privateKey: Buffer): Signature {
  // RFC 6979 guarantees unique k per (privateKey, message) pair
  return signWithRFC6979(message, privateKey);
}
```

**Complexity:** EASY  
**Launch Blocking:** YES - Critical vulnerability, well-understood fix

---

### Threat 3.1: Signed Content Injection (Prompt Injection in Legitimate Commands)

**Severity:** CRITICAL  
**Priority:** MUST-HAVE-FOR-LAUNCH (P0)

**Mitigation Approach:**

1. **Structured Command Format**
   - Separate command opcode from content payload
   - Command metadata never interpreted as instruction
   - Content explicitly marked as untrusted data

**Command Structure:**

```typescript
interface SignedCommand {
  version: string;
  command: {
    opcode: CommandType; // ENUM: "summarize", "search", "send", etc.
    parameters: {
      // Structured, not free-text
      target?: string;
      constraints?: object;
    };
  };
  untrustedContent?: {
    // CLEARLY MARKED
    type: "document" | "email" | "url";
    data: string; // NEVER parse as instructions
  };
  signature: BRC3Signature;
}
```

2. **Content Sandboxing**
   - Process untrusted content in isolated context
   - No tool access during content analysis
   - Results are data, not commands

3. **Output Filtering**
   - Scan generated responses for command-like patterns
   - Block or flag outputs that appear to be instructions
   - Require re-confirmation for high-risk actions

4. **Capability-Based Permissions**
   - Each command opcode has explicit capability requirements
   - Content processing has NO capabilities
   - Defense in depth: even if injection succeeds, no capabilities

**Complexity:** MEDIUM  
**Launch Blocking:** YES - Primary AI-specific threat

---

### Threat 6.1: Malicious EdwinPAI Build

**Severity:** CRITICAL  
**Priority:** MUST-HAVE-FOR-LAUNCH (P0)

**Mitigation Approach:**

1. **Reproducible Builds**
   - Deterministic build from source
   - Multiple parties can verify binary matches source
   - Document build environment exactly

2. **Code Signing**
   - Sign all releases with organization key
   - Verify signature before loading
   - Fail closed if signature invalid

3. **Transparency Log**
   - Publish all release hashes to append-only log
   - Similar to Certificate Transparency
   - Detect if different binaries distributed to different users

4. **Runtime Integrity Checks**
   - Verify own hash on startup
   - Detect tampering via memory scanning
   - Secure boot chain where possible

**Implementation:**

```bash
# Build verification
sha256sum edwin-binary > expected-hash
gpg --verify edwin-binary.sig edwin-binary

# Transparency log check
curl https://transparency.edwinpai.com/verify?hash=$HASH
```

**Complexity:** HARD  
**Launch Blocking:** YES - But can start with code signing, add reproducible builds later

---

## HIGH Severity Threats

### Threat 2.2: MITM During Initial Key Exchange

**Severity:** HIGH  
**Priority:** SHOULD-HAVE-FOR-LAUNCH (P1)

**Mitigation Approach:**

1. **Pre-Shared Trust Anchor**
   - EdwinPAI server's public key embedded in client
   - Or fetched from DNS (DNSSEC) / blockchain
   - **BRC Reference:** BRC-103 Section 6.1 - nonce-based mutual auth

2. **Certificate-Based Bootstrap**
   - EdwinPAI server has certificate from trusted CA
   - User's first interaction verifies server cert
   - Then establishes BRC-42 shared secret

3. **Out-of-Band Verification**
   - Display fingerprint of shared secret
   - User verifies via separate channel (QR code, voice)
   - Similar to Signal's "safety number"

**Implementation:**

```typescript
// Embed server's expected identity key
const EDWINPAI_SERVER_IDENTITY = "02abc123...";

function verifyServerIdentity(receivedKey: string): boolean {
  if (receivedKey !== EDWINPAI_SERVER_IDENTITY) {
    throw new SecurityError("Server identity mismatch - possible MITM");
  }
  return true;
}
```

**Complexity:** EASY  
**Launch Blocking:** SHOULD - Can launch with embedded key, add TOFU later

---

### Threat 4.4: Insecure Key Storage in Wallet

**Severity:** HIGH  
**Priority:** SHOULD-HAVE-FOR-LAUNCH (P1)

**Mitigation Approach:**

1. **Wallet Security Requirements**
   - Document minimum security requirements for wallets
   - Only support BRC-100 compliant wallets
   - Refuse to enroll with known-insecure wallets

2. **Hardware Wallet Support**
   - Prioritize hardware wallet integration
   - Keys never leave secure element
   - **BRC Reference:** BRC-100 compatible with hardware implementations

3. **Key Isolation Recommendations**
   - Recommend separate wallet for EdwinPAI
   - Limit blast radius if wallet compromised
   - Not cross-contaminate with financial keys

4. **Detection of Compromised Wallets**
   - Monitor for signing from unexpected locations
   - Rate limiting on signature requests
   - Anomaly detection on usage patterns

**Complexity:** MEDIUM  
**Launch Blocking:** PARTIAL - Launch with requirements doc, full enforcement later

---

### Threat 3.2: Tool Abuse via Command Semantics

**Severity:** HIGH  
**Priority:** SHOULD-HAVE-FOR-LAUNCH (P1)

**Mitigation Approach:**

1. **Explicit Action Confirmation**
   - High-risk actions require explicit parameter confirmation
   - "You are about to delete 47 files. Confirm: [list]"
   - No implicit interpretations of vague commands

2. **Capability Scoping**
   - Each session/command has explicit capability set
   - Commands cannot exceed granted capabilities
   - User must explicitly grant dangerous capabilities

3. **Action Preview**
   - Before execution, show exactly what will happen
   - Require confirmation for irreversible actions
   - Log all action previews vs executions

4. **Semantic Parsing Limits**
   - Refuse to interpret ambiguous commands
   - Request clarification rather than guess
   - Err on side of doing less, not more

**Implementation:**

```typescript
interface ActionPlan {
  interpretation: string; // How EdwinPAI understood command
  plannedActions: Action[]; // Exactly what will happen
  capabilities: Capability[]; // What permissions required
  reversible: boolean; // Can this be undone?
}

// Require confirmation for non-reversible high-capability actions
if (!plan.reversible && plan.capabilities.includes("delete")) {
  await requireUserConfirmation(plan);
}
```

**Complexity:** MEDIUM  
**Launch Blocking:** SHOULD - At least confirmation for dangerous actions

---

### Threat 3.3: Memory Poisoning

**Severity:** HIGH  
**Priority:** SHOULD-HAVE-FOR-LAUNCH (P1)

**Mitigation Approach:**

1. **Signed Memory Entries**
   - Every memory write signed by source
   - Memory from user signed by user's wallet
   - Memory from EdwinPAI signed by EdwinPAI
   - Detect unsigned/forged entries

2. **Memory Integrity Verification**
   - Periodic hash of entire memory state
   - Compare against known-good snapshots
   - Alert on unexpected changes

3. **Memory Access Control**
   - Separate trusted vs untrusted memory
   - External inputs → untrusted compartment
   - Critical data (passwords, keys) → verified-only compartment

4. **Memory Provenance Tracking**
   - Record source of each memory entry
   - Display provenance when serving data
   - "This information came from [source] on [date]"

**Implementation:**

```typescript
interface MemoryEntry {
  content: string;
  source: "user" | "edwin" | "external";
  timestamp: ISOString;
  signature?: BRC3Signature; // Required for trusted sources
  trustLevel: "verified" | "unverified";
}
```

**Complexity:** MEDIUM  
**Launch Blocking:** SHOULD - Implement signed entries for critical data

---

### Threat 6.2: Dependency Poisoning

**Severity:** HIGH  
**Priority:** SHOULD-HAVE-FOR-LAUNCH (P1)

**Mitigation Approach:**

1. **Dependency Pinning**
   - Lock all dependencies to exact versions
   - Include hash verification in lockfile
   - No floating versions in production

2. **Minimal Dependencies**
   - Audit dependency tree
   - Remove unused dependencies
   - Prefer well-audited libraries

3. **Vendor Critical Dependencies**
   - Copy critical crypto libraries into repo
   - Verify against known-good versions
   - Immune to registry attacks

4. **Continuous Monitoring**
   - Subscribe to security advisories for all deps
   - Automated vulnerability scanning
   - Rapid patching process

**Implementation:**

```json
// package-lock.json with integrity hashes
{
  "dependencies": {
    "secp256k1": {
      "version": "4.0.3",
      "resolved": "https://registry.npmjs.org/secp256k1/-/secp256k1-4.0.3.tgz",
      "integrity": "sha512-Abc123..."
    }
  }
}
```

**Complexity:** EASY  
**Launch Blocking:** YES - Basic hygiene, low effort

---

### Threat 1.1: Invoice Number Prediction (BRC-42 Derivation Path)

**Severity:** HIGH  
**Priority:** SHOULD-HAVE-FOR-LAUNCH (P1)

**Mitigation Approach:**

1. **Random Invoice Components**
   - Include random bytes in invoice number
   - `invoice = f"{purpose}-{counter}-{random_bytes.hex()}"`
   - Prevents prediction even if pattern known

2. **Encrypted Invoice Numbers**
   - Derive invoice using HKDF with session-specific salt
   - Observer cannot link invoices to derivation paths
   - **BRC Reference:** Compatible with BRC-42 string invoice format

3. **Counter + Random Hybrid**
   - Monotonic counter prevents replay
   - Random component prevents prediction
   - Best of both approaches

**Implementation:**

```typescript
function generateInvoice(counter: number): string {
  const random = crypto.randomBytes(16).toString("hex");
  const timestamp = Date.now();
  return `edwin-${counter}-${timestamp}-${random}`;
}
```

**Complexity:** EASY  
**Launch Blocking:** SHOULD - Simple change with significant benefit

---

### Threat 2.1: Replay Attacks Past Nonce Window

**Severity:** HIGH (potential), but LOW likelihood  
**Priority:** SHOULD-HAVE-FOR-LAUNCH (P1)

**Mitigation Approach:**

1. **Persistent Monotonic Counter**
   - Never reset, even across restarts
   - Stored in durable storage
   - Reject any command with counter ≤ last_seen

2. **Absolute Timestamp Binding**
   - Include wall-clock time in signed data
   - Reject if timestamp > threshold from current time
   - Prevents replay after window regardless of counter

3. **Session Binding**
   - Each session has unique session_id
   - Commands bound to session
   - Replay in different session fails

**Implementation:**

```typescript
interface SignedCommand {
  counter: number; // Must be > last_seen_counter
  timestamp: ISOTimestamp; // Must be within ±5 minutes
  sessionId: string; // Must match active session
  // ...
}

function validateFreshness(cmd: SignedCommand): boolean {
  if (cmd.counter <= lastSeenCounter) return false;
  if (Math.abs(Date.now() - cmd.timestamp) > 5 * 60 * 1000) return false;
  if (cmd.sessionId !== activeSession.id) return false;
  return true;
}
```

**Complexity:** EASY  
**Launch Blocking:** YES - Already partially implemented per SECURITY.md

---

## MEDIUM Severity Threats

### Threat 1.3: Timing Side Channels

**Severity:** MEDIUM  
**Priority:** POST-LAUNCH (P2)

**Mitigation:**

- Use constant-time crypto implementations
- Add random delays to observable operations
- Don't expose precise timing in responses

**Complexity:** MEDIUM  
**Launch Blocking:** NO - Requires specialized attack, low immediate risk

---

### Threat 1.4: Invalid Curve Attack

**Severity:** MEDIUM  
**Priority:** POST-LAUNCH (P2)

**Mitigation:**

- Validate all incoming points are on curve
- Use libraries with built-in validation
- **BRC Reference:** Use validated secp256k1 implementations

**Complexity:** EASY  
**Launch Blocking:** NO - Most libraries already do this

---

### Threat 5.1: Interaction Pattern Fingerprinting

**Severity:** MEDIUM  
**Priority:** POST-LAUNCH (P3)

**Mitigation:**

- Pad messages to fixed sizes
- Add random delays
- Use cover traffic

**Complexity:** MEDIUM  
**Launch Blocking:** NO - Privacy enhancement, not security critical

---

### Threat 5.3: Server as Observation Point

**Severity:** MEDIUM  
**Priority:** POST-LAUNCH (P2)

**Mitigation:**

- End-to-end encryption for command content
- Minimize server-side logging
- User-controlled data retention policies

**Complexity:** MEDIUM  
**Launch Blocking:** NO - Trust model accepts server sees commands

---

## Summary: Launch Checklist

### MUST-HAVE (P0) - BLOCKING

| #   | Threat                   | Mitigation                              | Status  |
| --- | ------------------------ | --------------------------------------- | ------- |
| 1   | ECDSA Nonce Weakness     | RFC 6979 deterministic nonces           | ⬜ TODO |
| 2   | Signed Content Injection | Structured commands, content sandboxing | ⬜ TODO |
| 3   | Malicious Build          | Code signing (minimum)                  | ⬜ TODO |

### SHOULD-HAVE (P1) - SHIP WITHIN 30 DAYS

| #   | Threat               | Mitigation                            | Status  |
| --- | -------------------- | ------------------------------------- | ------- |
| 4   | MITM Key Exchange    | Embedded server identity key          | ⬜ TODO |
| 5   | Insecure Key Storage | Wallet requirements doc               | ⬜ TODO |
| 6   | Tool Abuse           | Action confirmation for dangerous ops | ⬜ TODO |
| 7   | Memory Poisoning     | Signed memory entries                 | ⬜ TODO |
| 8   | Dependency Poisoning | Lock + hash all deps                  | ⬜ TODO |
| 9   | Invoice Prediction   | Random components in invoices         | ⬜ TODO |
| 10  | Replay Attacks       | Persistent monotonic counter          | ⬜ TODO |

### POST-LAUNCH (P2/P3)

| #   | Threat                 | Mitigation                 |
| --- | ---------------------- | -------------------------- |
| 11  | Timing Attacks         | Constant-time crypto       |
| 12  | Invalid Curve          | Point validation           |
| 13  | Pattern Fingerprinting | Message padding            |
| 14  | Server Observation     | E2E encryption             |
| 15  | Reproducible Builds    | Full build reproducibility |

---

## Implementation Order Recommendation

**Phase 1: Pre-Launch (Required)**

1. RFC 6979 nonces ← 1 day
2. Code signing ← 2 days
3. Dependency locking ← 1 day
4. Monotonic counter ← 1 day
5. Embedded server key ← 1 day

**Phase 2: Launch Week** 6. Structured command format ← 3 days 7. Action confirmation ← 2 days 8. Random invoice components ← 1 day

**Phase 3: Post-Launch Sprint 1** 9. Content sandboxing ← 1 week 10. Signed memory entries ← 1 week 11. Wallet requirements enforcement ← 2 days

**Phase 4: Hardening** 12. Constant-time crypto audit 13. Reproducible builds 14. Privacy enhancements

---

_Generated: 2026-02-06 | Mitigation plan for EdwinPAI security threats_
