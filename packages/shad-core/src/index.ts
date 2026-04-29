/**
 * Initial private shad-core workspace seam.
 *
 * This package boundary exists before the full engine-side memory cluster has
 * moved behind it. Exports are added only as concrete engine slices migrate.
 */
export {
  instantiateMemoryEngineRuntime,
  type InstantiatedMemorySearchManager,
} from "./engine-runtime.js";
export type {
  MemoryLikeEmbeddingProbeResult,
  MemoryLikeProviderStatus,
  MemoryLikeReadFileParams,
  MemoryLikeSearchManager,
  MemoryLikeSearchOptions,
  MemoryLikeSyncProgressUpdate,
} from "./types.js";
