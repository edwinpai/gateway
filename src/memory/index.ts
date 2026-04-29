/**
 * @internal Seam-internal memory aggregator.
 *
 * Keep this file inside `src/memory/**`. New production callers should prefer
 * the purpose-specific `public-*` entrypoints (outside the subsystem) or the
 * narrower direct modules (inside the subsystem) instead of treating
 * `memory/index.ts` as a public hub.
 */
export { MemoryIndexManager } from "./manager.js";
export type {
  MemoryDiagnosticsRuntime,
  MemoryEmbeddingProbeResult,
  MemoryIndexLifecycleController,
  MemoryQueryRuntime,
  MemoryProviderStatus,
  MemoryReadFileParams,
  MemoryReadFileResult,
  MemoryRetrievalRuntime,
  MemorySearchManager,
  MemorySearchOptions,
  MemorySearchResult,
} from "./types.js";
export {
  getMemoryDiagnosticsRuntime,
  type MemoryDiagnosticsRuntimeResult,
} from "./diagnostics-runtime.js";
export { getMemoryQueryRuntime, type MemoryQueryRuntimeResult } from "./query-runtime.js";
export {
  getMemoryRetrievalRuntime,
  type MemoryRetrievalRuntimeResult,
} from "./retrieval-runtime.js";
export { getMemorySearchManager, type MemorySearchManagerResult } from "./search-manager.js";
