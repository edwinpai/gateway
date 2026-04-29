# Comprehensive Security Analysis: Edwin's 7 Research Questions (v2)

_Generated: 2026-02-06 — Grounded in NIST/Signal/OWASP/RFC/BRC vault sources_
_Shad Run ID: fe1d19e4-0287-48f6-90fc-c6884b88eecb_

Based on deep research across the Edwin security vault (269 docs, 1299 chunks) including Signal Protocol specs, NIST SP 800-57, RFC 6979, OWASP Cheat Sheets, BRC specs, and Trail of Bits ECDSA analysis.

---

## 1. Key Rotation Lifecycle

**Question:** How should keys be rotated across the HD tree hierarchy while maintaining perfect forward secrecy?

**BRC-42 Current Approach:**
BRC-42 provides hierarchical deterministic key derivation from a master seed, enabling deterministic key generation across devices. However, **no rotation schedule is specified** in the BRC key-derivation specs (0032, 0042, 0043).

**Signal Protocol Approach:**
Signal uses continuous key ratcheting with per-message ephemeral keys through its Double Ratchet Algorithm, combining a symmetric-key ratchet with a DH ratchet for forward security.

**NIST/OWASP Guidance:**

- **NIST SP 800-57:** Recommends minimum 2048-bit keys with consideration for "anticipated lifetime of the private key and corresponding certificate"
- **OWASP Key Management:** Emphasizes key lifecycle best practices including generation, distribution, rotation, and destruction

**Critical Gap:**
BRC specs are **silent on mandatory key rotation intervals, cryptographic period definitions, and maximum lifetime for parent/master keys**.

**Recommended Approach:**

1. Implement time-based rotation (per NIST SP 800-57 cryptographic periods)
2. Use BRC-42 HD derivation to generate new child keys while maintaining seed recovery capability
3. Combine with Signal-style ephemeral keys for session-level forward secrecy
4. Define rotation triggers: time-based (1-2 years for static keys), usage-based, and compromise-based

**Implementation Considerations:**

- **Trade-off:** BRC-42's seed-based recovery potentially compromises perfect forward secrecy if seed is retroactively compromised, unlike Signal's approach that makes old messages mathematically unrecoverable
- Edwin's "triple-compromise requirement" adds compensating controls

---

## 2. Multi-Device Support

**Question:** How can multiple devices derive consistent keys from BRC-42 trees while maintaining device-specific security boundaries?

**BRC-42 Current Approach:**
Built on Bitcoin wallet infrastructure (BRC-02), inherently supports multi-device through deterministic key derivation from seed phrases.

**Signal Protocol Approach:**
Designed for multi-device synchronization through X3DH (Extended Triple Diffie-Hellman) key agreement and prekey bundles, though with complexity around explicit device linking.

**NIST/OWASP Guidance:**

- **NIST SP 800-57:** Covers key distribution mechanisms for multiple endpoints
- **OWASP:** Emphasizes secure device registration and deregistration patterns

**Recommended Approach:**

1. Leverage BRC-42's deterministic derivation for device consistency (advantage over Signal)
2. Use device-specific derivation paths (per BRC-43 security levels 0, 1, 2)
3. Implement device attestation using BRC-94 ZKP proofs for verification
4. Maintain per-device audit logs (see Question 7)

**Implementation Considerations:**

- **BRC-42 Advantage:** Simplified device recovery through seed phrases
- **Security Boundary:** Use BRC-43's counterparty-specific permissions for device isolation

---

## 3. Recovery Mechanisms

**Question:** What recovery procedures preserve the triple-compromise requirement when a device/key is lost?

**BRC-42 Current Approach:**
Enables seed-based recovery like Bitcoin wallets, allowing deterministic key regeneration. BRC specs are **silent on recovery procedures beyond seed phrases** and lack guidance on partial compromise scenarios.

**Signal Protocol Approach:**
No seed-based recovery; prioritizes security over recoverability with strong forward secrecy and break-in recovery properties.

**NIST/OWASP Guidance:**

- **NIST SP 800-57 Section 8.2.2:** Covers key recovery and escrow considerations
- **OWASP:** Account recovery security explicitly **rejects** security questions per NIST SP 800-63

**Critical Gap:**
BRC specs lack specification for recovery from lost derivation state, partial key compromise, multi-device sync failures, and corruption of derivation metadata.

**Recommended Approach:**

1. **Primary Recovery:** Seed phrase backup (BRC-42 capability)
2. **Triple-Compromise Model:** Require compromise of seed + device + one additional factor (biometric, hardware token)
3. **Session Recovery:** Implement Signal-style session re-establishment without reusing old keys
4. **Partial Compromise:** Define degraded operation modes when one component is compromised
5. **Testing:** Document and test all recovery paths

**Implementation Considerations:**

- **Security Trade-off:** Seed recovery reduces forward secrecy guarantees; mitigate with triple-compromise requirement
- **User Guidance:** Clearly communicate recovery risks and secure seed storage practices

---

## 4. Edwin-to-Edwin Authentication

**Question:** How should two Edwin instances mutually authenticate using BRC-42 + DH key exchange?

**BRC-42 Current Approach:**
BRC-42 supports ECDH-based key derivation with invoice numbers; BRC-43 defines security permission models and counterparty-specific derivations.

**Signal Protocol Approach:**
X3DH (Extended Triple Diffie-Hellman) provides authenticated asynchronous key agreement with prekey bundles and mutual public key verification.

**NIST/OWASP Guidance:**

- **NIST SP 800-57 Section 8.1.5:** Key agreement schemes
- **NIST SP 800-56A Rev. 3:** Pair-wise key establishment
- **OWASP Authentication Cheat Sheet:** Mutual authentication patterns, TLS client authentication
- **RFC 6979:** Deterministic signatures for authentication proof

**Recommended Approach:**

1. **Initial Authentication:** Implement X3DH-style protocol using BRC-42 derived identity keys
2. **Signature Verification:** Use RFC 6979 deterministic ECDSA signatures for authentication proofs (prevents nonce reuse attacks)
3. **Zero-Knowledge Proofs:** Leverage BRC-94's Schnorr ZKP scheme to prove shared secrets without revealing them
4. **DH Parameter Validation:** Follow NIST SP 800-56A guidance to prevent authentication bypasses

**Implementation Considerations:**

- **Curve Choice:** BRC-42 uses Bitcoin's secp256k1 (256-bit, ~3072-bit RSA equivalent), exceeding NIST minimums
- **Deniability:** Consider Signal-style deniable authentication properties if required

---

## 5. Offline Mode Security

**Question:** How can Edwin maintain security when operating without network connectivity?

**BRC-42 Current Approach:**
Deterministic key derivation enables pre-computation of key material for offline operation.

**Signal Protocol Approach:**
Prekey bundles enable asynchronous messaging, allowing recipients to derive shared secrets offline before sender comes online.

**NIST/OWASP Guidance:**

- **NIST SP 800-57:** Offline key validation approaches
- **RFC 6979:** Offline deterministic signature generation (critical for preventing nonce reuse in offline scenarios)
- **OWASP:** Offline security controls and data protection

**Critical Gap:**
BRC specs lack guidance on secure backup transmission protocols, offline attack vectors (side-channel, physical access), and network privacy considerations.

**Recommended Approach:**

1. **Pre-derived Keys:** Generate session keys while online, cache securely for offline use
2. **Deterministic Signatures:** Use RFC 6979 for offline signing without nonce generation risks
3. **Opportunistic Encryption:** Queue encrypted messages for delivery when connectivity returns
4. **Side-Channel Protection:** Implement constant-time operations to prevent timing attacks during offline crypto operations
5. **Physical Security:** Enforce device encryption and secure enclaves for offline key storage

**Implementation Considerations:**

- **Public Auditability:** All encrypted data hashes may be publicly visible on blockchain
- **Storage Limits:** Pre-compute limited key material to balance security and storage

---

## 6. Revocation Procedures

**Question:** How are compromised keys revoked across the hierarchical tree without breaking the triple-compromise model?

**BRC-42 Current Approach:**
BRC specs provide **no documented revocation mechanism** for compromised keys, deprecated derivation paths, or malicious implementations.

**Signal Protocol Approach:**
Session deletion and immediate key erasure; no long-term revocation infrastructure needed due to ephemeral keys.

**NIST/OWASP Guidance:**

- **NIST SP 800-57 Section 8.3.4:** Key revocation and destruction, zeroization procedures
- **OWASP:** Certificate/key revocation best practices, proper revocation checking
- **OWASP Transport Layer Security:** Certificate revocation validation

**Critical Gap:**
No specification for revocation list format/distribution, grace periods, fallback procedures when revocation services are unavailable, or emergency revocation.

**Recommended Approach:**

1. **Hierarchical Revocation:** Revoke parent keys to invalidate all child derivations
2. **Revocation List:** Publish signed revocation lists with affected derivation paths
3. **Grace Period:** 24-48 hour propagation period for non-emergency revocations
4. **Emergency Protocol:** Immediate seed rotation + broadcast to all known devices
5. **Fallback:** Operate in degraded mode if revocation check fails (per triple-compromise model)
6. **Trail of Bits Guidance:** Implement revocation timing attack protections

**Implementation Considerations:**

- **Immutability Constraint:** Blockchain transactions are irreversible; revocation applies to future operations only
- **Ecosystem Coordination:** Protocol changes require BRC community consensus

---

## 7. Audit Trail Requirements

**Question:** What cryptographic operations must be logged to detect compromise attempts without leaking key material?

**BRC-42 Current Approach:**
BRC specs are **silent on logging requirements** for key derivation events, access attempts, failed derivations, or suspicious usage patterns.

**Signal Protocol Approach:**
Logs session establishment and ratchet advancement events without exposing key material.

**NIST/OWASP Guidance:**

- **NIST SP 800-57 Section 9.2:** Audit logging requirements for cryptographic operations
- **RFC 6979:** Cautions against logging deterministic signature generation in ways that expose nonces
- **OWASP Secure Logging:** Protect log integrity and confidentiality, capture security-relevant events
- **OWASP Secure Code Review:** Audit logging as critical security control

**Critical Gap:**
No BRC specification for what events must be logged, log retention, format standards for interoperability, or privacy considerations (what NOT to log).

**Recommended Approach:**

**Log These Events:**

1. HD derivation path access (not derived keys)
2. Authentication attempts (success/failure)
3. Key rotation/revocation operations
4. Unusual access patterns (time, location, frequency)
5. Failed signature verifications
6. Device registration/deregistration

**Never Log:**

- Private keys or seed phrases
- Deterministic signature nonces (RFC 6979 warning)
- Plaintext message contents
- Intermediate key derivation values

**Security Measures:**

1. **Integrity:** Sign audit logs with append-only data structure
2. **Confidentiality:** Encrypt logs containing sensitive metadata
3. **Retention:** Follow NIST guidance on retention periods
4. **Monitoring:** Alert on suspicious patterns (multiple failed auth, rapid derivation)

**Implementation Considerations:**

- **Privacy:** Balance security monitoring with user privacy
- **Side-Channel Risk:** Ensure logs don't leak key material through timing/access patterns

---

## Summary: BRC-42 vs Signal Double Ratchet

| Security Aspect       | BRC-42 Strength                    | Signal Strength                              | Critical Gap                               |
| --------------------- | ---------------------------------- | -------------------------------------------- | ------------------------------------------ |
| **Forward Secrecy**   | ✓ Ephemeral keys via HD derivation | ✓ Per-message ratcheting                     | BRC lacks rotation schedules               |
| **Recovery**          | ✓ Seed-based recovery              | ✗ No recovery (security over recoverability) | BRC lacks partial compromise procedures    |
| **Multi-Device**      | ✓ Deterministic derivation         | ~ Complex explicit linking                   | BRC advantage                              |
| **Offline Operation** | ✓ Pre-computed keys                | ✓ Prekey bundles                             | BRC lacks side-channel guidance            |
| **Revocation**        | ✗ Not specified                    | ✓ Session deletion                           | **Critical BRC gap**                       |
| **Audit Trail**       | ✗ Not specified                    | ✓ Session events logged                      | **Critical BRC gap**                       |
| **Authentication**    | ~ Via BRC-94 ZKP                   | ✓ X3DH protocol                              | BRC lacks DH parameter validation guidance |

**Key Insight:** BRC-42 excels at deterministic multi-device support and recovery but lacks operational security guidance (rotation, revocation, audit) where NIST SP 800-57 and OWASP provide clear standards.

**Recommendation:** Develop "BRC-XXXX: Security Operations for Key Derivation" incorporating NIST and OWASP guidance to fill these critical gaps.
