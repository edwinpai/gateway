# Shad Architecture Specification

**Last Updated:** February 5, 2026
**Version:** 1.0
**Status:** Complete Component Inventory

## Executive Summary

Shad (Shannon's Daemon) is a Python-based recursive reasoning engine that treats Collection collections as explorable environments. It decomposes complex tasks into DAGs (directed acyclic graphs), executes them with LLM orchestration, validates results, and provides comprehensive observability through structured history storage.

**Key Architecture Principles:**

- **Recursive decomposition:** Tasks → DAGs → parallel subtask execution
- **Code Mode execution:** LLM-generated Python scripts extract/filter collection data
- **Hybrid retrieval:** BM25 (keyword) + vector (semantic) + reranking
- **Deterministic caching:** Content-hash based cache validation
- **Observable execution:** Complete run artifacts preserved for replay/debugging

---

## 1. Core Execution Engine (RLM)

### Component: `shad/engine/rlm.py`

**Purpose:** Recursive Language Model execution engine - the central orchestrator.

**Key Classes:**

- `RLMEngine` - Main execution orchestrator
- `BudgetExhausted` - Exception for budget limit violations

**Core Methods:**

#### `RLMEngine.__init__()`

```python
def __init__(
    self,
    llm_provider: LLMProvider | None = None,
    cache: RedisCache | None = None,
    retriever: RetrievalLayer | None = None,
    code_executor: CodeExecutor | None = None,
    vault_path: Path | str | None = None,
    collections: list[str] | None = None,
    use_code_mode: bool = True,
    use_qmd_hybrid: bool = False,
)
```

**Initialization Flow:**

1. Initialize LLM provider (Anthropic API wrapper)
2. Initialize Redis cache (optional, for result caching)
3. Initialize retrieval layer (qmd or filesystem)
4. Initialize CodeExecutor (for Code Mode with collection access)
5. Initialize StrategySelector and StrategyDecomposer
6. Initialize NodeContextManager (for soft dependency injection)
7. Initialize VerificationLayer (Phase 5)
8. Initialize DeltaVerifier + RunStateManager (Phase 6)

#### `RLMEngine.execute(config: RunConfig) → Run`

**Execution Pipeline (6 Phases):**

1. **Phase 1: Strategy Selection**

   ```
   goal_text → strategy_selector.select() → StrategyType (software|research|analysis|planning)
   ```

   - Auto-detects task type (code generation, research, etc.)
   - Confidence score returned with selection

2. **Phase 2: Context Retrieval**

   ```
   goal → retriever.search(query) → [RetrievalResult] → context_string
   ```

   - Calls `_retrieve_vault_context(goal_spec.normalized_goal, limit=10)`
   - Three retrieval modes:
     - **qmd_hybrid** (fast, recommended): Vector semantic search
     - **Code Mode** (flexible): LLM-generated extraction scripts
     - **Direct** (fallback): BM25 keyword search

3. **Phase 3: DAG Construction**

   ```
   task → decomposer.decompose(strategy) → DAGNode[] with hard_deps/soft_deps
   ```

   - Creates root node and dependency graph
   - Parallel execution waves based on dependency satisfaction

4. **Phase 4: Execution & Synthesis**

   ```
   Parallel execution of ready nodes
   → leaf_model.answer_task() or recurse → node.result
   ```

   - Leaf nodes executed with leaf_model
   - Non-leaf nodes decomposed recursively
   - Results cached (Redis)
   - Synthesis: combine child results into parent

5. **Phase 5: Verification** (software strategy only)

   ```
   manifest → verification_layer.verify(manifest, level)
   → VerificationResult with checks/failures
   ```

   - Checks: syntax, lint, types, imports, tests
   - Repair loop: attempt fixes, re-verify

6. **Phase 6: Refinement & State Tracking**

   ```
   delta_verifier + state_manager → RunState (SUCCESS|PARTIAL|NEEDS_HUMAN)
   ```

   - Delta verification on resume
   - State machine: RUNNING → SUCCESS/PARTIAL/FAILED/NEEDS_HUMAN

**Resume Flow:**

```python
async def resume(run: Run, replay_mode: str | None = None) → Run
```

- Replay modes: `"stale"` (re-verify changed notes), `"node_id"` (specific node), `"subtree:node_id"`
- Delta verification: compare current collection hashes vs stored node hashes
- Re-execute only stale/pending nodes

### Budget Enforcement

**Budget Constraints:**

- `max_wall_time` (seconds): Total execution time
- `max_tokens` (int): Total LLM tokens
- `max_nodes` (int): DAG size limit
- `max_depth` (int): Recursion depth
- `max_branching_factor` (int): Children per node

**Violation Handling:**

- `_check_budgets()` called before each node execution
- Raises `BudgetExhausted(reason, message)` → caught at run level
- Sets `run.stop_reason` to `StopReason.BUDGET_*`
- Final status: `RunStatus.PARTIAL`

### Cache Mechanism

**Cache Key Generation:**

```python
def _make_cache_key(task: str, context: str, context_hash: str | None = None) → str:
    key_data = f"{task}::{context_hash or context[:500]}"
    return hashlib.sha256(key_data.encode()).hexdigest()[:16]
```

**Cache Flow:**

1. Check Redis before execution: `cache.get(cache_key)`
2. On cache hit: return cached result, mark `node.cache_hit = True`
3. On cache miss: execute normally
4. Cache result after successful execution: `cache.set(cache_key, result)`

**Context Hash Validation:**

- Hash of context sources (retrieved documents)
- If collection files changed → hash mismatch → cache miss
- Ensures cache coherence with collection state

---

## 2. Retrieval Layer (qmd + BM25)

### Component: `shad/retrieval/qmd.py`

**Purpose:** Hybrid document retrieval - semantic + keyword search with LLM reranking.

**Class: `QmdRetriever`**

**Search Modes:**
| Mode | Command | Use Case |
|------|---------|----------|
| `bm25` | `qmd search` | Fast keyword search |
| `vector` | `qmd vsearch` | Semantic similarity (default for RLM) |
| `hybrid` | `qmd query` | Best quality with reranking |

**Search Method:**

```python
async def search(
    query: str,
    mode: str = "hybrid",
    collections: list[str] | None = None,
    limit: int = 10,
    min_score: float = 0.0,
) → list[RetrievalResult]
```

**Search Process:**

1. Extract keywords from long/verbose queries (remove stop words)
2. Run qmd CLI command: `qmd [search|vsearch|query] <keywords> -n <limit> --json`
3. Parse JSON output → `RetrievalResult[]`
4. Filter by min_score (relevance threshold)
5. Deduplicate results by path (cumulative scoring for multi-keyword matches)

**RetrievalResult Structure:**

```python
@dataclass
class RetrievalResult:
    path: str                    # File path
    content: str                 # Full or snippet
    score: float                 # Relevance score (0-1)
    snippet: str | None          # Highlighted section
    collection: str              # Collection name (multi-collection)
    docid: str                   # Document ID
    matched_line: int | None     # Line number
    metadata: dict               # Custom metadata
```

### Integration with RLM

**Three Retrieval Paths:**

1. **qmd_hybrid (Recommended)**

   ```python
   async def _retrieve_qmd_hybrid(query: str, limit: int = 10) → str
   ```

   - Uses vector-only mode (since decomposition crafts targeted queries)
   - Fast: ~2-3s with OpenAI embeddings
   - Low memory: no BM25 index overhead
   - Flow: `search(mode="vector")` → format results → return context

2. **Code Mode (Two-Phase)**

   ```python
   async def _retrieve_via_code_mode(query: str) → str
   ```

   - Phase 1: Search for relevant documents (qmd/retriever)
   - Phase 2: LLM generates extraction script that processes found docs
   - Flow:
     - `_search_for_code_mode(query, limit=15)` → search results
     - `llm.generate_extraction_script(query, documents)` → Python script
     - `code_executor.execute(script)` → extracted/filtered output
     - Fallback on extraction failure: return raw search results

3. **Direct Search (Fallback)**

   ```python
   async def _retrieve_direct(query: str, limit: int = 10) → str
   ```

   - OR-style multi-keyword search (matches ANY keyword)
   - Deduplicate by path, cumulative scoring
   - Extract relevant sections around keyword matches
   - Format: markdown with wikilinks for citation

**Keyword Extraction:**

```python
def _extract_search_keywords(query: str, max_keywords: int = 8) → str
```

- Removes markdown formatting (headers, bold, links, code)
- Filters stop words + short words (≤2 chars)
- Returns space-separated keywords
- Used to prevent qmd hanging on long query expansion

---

## 3. Task Decomposition

### Component: `shad/engine/decomposition.py`

**Purpose:** Strategy-aware task decomposition into DAGs with dependency constraints.

**Classes:**

- `DecompositionNode` - Individual subtask with dependencies
- `DecompositionResult` - Output: nodes + validation
- `StrategyDecomposer` - LLM-driven decomposition

**DecompositionNode Structure:**

```python
@dataclass
class DecompositionNode:
    stage_name: str              # e.g., "clarify_requirements", "implement"
    task: str                    # Specific subtask description
    hard_deps: list[str]         # Stages that MUST complete first
    soft_deps: list[str]         # Stages that help but aren't required
    metadata: dict               # Custom data (artifacts, etc.)
```

**Decomposition Flow:**

1. **Build System Prompt with Strategy Hint Pack**

   ```
   strategy.get_hint_pack() → skeleton stages + optional extensions + constraints
   ```

2. **LLM Generation**

   ```python
   prompt = _build_decomposition_prompt(task, strategy, context, max_nodes)
   response, tokens = await llm.complete(prompt, system=...)
   ```

   - Temperature: 0.3 (deterministic)
   - Expects JSON array of nodes

3. **Parse & Validate**

   ```
   nodes = _parse_response(response)
   validation_errors = _validate_decomposition(nodes, strategy)
   ```

   - Validates all hard_deps stages exist
   - Validates no circular dependencies
   - Optional stages can be added/omitted

**Dependency Execution Model:**

```
Phase 1: Create all child nodes, register dependencies
Phase 2: Execute in parallel waves
  while pending_nodes:
    ready = nodes whose hard_deps are all satisfied
    execute ready nodes in parallel (asyncio.gather)
    collect results → context packets
    mark stages as completed
```

### Context Injection via Soft Dependencies

**Soft Dependency Context Injection:**

```python
async def _decompose_and_execute(run, node, context):
    # For each ready node:
    soft_dep_context = context_manager.inject_soft_dep_context(
        soft_deps=["stage_a", "stage_b"],
        task=task
    )
    # Prepend soft_dep_context to execution context
```

- Retrieves results from completed stages
- Creates context packets with keywords + snippets
- Injects into downstream task context

---

## 4. Code Mode Execution

### Component: `shad/sandbox/executor.py`

**Purpose:** Safe Python code execution with collection access for data extraction/filtering.

**Classes:**

- `SandboxConfig` - Execution environment configuration
- `ExecutionResult` - Execution outcome
- `CodeExecutor` - Sandbox manager

**SandboxConfig Structure:**

```python
@dataclass
class SandboxConfig:
    vault_path: Path              # Collection directory
    collection_name: str | None   # qmd collection name
    timeout_seconds: int = 60     # Execution timeout
    max_memory_mb: int = 512      # Memory limit
    network_enabled: bool = False # No network access
    allowed_imports: list[str] = [
        # Standard library only
        "json", "re", "datetime", "collections", "itertools",
        "functools", "math", "statistics", "hashlib", "pathlib",
        "typing", "dataclasses", "enum", "yaml",
    ]
```

**Execution Environment:**

**Available Globals:**

- `collection`: CollectionTools instance (collection search/read)
- `vault_path`: Path to collection
- Standard library modules (from `allowed_imports`)
- Restricted builtins (no eval, exec, open outside collection)

**CollectionTools Methods:**

- `collection.search(query, limit=10)` → search results
- `collection.read(path)` → file content
- `collection.list_files(pattern)` → files matching glob
- `collection.get_frontmatter(path)` → YAML metadata

**Execution Safety:**

```python
def _restricted_open(file: str | Path, mode: str = "r", ...) → file:
    # Only allow reading files within vault_path
    # Raise PermissionError if escape attempt detected
```

**Code Executor Execute Method:**

```python
async def execute(
    script: str,
    extra_vars: dict[str, Any] | None = None,
) → ExecutionResult:
    # Compile script (syntax check)
    # Execute in globals with collection tools
    # Capture stdout/stderr
    # Return value via special `__result__` variable
    # Measure execution time + memory
```

**ExecutionResult Structure:**

```python
@dataclass
class ExecutionResult:
    success: bool                 # True if no exception
    stdout: str = ""              # Captured print output
    stderr: str = ""              # Captured errors
    return_value: Any = None      # Value of __result__ variable
    error_type: str | None = None # Exception class name
    error_message: str | None = None  # Exception message
    execution_time_ms: int = 0    # Runtime in milliseconds
    memory_used_mb: float = 0.0   # Peak memory usage
```

---

## 5. Caching Layer

### Component: `shad/cache/redis_cache.py`

**Purpose:** Hierarchical, content-aware caching with TTL support.

**Class: `RedisCache`**

**Cache Key Scheme:**

```python
@dataclass
class CacheKey:
    goal_type: str           # "comparison", "explanation", "enumeration", "summary", "general"
    intent: str              # Task intent (e.g., "general")
    entities: tuple[str, ...]  # Named entities in task
    context_hash: str        # SHA256 of context (file hashes)
    extra_slots: tuple[str, ...]  # Optional extra dims
```

**Key Generation:**

```python
@classmethod
def from_task(
    cls,
    task: str,
    context: str = "",
    intent: str = "general",
    entities: list[str] | None = None,
) → CacheKey:
    # Auto-detect goal_type from keywords
    goal_type = detect_goal_type(task)  # "comparison", "explanation", etc.
    # Hash context
    context_hash = hashlib.sha256(context.encode()).hexdigest()
    return CacheKey(goal_type, intent, tuple(entities or []), context_hash)
```

**Cache Entry:**

```python
@dataclass
class CacheEntry:
    key: str                    # Redis key string
    value: str                  # Cached result
    tokens_used: int = 0        # LLM tokens for caching cost
    created_at: str             # ISO timestamp
    ttl_seconds: int | None = None  # Time-to-live
    provisional: bool = False   # Staging cache flag
    metadata: dict = {}         # Custom metadata
```

**Cache API:**

```python
async def get(key: str) → str | None
async def set(key: str, value: str, ttl_seconds: int | None = None, ...)
async def get_entry(key: str) → CacheEntry | None
async def invalidate(pattern: str | None = None)
```

**Cache Invalidation:**

- Time-based: TTL expiration
- Pattern-based: `invalidate("shad:cache:*")` clears all
- Delta verification: manual invalidation on collection changes

---

## 6. History & Observability

### Component: `shad/history/manager.py`

**Purpose:** Structured, append-only run artifacts storage for debugging/replay.

**Class: `HistoryManager`**

**Directory Structure:**

```
~/.shad/history/Runs/<run_id>/
├── run.manifest.json           # Config, versions, hashes
├── events.jsonl                # Node lifecycle events (append-only)
├── dag.json                    # DAG structure + node statuses
├── decisions/
│   ├── routing.json            # Skill routing decision + reasoning
│   └── decomposition/
│       └── <node_id>.json      # Per-node decomposition decisions
├── metrics/
│   ├── nodes.jsonl             # Per-node metrics (tokens, duration, cache, depth)
│   └── summary.json            # Rollup metrics (total nodes, tokens, cache hits)
├── errors/                     # Error records with full context
│   └── <error_id>.json
├── artifacts/                  # Large payloads (referenced by hash)
│   └── <hash>.bin
├── replay/
│   └── manifest.json           # Deterministic replay bundle
├── final.report.md             # Human-readable output + metrics
└── final.summary.json          # Machine-readable: status, result, citations, actions
```

**Run Manifest:**

```json
{
  "run_id": "uuid",
  "version": "1.0",
  "config": {
    "goal": "task description",
    "vault_path": "/path/to/collection",
    "budget": {
      "max_wall_time": 300,
      "max_tokens": 100000,
      "max_nodes": 50,
      "max_depth": 3,
      "max_branching_factor": 7
    },
    "voice": "default"
  },
  "status": "complete",
  "created_at": "2026-02-05T...",
  "started_at": "2026-02-05T...",
  "completed_at": "2026-02-05T...",
  "total_tokens": 15000,
  "stop_reason": null,
  "error": null,
  "final_result": "..."
}
```

**DAG JSON:**

```json
{
  "root_node_id": "abc123",
  "nodes": [
    {
      "node_id": "abc123",
      "parent_id": null,
      "depth": 0,
      "task": "Build a REST API",
      "status": "succeeded",
      "result": "...",
      "children": ["def456", "ghi789"],
      "cache_key": "shad:cache:...",
      "cache_hit": false,
      "tokens_used": 1500,
      "start_time": "2026-02-05T...",
      "end_time": "2026-02-05T...",
      "error": null,
      "stop_reason": null
    }
  ]
}
```

**Metrics (nodes.jsonl - one line per node):**

```json
{
  "node_id": "abc123",
  "depth": 0,
  "status": "succeeded",
  "tokens_used": 1500,
  "cache_hit": false,
  "duration_ms": 5000
}
```

**Metrics Summary:**

```json
{
  "total_nodes": 15,
  "completed_nodes": 14,
  "failed_nodes": 1,
  "max_depth_reached": 2,
  "total_tokens": 45000,
  "cache_hits": 3,
  "total_duration_ms": 120000
}
```

**HistoryManager API:**

```python
def save_run(run: Run) → Path            # Save all artifacts
def load_run(run_id: str) → Run          # Reconstruct run from artifacts
def list_runs(limit: int = 50) → list    # List recent runs with metadata
def append_event(run_id: str, event: dict) → None  # Append event to jsonl
```

---

## 7. Models & Data Structures

### Component: `shad/models/run.py`

**Run Execution Model:**

**RunStatus (enum):**

- `PENDING` - Waiting to start
- `RUNNING` - In progress
- `COMPLETE` - Successfully completed
- `PARTIAL` - Incomplete (budget exhausted)
- `FAILED` - Error occurred
- `ABORTED` - User cancelled

**NodeStatus (enum):**

- `CREATED` - Initial state
- `READY` - Dependencies satisfied, ready to execute
- `STARTED` - Execution in progress
- `SUCCEEDED` - Result produced
- `FAILED` - Execution failed
- `PRUNED` - Skipped (novelty check, etc.)
- `CACHE_HIT` - Result from cache

**StopReason (enum):**

- `COMPLETE` - Normal completion
- `BUDGET_DEPTH` - Max recursion depth reached
- `BUDGET_NODES` - Max DAG size reached
- `BUDGET_TIME` - Wall time limit exceeded
- `BUDGET_TOKENS` - Token limit exceeded
- `NOVELTY_PRUNED` - Pruned by novelty check
- `ERROR` - Exception occurred
- `ABORTED` - User cancellation

**RunConfig:**

```python
class RunConfig:
    goal: str                    # Task description
    vault_path: str | None       # Collection directory
    budget: Budget               # Execution constraints
    voice: str | None            # Output voice/style
    strategy_override: str | None  # Force strategy type
    verify_level: str | None     # Verification: off|basic|build|strict
    write_files: bool            # Write output files
    output_path: str | None      # Output directory
    model_config_override: ModelConfig | None  # Model per tier
```

**DAGNode:**

```python
class DAGNode:
    node_id: str                 # UUID (8 chars)
    parent_id: str | None        # Parent node
    depth: int                   # Recursion depth (0 = root)
    task: str                    # Subtask description
    status: NodeStatus           # Current status
    result: str | None           # Execution output
    children: list[str]          # Child node IDs
    cache_key: str | None        # Cache key used
    cache_hit: bool              # Was this a cache hit?
    tokens_used: int             # LLM tokens consumed
    start_time: datetime | None  # Execution start
    end_time: datetime | None    # Execution end
    error: str | None            # Error message
    stop_reason: StopReason | None
    metadata: dict               # Custom data (stage_name, artifacts, etc.)

    def duration_ms(self) → int | None:
        """Duration in milliseconds."""
```

**Run:**

```python
class Run:
    run_id: str                  # UUID
    config: RunConfig            # Configuration
    status: RunStatus            # Current status
    root_node_id: str | None     # Root DAG node
    nodes: dict[str, DAGNode]    # All nodes by ID
    created_at: datetime         # Creation time
    started_at: datetime | None  # Execution start
    completed_at: datetime | None  # Execution end
    total_tokens: int            # Cumulative tokens
    stop_reason: StopReason | None  # Stop reason
    error: str | None            # Error message
    final_result: str | None     # Root node result
    citations: list[str]         # Sources
    metadata: dict               # manifest, verification, repaired, etc.

    def get_node(node_id: str) → DAGNode | None
    def add_node(node: DAGNode) → None
    def completed_nodes() → list[DAGNode]
    def failed_nodes() → list[DAGNode]
    def pending_nodes() → list[DAGNode]
```

---

## 8. Verification Layer (Phase 5)

### Component: `shad/verification/layer.py`

**Purpose:** Runtime validation of generated code (manifest verification).

**Classes:**

- `VerificationLevel` - Strictness: off, basic, build, strict
- `VerificationConfig` - Verification settings
- `VerificationResult` - Checks + pass/fail status
- `VerificationLayer` - Main verifier

**Verification Levels:**
| Level | Checks | Use Case |
|-------|--------|----------|
| `off` | None | Disable verification |
| `basic` | Imports + syntax | Default |
| `build` | + type checking | Pre-commit |
| `strict` | + unit tests | Production |

**Check Types:**

- `syntax` - Code parses
- `imports` - All imports exist
- `lint` - Style rules (oxlint)
- `types` - TypeScript/Python type checking
- `tests` - Unit test execution
- `contracts` - Function/type signatures match

**VerificationResult:**

```python
@dataclass
class VerificationResult:
    passed: bool                 # All checks passed?
    checks: list[CheckResult]    # Individual check results
    failed_checks: list[CheckResult]  # Failed checks only
    blocking_failures: list[CheckResult]  # Failures that block deployment

@dataclass
class CheckResult:
    check_name: str              # "syntax", "imports", etc.
    passed: bool
    errors: list[str]            # Error messages
```

**Verification API:**

```python
async def verify(
    manifest: FileManifest,
    config: VerificationConfig,
) → VerificationResult:
    # Run checks in order (syntax first, then imports, etc.)
    # Return pass/fail with detailed error context
```

---

## 9. Refinement & Delta Verification (Phase 6)

### Component: `shad/refinement/manager.py`

**Purpose:** Iterative repair of verification failures + delta verification on resume.

**Classes:**

- `DeltaVerifier` - Tracks node context hashes
- `RunStateManager` - State machine (RUNNING → SUCCESS/PARTIAL/FAILED/NEEDS_HUMAN)
- `MaxIterationsPolicy` - Determines final state

**Delta Verification:**

**Node Context Tracking:**

```python
def _track_node_context(
    node_id: str,
    context: str,
    vault_path: str | None = None,
) → None:
    # Extract wikilinks from context: [[path/to/note]]
    # Hash each note's content (or use metadata hash)
    # Store in DeltaVerifier:
    #   node.used_notes = ["path/to/note.md", ...]
    #   node.used_note_hashes = {"path/to/note.md": "hash123", ...}
    #   node.subset_fingerprint = combined_hash
```

**Resume & Delta Verification:**

```python
async def resume(run: Run, replay_mode: str | None = None) → Run:
    if replay_mode == "stale":
        # Get current collection hashes
        current_hashes = await _get_current_collection_hashes(run)
        # Find nodes where used_note_hashes don't match current_hashes
        stale_nodes = delta_verifier.get_stale_nodes(current_hashes)
        # Re-execute stale nodes only
        nodes_to_replay = stale_nodes
```

**Repair Loop:**

**Error Classification:**

- `SYNTAX` - Code doesn't parse → local repair only
- `IMPORT` - Missing dependency → local repair
- `TYPE` - Type mismatch → local repair + sibling context
- `INTEGRATION` - Module mismatch → escalate to parent
- `CONTRACT` - Signature mismatch → escalate + replan

**Repair Actions:**

```python
async def _attempt_repair(
    run: Run,
    manifest: FileManifest,
    failures: list[CheckResult],
    verify_level: VerificationLevel,
) → FileManifest | None:
    for failure in failures:
        classification = ErrorClassification.classify(failure.check_name, error)
        repair_action = RepairAction.for_classification(classification)

        if repair_action.scope == "escalate":
            # Re-run parent node with error context
            # (not implemented in current MVP)
            continue

        # Local repair: extract file path, build context, call LLM
        file_path = _extract_file_from_error(error)
        repair_context = f"Error in {file_path}:\n{error}"

        if repair_action.needs_sibling_context:
            # Include related files (types, contracts)
            sibling_context = _get_sibling_context(manifest, file_path)
            repair_context += f"\nRelated files:\n{sibling_context}"

        repaired_content, tokens = await llm.answer_task(
            task=f"Fix the error:\n{repair_context}",
            context=""
        )

        # Extract code block from LLM response
        repaired_code = _extract_code_from_response(repaired_content, language)

        # Update manifest
        manifest.update_file(FileEntry(path=file_path, content=repaired_code, ...))

    return manifest
```

**State Machine (RunStateManager):**

```
RUNNING
  ↓
SUCCESS (all checks pass)
  ↓
COMPLETE

OR

RUNNING
  ↓
VERIFICATION_FAILED (blocking failures)
  ↓
REPAIR_ATTEMPTED (retry loop)
    ├→ SUCCESS → COMPLETE
    ├→ PARTIAL (some failures remain) → PARTIAL
    └→ FAILED (max retries exceeded) → FAILED or NEEDS_HUMAN
```

---

## 10. Context Packet Management

### Component: `shad/engine/context_packets.py`

**Purpose:** Inject soft dependency results into downstream task context.

**Classes:**

- `ContextPacket` - Structured result from completed stage
- `NodeContextManager` - Packet storage + injection

**ContextPacket:**

```python
@dataclass
class ContextPacket:
    node_id: str                 # Source node
    stage_name: str              # Stage identifier
    result: str                  # Task result
    artifacts: list[str]         # File paths, IDs, etc.
    keywords: list[str]          # Extracted keywords for matching
    timestamp: datetime
```

**Context Injection:**

**Soft Dependency Injection Flow:**

```python
# In parallel execution wave, before executing node with soft_deps:
for stage_name in node.soft_deps:
    # Find packet from completed stage
    packet = context_manager.store.get(stage_name)
    if packet:
        # Extract relevant sections from result
        soft_dep_context = f"# Result from {stage_name}\n{packet.result[:2000]}"
        # Prepend to task context
        task_context = f"{soft_dep_context}\n\n{original_context}"
```

**Keyword Matching:**

- Each packet pre-computes keywords from result
- During injection, use keywords to find most relevant packets
- Avoids including unrelated completed stages

---

## 11. Data Flow Diagrams

### Execution Pipeline

```
User Goal
    ↓
RLMEngine.execute(config)
    ↓
+--- Strategy Selection ──→ StrategyType (software|research|etc.)
    ↓
+--- Context Retrieval ──→ RetrievalLayer.search() ──→ [RetrievalResult] ──→ context_string
    ├── qmd_hybrid (vector search) [RECOMMENDED]
    ├── Code Mode (extraction script) [FLEXIBLE]
    └── Direct Search (BM25) [FALLBACK]
    ↓
+--- DAG Construction ──→ StrategyDecomposer.decompose()
    ├→ LLM generates subtasks + dependencies
    └→ DecompositionNode[] with hard_deps/soft_deps
    ↓
+--- Parallel Execution ──→ asyncio.gather(execute_ready_nodes)
    ├→ Cache.get(cache_key) [HIT/MISS]
    ├→ Leaf execution: leaf_model.answer_task()
    ├→ Recursive: _decompose_and_execute()
    ├→ Synthesis: combine child results
    └→ Cache.set(cache_key, result)
    ↓
+--- File Manifest Generation (software strategy only)
    ├→ Extract code blocks from results
    ├→ Create FileEntry[] (path, content, language)
    └→ FileManifest(files=[])
    ↓
+--- Verification (Phase 5) ──→ VerificationLayer.verify()
    ├→ Syntax, imports, lint, types, tests
    ├→ On failure: Repair loop
    └→ VerificationResult(passed, checks, failures)
    ↓
+--- Refinement (Phase 6) ──→ State machine
    ├→ Delta verification (collection hashes)
    └→ RunStateManager.transition_to(final_state)
    ↓
+--- History Persistence ──→ HistoryManager.save_run()
    └→ ~/.shad/history/Runs/<run_id>/ (manifest, DAG, metrics, report)
    ↓
Return Run (status, final_result, metadata)
```

### Retrieval Pipeline

```
Task Query
    ↓
_extract_search_keywords() [remove stop words, markdown]
    ↓
if len(query) > 100 or multiline:
    search_query = extracted_keywords
else:
    search_query = original_query
    ↓
if use_qmd_hybrid:
    qmd.search(query, mode="vector", collections=[...], limit=10)
        └→ [RetrievalResult]

elif use_code_mode:
    Phase 1: qmd.search(query, mode="bm25", limit=15) → search_results
    Phase 2: llm.generate_extraction_script(query, search_results)
             code_executor.execute(script, DOCUMENTS=search_results)
    Fallback: _format_raw_results(search_results)

else:  # Direct search
    for keyword in keywords:
        qmd.search(keyword, mode="bm25", limit=10) → results
    deduplicate by path (cumulative scoring)
    extract relevant sections (context_lines around matches)
    ↓
Format Results:
    For each result:
        path → wikilink [[path/to/note]]
        content → snippet or first 4000 chars
        Join with "---" separator
    ↓
Return context_string
```

### Cache Mechanism

```
Task + Context
    ↓
cache_key = _make_cache_key(task, context)
    [SHA256 hash of task + context[:500]]
    ↓
Redis.get(cache_key)
    ├→ HIT: node.cache_hit = True, return cached result
    └→ MISS: proceed to execution
    ↓
Execute node (leaf or recursive)
    ↓
On success: Redis.set(cache_key, result, ttl=24h)
On failure: don't cache
    ↓
Track context: _track_node_context(node_id, context)
    [Extract wikilinks, hash content for delta verification]
```

---

## 12. API Entry Points

### CLI Integration

**Shad CLI Commands:**

```bash
shad run "task description" --collection /path --strategy software --verify strict
shad resume <run_id> --replay-mode stale
shad status <run_id>
shad trace tree <run_id>
shad list --limit 10
```

**Direct Python API:**

```python
from shad.engine.rlm import RLMEngine
from shad.models import RunConfig, Budget

engine = RLMEngine(vault_path="/path/to/collection")
config = RunConfig(
    goal="Build a REST API",
    vault_path="/path/to/collection",
    budget=Budget(max_depth=3, max_tokens=100000),
)
run = await engine.execute(config)
print(run.final_result)
```

### FastAPI Server

**Endpoints (if deployed as API service):**

- `POST /api/runs` - Start a new run
- `GET /api/runs/<run_id>` - Get run status
- `POST /api/runs/<run_id>/resume` - Resume partial run
- `WebSocket /ws` - Real-time event streaming

---

## 13. Configuration & Settings

### Environment Variables

```bash
SHAD_COLLECTION_PATH=/home/user/.shad/collections
SHAD_HISTORY_PATH=/home/user/.shad/history
SHAD_CACHE_URL=redis://localhost:6379/0
SHAD_LOG_LEVEL=INFO
QMD_OPENAI=1  # Enable qmd embeddings
```

### Settings Model

```python
class Settings:
    vault_path: Path = Path.home() / ".shad" / "collections"
    history_path: Path = Path.home() / ".shad" / "history"
    cache_url: str = "redis://localhost:6379/0"
    log_level: str = "INFO"
    timeout_seconds: int = 300
    max_workers: int = 10
    api_key: str = ""  # Anthropic API key
```

---

## 14. Success Criteria Checklist

### Component Inventory ✅

- [x] RLM Engine (recursive decomposition, execution, budgeting)
- [x] Retrieval Layer (qmd integration, BM25+vector+rerank)
- [x] Task Decomposition (strategy-aware, dependency DAG)
- [x] Code Mode Execution (sandbox with collection access)
- [x] Caching Layer (hierarchical, content-aware)
- [x] History Manager (append-only artifacts, replay)
- [x] Models (Run, DAG, Config, Status)
- [x] Verification Layer (manifest checks, repair loop)
- [x] Refinement Manager (delta verification, state machine)
- [x] Context Packets (soft dependency injection)

### Code Locations ✅

- RLM: `/home/jake/.shad/repo/services/shad-api/src/shad/engine/rlm.py` (1600 lines)
- Retrieval: `/home/jake/.shad/repo/services/shad-api/src/shad/retrieval/qmd.py` (494 lines)
- Decomposition: `/home/jake/.shad/repo/services/shad-api/src/shad/engine/decomposition.py` (200+ lines)
- Sandbox: `/home/jake/.shad/repo/services/shad-api/src/shad/sandbox/executor.py` (150+ lines)
- Cache: `/home/jake/.shad/repo/services/shad-api/src/shad/cache/redis_cache.py` (100+ lines)
- History: `/home/jake/.shad/repo/services/shad-api/src/shad/history/manager.py` (402 lines)
- Models: `/home/jake/.shad/repo/services/shad-api/src/shad/models/run.py` (164 lines)

### Interface Signatures ✅

- RLMEngine: `__init__()`, `execute()`, `resume()`, retrieval methods
- QmdRetriever: `search()`, `get()`, `add_collection()`, `list_collections()`
- StrategyDecomposer: `decompose()` → DecompositionResult
- CodeExecutor: `execute()` → ExecutionResult
- HistoryManager: `save_run()`, `load_run()`, `append_event()`

### Data Flow Descriptions ✅

- Execution pipeline (14 steps from goal to history)
- Retrieval pipeline (keyword extraction → search → formatting)
- Cache mechanism (key generation → hit/miss → persistence)
- Decomposition (strategy skeleton → LLM → validation)
- Verification (checks → repair → state transition)

---

## 15. Integration Patterns

### With Edwin

Shad is integrated into Edwin's knowledge system via:

1. **Memory Recall**: Edwin CLI calls `shad run "query" --collection ~/clawd` to retrieve context
2. **Task Decomposition**: Complex agent tasks use Shad's DAG decomposition
3. **Code Generation**: Software tasks use Shad's strategy-aware decomposition + verification
4. **Context Injection**: Soft dependencies inject results into agent prompts

### Multi-Collection Support

Shad supports multiple collections through:

```python
RLMEngine(
    vault_path="/path/to/vault1",
    collections=["vault1", "vault2"],
    ...
)
```

- Each collection has its own qmd index
- Search can filter by collection
- Results include collection name for disambiguation

---

## 16. Performance Characteristics

### Latency (p50/p99)

- **Strategy selection**: 2-5s (LLM call)
- **Context retrieval**: 2-3s (qmd vector search) or 5-10s (extraction)
- **Decomposition**: 3-8s per node
- **Leaf execution**: 2-5s per leaf node
- **Verification**: 5-15s per manifest

### Memory Usage

- **Retrieval index** (qmd): ~2-5 GB for 100K+ documents
- **Code executor** (sandbox): ~200-500 MB per execution
- **Cache (Redis)**: Variable (TTL-based eviction)

### Throughput

- Parallel execution: up to `max_branching_factor` (default 7) nodes/wave
- Multiple waves: bounded by `max_depth` (default 3)
- Total nodes: up to `max_nodes` (default 50)

---

## 17. Future Work & Extensibility

### Planned Components

- Human-in-the-loop verification (Phase 6 blocking failures)
- Novel artifact detection (prevent redundant generation)
- Skill routing (specialized agents for subtasks)
- Multi-agent coordination (distributed DAG execution)
- Adaptive budgeting (adjust based on task complexity)

### Extension Points

- Custom strategies (extend StrategyType enum + skeleton YAML)
- Custom verifiers (extend VerificationLayer)
- Custom retrievers (implement RetrievalLayer interface)
- Custom sandbox tools (add to CollectionTools)

---

**Document Version:** 1.0
**Last Updated:** 2026-02-05
**Curator:** Edwin (Jake's CTO)
