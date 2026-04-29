# EdwinPAI: Implementation Plan

**Version:** 3.0
**Status:** Active — v1 Beta in progress
**Last Updated:** 2026-04-07
**Owner:** Jake Jones

---

## v1 Beta Status Update (2026-04-07)

### Scope Change: v1 Beta vs v2

The original plan targeted all three Shad products (Recall, Vault, Marketplace) in a single 21-day sprint. This has been rescoped:

**v1 Beta (current target: `1.0.0-beta.1`):**

- Shad Recall (3-layer retrieval) — largely complete
- Shad Vault (ingestion + dedup) — complete
- Core EdwinPAI agent engine — production-ready
- Channels: **WhatsApp, Matrix, Telegram, Discord only**
- edwin-desktop as primary interface (BSV crypto identity)
- Workflow engine (YAML-based automation)
- Voice notes (TTS via ElevenLabs, STT via OpenAI Whisper API)

**Deferred to v2:**

- Context Marketplace (BSV micropayment queries)
- Per-user memory isolation (enterprise multi-tenant)
- Additional channels (Signal, Slack, iMessage, Google Chat, MS Teams, etc.)

### Current Milestone Status

| Milestone                  | Status           | Notes                                                         |
| -------------------------- | ---------------- | ------------------------------------------------------------- |
| **M1** (Hot-tier latency)  | PASSED           | BM25 + vector search live, qmd rebuilt with OpenAI embeddings |
| **M2** (Ingest pipeline)   | PASSED           | 515 files indexed, 23K vectors, 260MB index                   |
| **M3** (Synthesis quality) | NEEDS VALIDATION | Layers 2-3 exist but no golden dataset evaluation             |
| **M4** (Edwin integration) | IN PROGRESS      | Layer 1 live, Layers 2-3 need validation                      |
| **M5** (Payment flow)      | DEFERRED TO v2   | Marketplace not in v1 beta scope                              |

### Tracking

- **Project board:** https://github.com/users/jonesj38/projects/3
- **Milestone:** https://github.com/jonesj38/edwin/milestone/1
- **Repos:** `jonesj38/edwin`, `jonesj38/edwin-desktop`, `jonesj38/edwin-docs`
- **Package name:** `@edwinpai/edwinpai`
- **Versioning:** Semver (1.0.0-beta.1)

### Key Infrastructure Decisions (March-April 2026)

1. **Memory backend:** qmd with OpenAI `text-embedding-3-small` (replaced local embedding-gemma-300M)
2. **Workflow message step:** HTTP API to gateway (replaced CLI spawning that caused OOM)
3. **Branding:** OpenClaw → EdwinPAI (completed 2026-03-31)
4. **24 extensions cut** from codebase (2026-04-04)
5. **Desktop app is primary UI** — BSV crypto identity lives there, TUI/web are secondary
6. **Model stack:** Claude CLI/Opus (primary) → Anthropic API (fallback) → OpenAI Codex (third)

---

## Original Shad v2 Plan (Reference)

> The below plan was the original 21-day sprint targeting all three products.
> M5 (payment) is now deferred to v2. M1-M4 remain relevant.

### Executive Summary (Original)

Shad v2 implements continuous context windows across sessions via three products: **Recall** (tiered retrieval), **Vault** (ingestion + dedup), and **Context Marketplace** (BSV payments). Five sequential gated milestones over 21 days (critical path) enable production-ready deployment with measurable exit criteria at each gate.

**Original Timeline:**

- **Phase 1 (Days 1–7):** Foundation contracts + parallel retrieval & ingest
- **Phase 2 (Days 8–14):** M1 gate (retrieval latency) + M2 validation (dedup)
- **Phase 3 (Days 15–18):** Synthesis quality baseline (M3)
- **Phase 4 (Days 19–21):** Edwin integration (M4) + payment flow (M5)
- **Original Target:** 2026-03-26 (3 weeks @ 2 FTE)

---

## Part 1: Five-Phase Roadmap with Gated Milestones

### Phase 1: Foundation & Contract Definitions (Days 1–7)

**Objective:** Define all cross-component contracts; unblock parallel development.

**Milestones:** Contract definitions (pre-gates)

**Deliverables:**

- **IEmbedder interface** (T7-STUB): Deterministic stub + real GGUF model contract
- **IPaymentVerifier interface** (T8): Mock + BSV SPV verification contract
- **ShadHookRegistry contract** (T1): Edwin plugin hook interface
- **ISemanticDedup interface** (T6-PAIRS): Candidate pair generation contract

**Parallel Tracks:**

```
Track A (Retrieval):     T7-STUB contract → T2 BM25 design
Track B (Ingest):       T5 parser design → T6-PAIRS interface
Track C (Payment):      T8-MOCK verifier contract
```

**Gate:** Architecture review + interface approval (no functional gate)

---

### Phase 2: Parallel Development & M1 Gate (Days 8–14)

**Objective:** Achieve hot-tier latency SLO (<500ms p95) and dedup precision (≥95%).

**Gated Milestones:**

- **M1: Hot-Tier Latency Baseline** (Day 14)
  - P95 latency ≤500ms, hit rate ≥85%, cache ratio ≥70%
  - BM25 + embeddings hybrid search passing golden set validation
  - Blocks: M3 (synthesis requires working recall)

- **M2: Ingest Pipeline Accuracy** (Days 8–14, parallel)
  - Dedup precision ≥95%, false positive <5%, <10s per 100 docs
  - Blocks: Nothing (M3 depends only on M1, not M2)

**Deliverables:**

- T2: Hybrid BM25 + vector ranking + confidence scoring
- T7-REAL: GGUF model integration (Day 15, post-M1)
- T5: Document parsing + chunking (all 8 source types)
- T6: Semantic dedup with synthetic pair validation

**Key Dependencies:**

```
T7-STUB (Days 1–3)
    ↓
T2 BM25 (Days 5–14)
    ↓
M1 GATE: P95 ≤500ms ✓ (Day 14)
    ↓
T7-REAL: GGUF swap (Days 15–18)
```

**Success Criteria:**

```
M1 (Day 14):
  ☐ P95 latency: ≤500ms (100 sequential queries, no cache)
  ☐ Hit rate: ≥85% (top-k results relevant)
  ☐ Cache hit ratio: ≥70% (repeated queries)
  ☐ P99 latency: ≤2s (consistency under variance)
  ☐ Load test: 50 QPS → all p95 ≤500ms

M2 (Day 14):
  ☐ Exact dedup: 100% accuracy (no re-ingests)
  ☐ Semantic dedup: ≥95% precision (≤5% false positives)
  ☐ Ingest speed: ≤10s per 100 documents
  ☐ Zero data loss: All chunks retained
  ☐ Recall preservation: ≥90% (legitimate docs not removed)
```

---

### Phase 3: Synthesis Quality Validation (Days 15–18)

**Objective:** Validate end-to-end quality (retrieval + LLM synthesis) with human evaluation.

**Gated Milestone:**

- **M3: Synthesis Quality Baseline** (Day 18)
  - E2E latency ≤12s p95, quality ≥4.0/5.0 (human), hallucination <5%
  - Prerequisite: M1 PASS
  - Blocks: M4 (Edwin integration requires synthesis quality)

**Deliverables:**

- T1-REAL: Edwin hook registry implementation (real, not mock)
- T3: Multi-step Haiku synthesis (mock hooks Days 6–14, real hooks Days 15–18)
- T4: Manifest assembly + verification

**Success Criteria:**

```
M3 (Day 18):
  ☐ E2E latency P95: ≤12s (query → Sonnet response)
  ☐ Quality score (human): ≥4.0/5.0 (50 queries, 3 dimensions)
  ☐ Hallucination rate: <5% (grounded in retrieved context)
  ☐ Recall preservation: ≥85% (source context in synthesis)
  ☐ Context utilization: 60–80% (neither wasteful nor truncated)
```

---

### Phase 4: CI Integration & Payment Flow (Days 19–21)

**Objective:** Enable per-turn context injection in Edwin; validate full payment pipeline.

**Gated Milestones:**

- **M4: Edwin CI Integration** (Day 21)
  - 100% per-turn injection, <500ms latency, 100% fidelity
  - Prerequisite: M3 PASS
  - Blocks: M5 (payment requires CI working)

- **M5: BSV Marketplace Payment** (Day 21)
  - ≥99.5% payment success, <2s verification, ≤$0.01/query
  - Prerequisite: M4 PASS
  - Blocks: Production ready

**Deliverables:**

- T1-REAL (cont.): Edwin plugin lifecycle integration
- T8-REAL: BSV verifier + chain reorg handling (Days 15–18)
- T9: E2E integration test (Days 19–21)

**Success Criteria:**

```
M4 (Day 21):
  ☐ Per-turn injection rate: 100% (context before each turn)
  ☐ Injection latency P95: <500ms (agent request → context available)
  ☐ Success rate: ≥99% (no timeouts/errors)
  ☐ Context fidelity: 100% (zero corruption)
  ☐ 5-turn continuity: ≥95% (coherent reasoning)
  ☐ Plugin integration: 100% (auto-load, no manual intervention)
  ☐ Agent overhead: <50ms (imperceptible)

M5 (Day 21):
  ☐ Payment success: ≥99.5% (10/10 txns)
  ☐ Verification latency: <2s P95 (broadcast → access)
  ☐ Cost per query: ≤$0.01
  ☐ Double-spend prevention: 100% (zero duplicates)
  ☐ Settlement confirmation: 100% (on-chain)
  ☐ Offline fallback: Working (queue → reconcile)
```

---

## Part 2: Dependency Graph & Parallel Execution

### Critical Path (21 days serial)

```
Contract Definitions (Days 1–2)
    ↓
T7-STUB + T2 BM25 (Days 5–14)
    ↓
M1 GATE: P95 ≤500ms ✓ (Day 14)
    ↓
T3 Synthesis (Days 6–18, gated on M1)
    ↓
M3 GATE: Quality ≥4.0/5.0 ✓ (Day 18)
    ↓
T1-REAL Edwin + T8-REAL BSV (Days 15–21)
    ↓
M4 + M5 GATES: Integration + Payment ✓ (Day 21)
    ↓
PRODUCTION READY ✅
```

### Parallel Tracks (reduce serial time to 3 weeks)

**Track A: Retrieval Foundation (M1)**

- Days 1–3: T7-STUB + T2 design
- Days 5–14: T2 hybrid ranking + validation
- Days 15–21: T7-REAL (GGUF swap) + latency optimization

**Track B: Ingest Pipeline (M2, independent)**

- Days 1–14: T5 parsing + T6 dedup (no dependency on M1)
- Days 13–14: T5 → T6 integration test

**Track C: Synthesis & Integration (M3, M4, M5)**

- Days 6–14: T3 mock synthesis (against T2 stubs)
- Days 15–21: T1-REAL Edwin hooks + T8-REAL BSV + integration

### Execution Timeline

| Phase  | Days  | Track A       | Track B        | Track C            | Gate   |
| ------ | ----- | ------------- | -------------- | ------------------ | ------ |
| **1**  | 1–7   | Contracts     | Contracts      | Contracts          | Review |
| **2a** | 8–10  | T2 validation | T5 chunking    | T3 mock            | —      |
| **2b** | 11–14 | T2 final      | T6 integration | T3 refinement      | M1, M2 |
| **3**  | 15–18 | T7-REAL       | —              | T1-REAL, T8-REAL   | M3     |
| **4**  | 19–21 | —             | —              | M4 + M5 validation | M4, M5 |

---

## Part 3: Gap Matrix (Current vs. Build)

### Component Status & Effort

| Component                  | Current          | Target                 | Gap                                 | Effort | Risk     |
| -------------------------- | ---------------- | ---------------------- | ----------------------------------- | ------ | -------- |
| **Layer 1 (Hot-Tier)**     | Spec outline     | Full impl              | Algorithm details                   | 5d     | Low      |
| **Layer 2 (Warm-Tier)**    | Conceptual       | Full impl              | Escalation logic, prompts           | 4d     | Medium   |
| **Layer 3 (Cold-Tier)**    | Undefined        | Full impl              | Queue design, fallback              | 6d     | High     |
| **BM25 + Vector Hybrid**   | Interface only   | Full impl              | Ranking, caching                    | 8d     | Medium   |
| **Embedding Model (QMD)**  | Stub only        | GGUF integration       | Model loading, optimization         | 6d     | Low      |
| **Ingest Pipeline**        | Outline          | Full impl              | 8 source parsers, incremental sync  | 10d    | High     |
| **Semantic Dedup**         | Algorithm sketch | Full impl + validation | Threshold tuning, FP/FN measurement | 8d     | High     |
| **Edwin Plugin SDK**       | Contract only    | Full lifecycle         | Hooks, lifecycle, config            | 5d     | Medium   |
| **BSV Verifier**           | Interface only   | Full impl + testnet    | SPV, offline fallback, reorg        | 8d     | High     |
| **Payment → Vault Bridge** | Missing          | Full impl              | Token generation, access control    | 6d     | Critical |
| **End-to-End Testing**     | Test outline     | Full suite             | Integration, load, parity tests     | 12d    | High     |

**Total Build Effort:** 76 days (15 weeks @ 1 FTE, 8 weeks @ 2 FTE)
**Critical Path:** 21 days (parallel execution, 2 FTE)

---

## Part 4: Measurable Success Criteria Per Phase

### Phase 1: Foundation (Day 7)

**Acceptance Criteria:**

- ✅ All 4 interfaces reviewed and approved
- ✅ IEmbedder determinism tests passing (stub ≡ real)
- ✅ IPaymentVerifier mock generates valid tokens
- ✅ ShadHookRegistry contract includes per-turn injection points
- ✅ No blocking design questions from implementation teams

---

### Phase 2: M1 & M2 Gates (Day 14)

**M1 Acceptance Criteria:**

```
Test Command:
  shad bench --mode hot-tier --sample-size 100 \
    --load-profile 50qps --gate-mode

Pass Conditions (ALL REQUIRED):
  ✓ p95_latency_ms ≤ 500
  ✓ hit_rate ≥ 0.85
  ✓ cache_ratio ≥ 0.70
  ✓ p99_latency_ms ≤ 2000
  ✓ load_test_p95_50qps_ms ≤ 500
```

**M2 Acceptance Criteria:**

```
Test Command:
  shad sources ingest ~/test-corpus-1000.json \
    --enable-dedup --test-mode --gate-mode

Pass Conditions (ALL REQUIRED):
  ✓ exact_accuracy = 1.0
  ✓ semantic_precision ≥ 0.95
  ✓ false_positive_rate < 0.05
  ✓ data_loss = 0
  ✓ ingest_speed_sec ≤ 10
```

---

### Phase 3: M3 Gate (Day 18)

**Acceptance Criteria:**

```
Test Command:
  shad bench --mode synthesis --query-count 50 \
    --lm-model sonnet --measure-quality true --gate-mode

Pass Conditions (ALL REQUIRED):
  ✓ e2e_p95_ms ≤ 12000
  ✓ quality_score ≥ 4.0 (human eval, 3 dimensions)
  ✓ hallucination_rate < 0.05
  ✓ recall_preservation ≥ 0.85
  ✓ context_utilization_pct ∈ [60, 80]
```

**Human Evaluation:**

- 50 diverse queries evaluated on 3 dimensions (relevance, accuracy, completeness)
- Each query scored 1–5; mean ≥4.0 required
- Disagreements resolved by third reviewer

---

### Phase 4: M4 & M5 Gates (Day 21)

**M4 Acceptance Criteria:**

```
Test Command:
  shad test --mode agent-integration --agent-type edwin \
    --turn-count 5 --plugin-mode auto --gate-mode

Pass Conditions (ALL REQUIRED):
  ✓ injection_rate = 1.0
  ✓ injection_latency_p95_ms < 500
  ✓ success_rate ≥ 0.99
  ✓ context_fidelity = 1.0
  ✓ 5_turn_continuity ≥ 0.95
  ✓ plugin_integration = 1.0
  ✓ agent_overhead_ms < 50
```

**M5 Acceptance Criteria:**

```
Test Command:
  shad marketplace run-test-flow --transaction-count 10 \
    --network testnet --gate-mode

Pass Conditions (ALL REQUIRED):
  ✓ payment_success_rate ≥ 0.995 (10/10 succeed)
  ✓ verification_p95_ms < 2000
  ✓ cost_per_query_usd ≤ 0.01
  ✓ total_10_query_cost_usd ≤ 0.10
  ✓ double_spend_count = 0
  ✓ settlement_confirmation_rate = 1.0
  ✓ offline_fallback = working
```

---

## Part 5: Task-Level Breakdown (22 Tasks)

| Task                          | Phase   | Owner        | Duration                    | Blocker | Dependencies    |
| ----------------------------- | ------- | ------------ | --------------------------- | ------- | --------------- |
| **T1: Plugin Hooks**          | 1, 3, 4 | Integration  | 2–3d (contract), 3d (impl)  | M3      | None            |
| **T2: Hybrid Retrieval**      | 2, 3    | Retrieval    | 10d                         | M1      | T7-STUB         |
| **T3: Synthesis**             | 3       | Synthesis    | 9d (mock), 4d (real)        | M3      | T1 contract, T2 |
| **T4: Verification**          | 3       | Verification | 3d                          | M3      | T3              |
| **T5: Ingest Pipeline**       | 2       | Ingest       | 10d                         | M2      | None            |
| **T6: Dedup**                 | 2       | Dedup        | 8d (unit), 2d (integration) | M2      | T5, T6-PAIRS    |
| **T6-PAIRS: Candidate Pairs** | 1       | Dedup        | 1d (interface), 3d (impl)   | M2      | None            |
| **T7: Embeddings**            | 1, 2, 3 | QMD          | 3d (stub), 6d (real)        | M1      | None            |
| **T8: Payment Verifier**      | 1, 4    | Marketplace  | 5d (mock), 4d (real)        | M5      | None            |
| **T9: E2E Validation**        | 4       | QA           | 3d                          | M5      | All others      |

---

## Part 6: Risk Mitigation by Milestone

### M1 Risks

| Risk                     | Mitigation                         | Validation                         |
| ------------------------ | ---------------------------------- | ---------------------------------- |
| **Embedding bottleneck** | Stub→real swap (zero code changes) | T7-REAL latency ≤50ms improvement  |
| **BM25 weight tuning**   | Golden set validation early        | Hit rate ≥85% on Day 10 validation |
| **Cache hit ratio**      | Pre-warm with common queries       | Cache ratio ≥70% on Day 14 test    |

### M2 Risks

| Risk                    | Mitigation                                    | Validation                 |
| ----------------------- | --------------------------------------------- | -------------------------- |
| **Dedup FP spikes**     | Multi-stage filter (hash → semantic → manual) | FP <5% on 100-doc sample   |
| **Ingest OOM**          | Streaming chunking, no full corpus in memory  | <100MB for 10K docs        |
| **T5 → T6 integration** | Pre-computed pairs interface (T6-PAIRS)       | Integration test Day 13–14 |

### M3 Risks

| Risk                           | Mitigation                     | Validation                              |
| ------------------------------ | ------------------------------ | --------------------------------------- |
| **Hallucination in synthesis** | Retrieval groundedness checks  | Hallucination <5% on 50-query sample    |
| **Quality metric drift**       | Human evaluation with 3 raters | Inter-rater agreement >0.80             |
| **Latency regression**         | T7-REAL swap might regress     | Latency P95 ≤12s after GGUF integration |

### M4 Risks

| Risk                              | Mitigation                            | Validation                         |
| --------------------------------- | ------------------------------------- | ---------------------------------- |
| **Edwin SDK incompatibility**     | Contract-first design (Day 1–2)       | Mock Edwin integration Day 6–10    |
| **Plugin initialization latency** | Async pre-initialization              | Injection latency <500ms on Day 19 |
| **5-turn context loss**           | Hook registry preserves session state | Continuity test ≥95% on Day 21     |

### M5 Risks

| Risk                        | Mitigation                       | Validation                     |
| --------------------------- | -------------------------------- | ------------------------------ |
| **BSV node unavailability** | Offline fallback + queue         | Queue → reconcile on recovery  |
| **Payment latency >2s**     | Testnet/mainnet parity test      | Verification P95 <2s on Day 21 |
| **Double-spend on reorg**   | Reorg detection + reverification | Zero duplicates in audit log   |

---

## Part 7: Go/No-Go Decision Logic

### M1 Gate (Day 14)

```
IF (p95_latency_ms ≤ 500)
   AND (hit_rate ≥ 0.85)
   AND (cache_ratio ≥ 0.70)
  THEN: Proceed to M3 on Day 15 ✅
  ELSE: Remediate (Days 15–18) → retry (Days 19–21) ❌

Remediation options:
  • Increase cache size; pre-warm with top 1K queries
  • Tune BM25 weights (bm25_k1, bm25_b)
  • Optimize embedding lookup (quantization, batch inference)
  • Consider distributed indexing for >100K docs
```

### M3 Gate (Day 18)

```
IF M1_PASSED
   AND (e2e_p95_ms ≤ 12000)
   AND (quality_score ≥ 4.0)
   AND (hallucination_rate < 0.05)
  THEN: Proceed to M4/M5 on Day 19 ✅
  ELSE: Remediate (Days 19–21) → retry (post-production) ❌

Remediation options:
  • Tune Sonnet system prompt (context-aware synthesis)
  • Improve M1 retrieval precision (re-iterate if needed)
  • Increase context window or reduce scope
  • Run human eval on failure cases; identify patterns
```

### M4 Gate (Day 21)

```
IF M3_PASSED
   AND (injection_rate = 1.0)
   AND (injection_latency_p95_ms < 500)
   AND (fidelity = 1.0)
  THEN: Proceed to M5 production ✅
  ELSE: Post-production fix, interim workaround ❌

Remediation options:
  • Debug Edwin SDK compatibility (version pinning)
  • Async pre-injection (don't block agent turn)
  • Increase timeout; profile bottleneck
```

### M5 Gate (Day 21)

```
IF M4_PASSED
   AND (payment_success_rate ≥ 0.995)
   AND (verification_p95_ms < 2000)
   AND (cost_per_query ≤ 0.01)
   AND (double_spends = 0)
  THEN: PRODUCTION READY ✅
  ELSE: Post-production fix required ❌

Remediation options:
  • Verify BSV node health (testnet + local fallback)
  • Reduce fee tier; batch settlement
  • Implement payment queueing with async confirmation
  • Consider Liquid sidechain alternative
```

---

## Part 8: Resource Allocation & Timeline Options

### Option A: Serial (1 FTE, 15 weeks)

```
Week 1–2:   Phase 1 + M1 start
Week 3–4:   M1 completion
Week 5–6:   M3 (synthesis)
Week 7–8:   M4 (Edwin integration)
Week 9–10:  M5 (BSV payment)
Week 11–15: Stabilization + production prep
```

### Option B: Parallel (2 FTE, 8 weeks) ← **RECOMMENDED**

```
Week 1:     Phase 1 (both FTE on contracts)
Week 2–3:   M1 (Track A) + M2 (Track B) parallel
Week 4:     M1 gate validation
Week 5:     M3 (Track C, synthesis)
Week 6:     M4 + M5 (both FTE, integration + payment)
Week 7:     Gate validation + production readiness
Week 8:     Buffer + optimization
```

**Resource Requirements (2 FTE):**

- 1 FTE: Retrieval (T2, T7) + Synthesis (T3) + Integration (T9)
- 1 FTE: Ingest (T5, T6) + Payment (T8) + Testing

---

## Part 9: Success Metrics & Sign-Off

### Pre-Phase-1 Approval Checklist

- ✅ All stakeholders reviewed plan and agree on timeline
- ✅ Resource allocation approved (2 FTE, 8 weeks)
- ✅ Risk owners assigned (5 risks × 3 mitigations each)
- ✅ Golden datasets prepared (retrieval, dedup, synthesis)
- ✅ Test harness infrastructure ready (benchmarking, profiling)
- ✅ Build/CI pipeline configured for gated tests

### Phase-by-Phase Sign-Off

| Phase       | Owner       | Sign-Off Criteria                                       |
| ----------- | ----------- | ------------------------------------------------------- |
| **Phase 1** | Platform    | All 4 contracts approved + no blocking design questions |
| **Phase 2** | Retrieval   | M1 gate PASS + M2 dedup PASS + no SLA violations        |
| **Phase 3** | Synthesis   | M3 gate PASS + human eval ≥4.0/5.0 + quality stable     |
| **Phase 4** | Integration | M4 + M5 gates PASS + production readiness confirmed     |

---

## Part 10: Rollback Criteria & Recovery Procedures

> Rollback is triggered when a gate fails AND remediation cannot restore passing conditions within 2 additional working days. Each rollback has a defined trigger condition, state-restoration procedure, and cascade impact on downstream phases.

### Rollback Decision Authority

| Severity     | Trigger                                                | Authority                     |
| ------------ | ------------------------------------------------------ | ----------------------------- |
| **Critical** | Data loss, double-spend, security breach               | Immediate halt; both FTEs     |
| **High**     | SLA violation >2× threshold (e.g., P95 >1000ms for M1) | Phase owner; pause downstream |
| **Medium**   | SLA violation ≤2× threshold; single metric failure     | Phase owner; remediate first  |

---

### Phase 1 Rollback — Contract Definitions (Day 7)

**Triggers:**

1. IPaymentVerifier mock produces invalid tokens (any failure in T8-MOCK)
2. ShadHookRegistry contract missing required per-turn injection points
3. IEmbedder determinism test fails (stub ≢ real contract)

**State Restoration:**

```
git checkout HEAD~1 -- src/interfaces/
# Re-run contract review with all interface owners
# Block Track A and Track C from Day 5 start until resolved
```

**Cascade Impact:** Track A and Track C cannot start until contracts are approved. M1 target shifts from Day 14 → Day 17+.

---

### Phase 2 Rollback — M1 Gate (Day 14)

**Triggers:**

1. P95 latency > 600ms (>2× hot-tier target) after two remediation attempts
2. Cache hit ratio < 60% (cache regression from baseline)
3. Precision@10 < 0.70 (index quality collapse)
4. Data loss detected: any chunk count < pre-ingest reference count

**State Restoration:**

```
# Restore last known-good index snapshot
shad index restore --snapshot pre-m1-baseline
# Revert BM25 tuning parameters to defaults
git checkout HEAD~3 -- config/retrieval.yaml
# Flush and rebuild cache from restored index
shad cache flush && shad cache warm --top-k 1000
```

**Cascade Impact:** M3 cannot start. Synthesis (Track C) stalls at mock phase. Timeline extends by ≥4 days.

---

### Phase 2 Rollback — M2 Gate (Day 14)

**Triggers:**

1. Semantic dedup false positive rate > 10% (silent correctness failures — legitimate docs removed)
2. Ingest speed regression > 90s per 100 docs (>9× target)
3. Orphaned chunks detected: `context_continuity.json` references missing chunk IDs

**State Restoration:**

```
# Disable semantic dedup; fall back to hash-only dedup
shad config set dedup.mode hash-only
# Restore pre-ingest vault snapshot
shad vault restore --snapshot pre-ingest-baseline
# Re-run ingest with conservative batch size (10 docs)
shad sources ingest --batch-size 10 --no-semantic-dedup
```

**Cascade Impact:** M2 is independent (does not block M1 or M3). Timeline impact limited to Track B; proceed with M1/M3 gates on schedule.

---

### Phase 3 Rollback — M3 Gate (Day 18)

**Triggers:**

1. Hallucination rate ≥ 10% (doubled threshold; evidence of grounding failure)
2. Quality score < 3.0/5.0 (significant regression from human eval)
3. E2E latency P95 > 20s (after T7-REAL GGUF swap — embedding regression)

**State Restoration:**

```
# Revert T7-REAL to T7-STUB (deterministic embeddings)
git checkout HEAD~5 -- src/embeddings/
shad config set embeddings.mode stub
# Restore synthesis prompts to last approved version
git checkout main -- config/synthesis-prompts.yaml
# Re-run quality evaluation on 10-query fast subset
shad bench --mode synthesis --query-count 10 --gate-mode
```

**Cascade Impact:** M4 and M5 cannot start. Edwin integration (Track C, Days 19–21) stalls. Timeline extends by ≥3 days. If M3 cannot pass after rollback+remediation, M4/M5 gates move to post-production.

---

### Phase 4 Rollback — M4 Gate (Day 21)

**Triggers:**

1. Per-turn injection rate < 95% (context silently dropped mid-session)
2. Context fidelity failure: any corruption in injected context
3. Edwin plugin crashes in 5-turn agent scenario (zero-tolerance)

**State Restoration:**

```
# Disable Edwin plugin auto-load; manual mode only
shad config set plugin.mode manual
# Revert Edwin SDK version pin
git checkout main -- package.json && npm install
# Re-run 5-turn agent test with manual injection
shad test --mode agent-integration --injection manual
```

**Cascade Impact:** M5 (payment) cannot start — payment requires CI working. If M4 fails definitively, deploy M5 with manual context injection as interim workaround with post-production fix ticket.

---

### Phase 4 Rollback — M5 Gate (Day 21)

**Triggers:**

1. Any double-spend detected (zero-tolerance; immediate halt)
2. Payment success rate < 95% (≥5% of transactions failing)
3. Cost per query > $0.02 (2× budget; unsustainable for production)
4. Offline fallback not functioning (queue accumulates but never reconciles)

**State Restoration:**

```
# Immediately disable BSV payment gating
shad config set marketplace.payment.enabled false
# Switch to access-token-only mode (no on-chain verification)
shad config set marketplace.payment.mode token-only
# Audit payment log for any double-spend evidence
shad marketplace audit --check-duplicates --output rollback-audit.json
# Notify BSV node operator of issue
```

**Cascade Impact:** Production launch blocked until resolved. No state loss for existing vault data. Revenue from marketplace unavailable until M5 re-passes. Interim: use signed access tokens without on-chain settlement.

---

### Cross-Phase Cascade Risk Summary

| Risk                              | Affected Phases | Cascade Impact                                 |
| --------------------------------- | --------------- | ---------------------------------------------- |
| **R1: BSV node downtime**         | M5 only         | M5 rollback; does not affect M1–M4             |
| **R2: Embedding model drift**     | M1, M3          | M3 must revalidate if M1 embeddings change     |
| **R3: Latency budget exceeded**   | M1, M3, M4      | M1 → M3 → M4 all dependent on P95 chain        |
| **R4: Data loss in ingest**       | M2, M3          | M2 rollback forces M3 re-baseline              |
| **R5: Edwin SDK incompatibility** | M4 only         | Does not roll back M1–M3                       |
| **R6: Dedup false positives**     | M2 only         | Independent; does not cascade if M2-only track |

**Current State Gaps That Increase Rollback Risk** [2]:

- No per-component latency dashboard → latency regressions detected late
- No automated data loss detection → M1/M2 rollback triggers delayed
- BM25 tuning parameters undefined → M1 remediation path unclear
- No golden dataset prepared → M3 quality regression hard to confirm
- Payment reconciliation system missing → M5 audit requires manual review

---

## Appendix: Cross-Document References

**Related Specifications:**

- **SPEC.md**: Detailed algorithm specifications, API contracts, data flows
- **gated-milestones.md**: Gate exit criteria & remediation paths (M1–M5)
- **milestone-dependency-map.md**: Detailed parallel track timeline
- **gap-matrix-audit.md**: Critical integration gaps (payment→vault, cold-tier, dedup)
- **product-goals-and-success-criteria.md**: Product-level definitions
- **risk-register.md**: 5 identified risks + mitigation strategies

---

**Document Status:** Complete | Execution Ready
**Approval Required:** Yes (stakeholder sign-off before Phase 1)
**Next Action:** Phase 1 kickoff (Day 1, contracts + parallel track setup)
