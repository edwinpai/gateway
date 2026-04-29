# Edwin Security Architecture: Open Questions Answered

Based on analysis of BRC-42 (Key Derivation), BRC-3 (Digital Signatures), BRC-100 (Wallet Interface), BRC-103 (Mutual Authentication), BRC-31 (Authrite), and Signal Protocol principles.

---

## 1. Key Rotation Lifecycle

**Question:** When should the master key rotate? What triggers rotation?

### Recommendation: Event-Based Rotation with Optional Periodic Refresh

**BRC-42 Approach:**
BRC-42's design provides inherent forward secrecy through child key derivation. The master key itself doesn't need frequent rotation because:

- Each interaction uses a _derived child key_ via invoice numbers
- Compromising a child key doesn't reveal the master key (one-way derivation)
- The shared secret (ECDH) between parties enables unique key universes

**Recommended Triggers:**

1. **Suspected Compromise** (CRITICAL): Immediate rotation if:
   - Device theft/loss
   - Unusual signing patterns detected
   - User reports suspicious activity

2. **Wallet Migration** (REQUIRED): When user moves to new wallet provider

3. **Certificate Expiration** (RECOMMENDED): If using BRC-52 identity certificates with time-limited validity

4. **Periodic Refresh** (OPTIONAL): Annual rotation as hygiene measure
   - Less critical due to BRC-42's per-interaction key derivation
   - More for organizational compliance than cryptographic necessity

**Implementation:**

```
Rotation Protocol:
1. Generate new master keypair
2. Create re-enrollment transaction signed by OLD key authorizing NEW key
3. Edwin server validates signature chain, updates stored public key
4. Old key marked deprecated (kept for audit verification of historical interactions)
5. All new interactions use new key derivation tree
```

**Signal Protocol Comparison:**
Signal uses continuous key ratcheting (Double Ratchet). BRC-42's invoice-based derivation achieves similar forward secrecy without explicit rotation—each invoice number creates a new key. Edwin's model is analogous but with wallet-controlled master keys.

---

## 2. Multi-Device Support

**Question:** How should a user run Edwin on multiple devices? Key sync vs separate enrollment?

### Recommendation: Separate Enrollment with Wallet Mediation

**Analysis:**
BRC-100's wallet interface centralizes key management. The wallet (not Edwin) controls key derivation. This means:

- The wallet already handles multi-device scenarios
- Edwin doesn't need to sync keys—the wallet does

**Two Viable Approaches:**

### Option A: Single Wallet, Multiple Edwin Instances (RECOMMENDED)

```
┌─────────────┐     ┌─────────────┐
│  Phone      │     │  Laptop     │
│  Edwin      │     │  Edwin      │
└──────┬──────┘     └──────┬──────┘
       │                   │
       └────────┬──────────┘
                │
        ┌───────▼───────┐
        │    Wallet     │
        │ (BRC-100)     │
        │ Master Keys   │
        └───────────────┘
```

- Same wallet accessed from multiple devices
- Each device's Edwin is a separate "application" to the wallet
- BRC-43 security levels control per-device permissions
- Device-specific protocol IDs (e.g., `edwin laptop`, `edwin phone`) for isolation

**Benefits:**

- Wallet handles key sync (its problem, not Edwin's)
- Revoke one device without affecting others (via BRC-43 permissions)
- Consistent identity across devices

### Option B: Device-Specific Sub-Keys (Advanced)

- Master wallet derives device-specific child keys
- Each device has its own BRC-42 derivation subtree
- Requires more complex certificate management
- Better for high-security scenarios

**Implementation per BRC-43:**

```typescript
// Each device gets different protocol permissions
const phoneProtocol = {
  securityLevel: 2,
  protocolID: "edwin phone",
  counterparty: edwinServerPubKey,
};

const laptopProtocol = {
  securityLevel: 2,
  protocolID: "edwin laptop",
  counterparty: edwinServerPubKey,
};
```

---

## 3. Recovery

**Question:** If user loses wallet, how to recover Edwin access?

### Recommendation: Wallet-Level Recovery + Edwin Re-Enrollment

**Key Insight:** Edwin's security is _derived from_ wallet security. If the wallet is lost:

- Wallet recovery = Edwin recovery path
- No wallet recovery = Re-enrollment required

**Recovery Flow:**

### Scenario A: Wallet Has Recovery Mechanism

1. User recovers wallet via seed phrase/backup
2. Master keys restored → same identity key
3. Edwin server recognizes identity (no re-enrollment needed)
4. Optional: Rotate keys as precaution (Section 1)

### Scenario B: Wallet Unrecoverable

1. User creates new wallet with new identity
2. User initiates Edwin re-enrollment
3. **Identity Verification Required:**
   - Out-of-band verification (email, SMS to registered contacts)
   - Social recovery (trusted contacts attest via BRC-52 certificates)
   - Time-delayed handover (anti-theft measure)
4. Old Edwin identity marked as "migrated to [new key]"
5. Historical interactions remain signed by old key (auditable)

**BRC-52 Social Recovery Pattern:**

```
Trusted Contacts: Alice, Bob, Carol
Recovery Threshold: 2 of 3

Recovery Process:
1. New wallet identity requests recovery
2. 2+ contacts issue certificates: "I attest [old_key] has migrated to [new_key]"
3. Edwin verifies certificate signatures from registered trustees
4. Re-enrollment approved
```

**Critical Design Decision:**
Never allow recovery that bypasses cryptographic verification. The whole point of wallet-based auth is eliminating passwords/recovery that can be social-engineered.

---

## 4. Edwin-to-Edwin Authentication

**Question:** When multiple Edwins collaborate, how should they authenticate each other?

### Recommendation: BRC-103 Mutual Authentication Protocol

**BRC-103** is specifically designed for this. It provides:

- Peer-to-peer mutual authentication via nonces and signatures
- Certificate exchange with selective disclosure
- Transport-agnostic (works over any channel)

**Edwin-to-Edwin Authentication Flow:**

```
Edwin-A (Owner: Alice)                    Edwin-B (Owner: Bob)
        │                                        │
        │  1. initialRequest                     │
        │     identityKey: Edwin-A pubkey        │
        │     nonce: A_nonce                     │
        │     requestedCertificates: [...]       │
        │ ─────────────────────────────────────► │
        │                                        │
        │  2. initialResponse                    │
        │     identityKey: Edwin-B pubkey        │
        │     nonce: B_nonce                     │
        │     yourNonce: A_nonce                 │
        │     signature: sign(A_nonce + B_nonce) │
        │     certificates: [...]                │
        │ ◄───────────────────────────────────── │
        │                                        │
        │  [Both verify signatures, now mutual]  │
        │                                        │
        │  3. general messages (signed payloads) │
        │ ◄─────────────────────────────────────►│
```

**Certificate Types for Edwin-to-Edwin:**

1. **Owner Authorization Certificate:**
   - Certifier: Owner's wallet
   - Subject: Edwin instance pubkey
   - Fields: `owner_identity`, `permissions`, `valid_until`

2. **Instance Identity Certificate:**
   - Certifier: Trusted Edwin registry (or self-signed with owner counter-signature)
   - Subject: Edwin instance
   - Fields: `instance_id`, `capabilities`, `version`

**Key Insight:** Each Edwin has its _own_ keypair (server-side), separate from the owner's wallet keys. The owner's wallet _signs a certificate_ authorizing that Edwin instance.

---

## 5. Offline Mode

**Question:** Can Edwin process commands when wallet is unreachable?

### Recommendation: Limited Offline with Pre-Signed Authorization

**The Problem:**
BRC-42 key derivation requires the wallet's private key. Without wallet access:

- Cannot derive new child keys
- Cannot sign new interactions
- Cannot verify new signatures from owner

**Solutions:**

### Option A: Pre-Cached Authorization Tokens

1. When online, wallet signs batch of "future action tokens"
2. Each token: `{action_type, expiry, signature, one-time-nonce}`
3. Edwin can execute pre-authorized actions offline
4. Tokens are single-use (nonce prevents replay)

```typescript
interface OfflineToken {
  actionType: "read_memory" | "run_query" | "send_message";
  constraints: ActionConstraints; // limits on what can be done
  expiresAt: ISOTimestamp;
  nonce: string;
  signature: BRC3Signature;
}
```

### Option B: Time-Limited Session Keys

1. Wallet derives short-lived session key for Edwin
2. Session key can sign interactions for limited window (e.g., 1 hour)
3. After expiry, wallet must re-authorize
4. Similar to Signal's session keys

### Option C: Read-Only Offline Mode

1. Edwin can read historical data, provide cached responses
2. Cannot take actions or make commitments
3. Queue actions for execution when wallet reconnects
4. Simplest, most secure option

**Recommendation:**
Start with Option C (read-only offline). Add Option A (pre-signed tokens) for specific high-value use cases. Avoid Option B unless session key scope is extremely narrow.

---

## 6. Revocation

**Question:** How to revoke a compromised key and force re-enrollment?

### Recommendation: Multi-Layer Revocation per BRC-52

**BRC-52's UTXO-Based Revocation:**
Certificates include a `revocationOutpoint` field:

- If that UTXO is spent → certificate revoked
- Anyone can check on-chain → decentralized verification
- Instant propagation (blockchain settlement time)

**Edwin Revocation Architecture:**

### Layer 1: Certificate Revocation (per BRC-52)

```
1. Owner spends revocationOutpoint UTXO
2. All parties checking certificate see it's spent
3. Edwin server rejects interactions using revoked certificate
```

### Layer 2: Server-Side Revocation List

```
1. Edwin server maintains revocation list
2. When owner reports compromise: add key to list
3. Server rejects all signatures from revoked keys
4. Faster than on-chain (doesn't wait for block)
```

### Layer 3: Time-Based Expiration

```
1. All enrollment certificates have expiry
2. Force periodic re-enrollment (e.g., annual)
3. Limits damage window of undetected compromise
```

**Emergency Revocation Flow:**

```
1. Owner suspects compromise
2. Owner contacts Edwin via backup channel (email, SMS)
3. Edwin server immediately adds key to revocation list
4. Owner spends revocationOutpoint on-chain (permanent record)
5. New enrollment requires fresh identity verification
6. All in-flight operations using old key are rejected
```

**Re-Enrollment After Revocation:**

- Mandatory waiting period (24-48 hours) for high-risk actions
- Required verification via secondary channel
- Optional: Require attestation from trusted contacts

---

## 7. Audit Trail

**Question:** Should signed interactions be logged on-chain for non-repudiation?

### Recommendation: Hybrid Approach - Merkle Root On-Chain, Details Off-Chain

**Full On-Chain Logging:**

- Pros: Maximum non-repudiation, tamper-proof, public verifiability
- Cons: Expensive (per-transaction fees), privacy concerns, scalability limits

**Recommended Architecture:**

### Batched Merkle Commitments

```
┌────────────────────────────────────────────────┐
│ Off-Chain Interaction Log                       │
│ ┌──────────────────────────────────────────┐  │
│ │ Interaction 1: {timestamp, action, sig}   │  │
│ │ Interaction 2: {timestamp, action, sig}   │  │
│ │ ...                                       │  │
│ │ Interaction N: {timestamp, action, sig}   │  │
│ └──────────────────────────────────────────┘  │
│                     │                          │
│                     ▼                          │
│         Merkle Tree Construction               │
│                     │                          │
│                     ▼                          │
│         Merkle Root: 0xabcd...                 │
└────────────────────┬───────────────────────────┘
                     │
                     ▼ (periodic: daily/weekly)
            ┌────────────────────┐
            │   On-Chain UTXO    │
            │   Contains:        │
            │   - Merkle Root    │
            │   - Timestamp      │
            │   - Edwin ID       │
            └────────────────────┘
```

### Benefits:

1. **Non-Repudiation:** Any interaction can be proven by showing:
   - The off-chain log entry
   - Merkle proof connecting it to on-chain root
2. **Privacy:** Individual interactions not publicly visible

3. **Cost-Effective:** One transaction per batch (daily/weekly)

4. **BRC-69 Compatible:** Key linkage revelations can selectively disclose specific interactions to auditors

### What to Log:

| Log Level | Content                        | Use Case                 |
| --------- | ------------------------------ | ------------------------ |
| Minimal   | Interaction hash only          | Privacy-focused users    |
| Standard  | Hash + timestamp + action type | Normal operation         |
| Full      | Complete signed message        | High-security/compliance |

### BRC-69 Audit Integration:

When auditor needs to verify specific interactions:

1. Edwin reveals specific key linkage per BRC-69
2. Auditor can derive child key, verify signatures
3. Merkle proof confirms log entry was committed on-chain
4. Full audit trail with selective disclosure

---

## Summary Table

| Question       | Recommendation                           | Key BRCs        |
| -------------- | ---------------------------------------- | --------------- |
| Key Rotation   | Event-based + optional periodic          | BRC-42, BRC-52  |
| Multi-Device   | Single wallet, separate Edwin sessions   | BRC-100, BRC-43 |
| Recovery       | Wallet-level + social recovery           | BRC-52, BRC-100 |
| Edwin-to-Edwin | BRC-103 mutual auth protocol             | BRC-103, BRC-31 |
| Offline Mode   | Read-only + pre-signed tokens            | BRC-3, BRC-42   |
| Revocation     | UTXO-based + server list + expiry        | BRC-52, BRC-100 |
| Audit Trail    | Merkle roots on-chain, details off-chain | BRC-69, BRC-72  |

---

_Generated: 2026-02-06 | Based on BRC specs analysis for Edwin security architecture_
