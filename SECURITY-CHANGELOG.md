# Edwin Security Analysis: v1 → v2 Changelog

_Generated: 2026-02-06_
_v1: Analysis without external source grounding (Shad depth-1, no vault)_
_v2: Analysis grounded in NIST/Signal/OWASP/RFC/BRC vault (269 docs, 1299 chunks)_

---

## Executive Summary

The v2 analysis represents a **significant upgrade** in rigor, specificity, and actionability. The v1 analysis was solid but relied on general knowledge; v2 is anchored to specific sections of NIST SP 800-57, RFC 6979, Signal Protocol specs, OWASP Cheat Sheets, BRC specifications, and Trail of Bits ECDSA research.

### Key Improvements

| Dimension                       | v1                                    | v2                                                              |
| ------------------------------- | ------------------------------------- | --------------------------------------------------------------- |
| **Source citations**            | General references (e.g., "RFC 6979") | Specific sections (e.g., "NIST SP 800-57 Section 8.3.4")        |
| **BRC-42 vs Signal comparison** | Mentioned in passing                  | Structured comparison table with 7 axes                         |
| **Gap identification**          | Implicit                              | Explicit — 5 critical BRC specification gaps identified         |
| **AI-specific threats**         | 3 threats noted                       | 4 threats with "crypto-AI boundary" as novel category           |
| **Implementation detail**       | Code sketches                         | Architecture diagrams + API specs + code examples               |
| **Prioritization**              | P0/P1/P2 labels                       | Launch-blocking vs post-launch with 2-phase roadmap + timelines |

---

## SECURITY-ANSWERS: v1 → v2 Changes

### What's New in v2

1. **Explicit BRC specification gaps identified**
   - v1 noted BRC-42 works well for key derivation
   - v2 identifies **5 critical gaps**: rotation schedules, revocation mechanisms, audit trail requirements, recovery procedures, side-channel guidance
   - v2 recommends a new "BRC-XXXX: Security Operations for Key Derivation" standard

2. **Structured BRC-42 vs Signal comparison**
   - v1 had scattered comparisons
   - v2 provides a 7-row comparison table covering: forward secrecy, recovery, multi-device, offline operation, revocation, audit trail, authentication
   - **Key insight**: BRC-42 excels at multi-device/recovery, Signal excels at operational security

3. **NIST-grounded rotation recommendations**
   - v1: "Annual rotation as hygiene measure"
   - v2: "Time-based rotation per NIST SP 800-57 cryptographic periods: 1-2 years for static keys, with usage-based and compromise-based triggers"

4. **Recovery mechanism depth**
   - v1: Seed phrase + social recovery (generic)
   - v2: Explicit trade-off analysis — "seed recovery reduces forward secrecy guarantees; mitigate with triple-compromise requirement" citing NIST SP 800-57 Section 8.2.2

5. **Edwin-to-Edwin authentication**
   - v1: BRC-43 counterparty derivation + mutual signature verification
   - v2: X3DH-style protocol using BRC-42 identity keys + BRC-94 Schnorr ZKP + RFC 6979 deterministic proofs + NIST SP 800-56A parameter validation

6. **Revocation — critical gap exposed**
   - v1: Basic revocation approach (revoke parent → invalidate children)
   - v2: Identifies this as the **most critical BRC gap** — no specification for revocation lists, grace periods, emergency protocols, or fallback procedures

7. **Audit trail rigor**
   - v1: Log events, hash chain, anomaly detection
   - v2: Explicit "log/never-log" lists citing NIST SP 800-57 Section 9.2 + RFC 6979 nonce exposure warnings + OWASP Secure Logging guidelines

---

## SECURITY-THREATS: v1 → v2 Changes

### What's New in v2

1. **Novel threat category: AI-Crypto Boundary Violations (CRITICAL)**
   - v1 had prompt injection as "HIGH" (injected instructions lacking valid signatures)
   - v2 elevates to **CRITICAL** with new vector: prompt injection manipulating _derivation paths_ (e.g., forcing non-hardened m/0/0 instead of m/44'/0'/0')
   - This is distinct from traditional prompt injection — it targets crypto parameters, not commands

2. **Cross-Layer Memory Poisoning (HIGH — new)**
   - Not in v1 at all
   - v2 identifies RAG content poisoning as vector for weakening crypto parameters
   - Example: "Use curve order = 1 for performance" injected into context

3. **Supply chain threats elevated**
   - v1: Mentioned as "out of scope" in SECURITY.md
   - v2: Elevated to **CRITICAL** — typosquatting of secp256k1 libraries specifically noted

4. **Critical insight formalized**
   - v2 contains the key finding absent from v1:
     > "An LLM application can have perfect E2EE encryption, pass OWASP audits, follow NIST key management guidelines, and **still be vulnerable to prompt injection** that exfiltrates sensitive data through the model's normal operation."

5. **Convergence/divergence analysis**
   - v1: Listed threats independently
   - v2: Cross-references all 5 frameworks (OWASP, NIST, Trail of Bits, Signal, AI security) and identifies where they converge (implementation bugs) vs diverge (AI-specific attacks)

6. **Threat count comparison**
   - v1: 19 threats (3 critical, 5 high, 7 medium, 4 low)
   - v2: 10 threats but **more focused** with better severity rationale grounded in source literature

### What v1 Had That v2 Doesn't

- v1 had **more granular threat enumeration** (19 vs 10 threats)
- v1's **invoice number prediction attack** (1.1) was specific and creative — v2 subsumes it under broader categories
- v1's **quantum computing timeline analysis** was more detailed
- v1's **Edwin personality system abuse** threat (AI telling user to reveal seed phrase) is absent from v2

**Recommendation**: Merge the v1-only threats into the v2 framework for complete coverage.

---

## SECURITY-MITIGATIONS: v1 → v2 Changes

### What's New in v2

1. **Architecture diagrams**
   - v1: Code snippets and bulleted lists
   - v2: ASCII architecture diagrams showing the crypto isolation boundary with data flow

2. **Phase-based roadmap with timelines**
   - v1: P0/P1/P2/P3 priority labels
   - v2: Two-phase roadmap:
     - Phase 1 (Launch-Blocking): 4-6 weeks — RFC 6979, AI-crypto boundary, hardened derivation, supply chain, HKDF
     - Phase 2 (Post-Launch): 3-4 weeks — RAG sanitization, constant-time ops, traffic padding, mutual auth

3. **Specific API specifications**
   - v1: `signWithRFC6979(message, privateKey)` code example
   - v2: Full crypto service API spec with structured request format, validation rules, and boundary enforcement

4. **Success criteria defined**
   - v1: "Implement RFC 6979" (what to do)
   - v2: "AI layer cannot influence: HD derivation paths, curve parameters, nonce generation algorithm, key storage locations" (verifiable outcomes)

5. **Implementation complexity ratings**
   - v1: Estimated effort per mitigation
   - v2: Low/Medium/High/Very High complexity + explicit dependency sequencing

6. **Source-cited mitigations**
   - v1: "Use RFC 6979 for deterministic nonces"
   - v2: "RFC 6979: Deterministic Usage of DSA and ECDSA — Section 3.2: Generation of k" with vault-verified citation

---

## Overall Assessment

### v2 Strengths

- **Grounded in authoritative sources** — every claim traced to NIST, OWASP, RFC, or BRC spec
- **BRC gap analysis** is the most valuable new contribution — identifies what the ecosystem needs
- **AI-crypto boundary** concept is novel and critical for Edwin's unique position as an AI + wallet system
- **Production-ready roadmap** with phases, timelines, and success criteria

### v2 Weaknesses to Address

- **Lost some v1 specificity** — 19 threats compressed to 10; some creative v1 threats dropped
- **Less code** — v1 had more TypeScript implementation examples
- **No quantum timeline** — v1 addressed post-quantum migration; v2 doesn't
- **No cost estimates** — v2 has complexity ratings but no developer-hour estimates

### Recommended Merge Strategy

1. Use v2 framework as the authoritative analysis (source-grounded)
2. Port v1-specific threats into v2 (invoice prediction, personality abuse, quantum timeline)
3. Add v1's TypeScript code examples to v2's architecture specifications
4. Combine v1's developer-hour estimates with v2's phase-based timeline

---

## Files Generated

| File                         | Description                                     | Size      |
| ---------------------------- | ----------------------------------------------- | --------- |
| `SECURITY-ANSWERS-v2.md`     | 7 open questions answered with source citations | 13KB      |
| `SECURITY-THREATS-v2.md`     | 10 attack vectors with severity ratings         | 7.6KB     |
| `SECURITY-MITIGATIONS-v2.md` | Prioritized implementation roadmap              | 850 lines |
| `SECURITY-CHANGELOG.md`      | This comparison document                        | —         |
