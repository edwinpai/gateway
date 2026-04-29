import type { MemoryAccessScope } from "./access-policy.js";
import type { MemoryTier } from "./taxonomy.js";

export type MemorySource = "memory" | "sessions";

export type MemoryType = "semantic_memory" | "episodic_memory";

export type MemorySearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: MemorySource;
  citation?: string;
  /** Memory tier classification (if available). */
  tier?: MemoryTier;
  /** When the event described by this memory occurred (if available). */
  eventTime?: Date;
  /** Temporal decay score applied at query time (if available). */
  temporalScore?: number;
};

export type MemoryEmbeddingProbeResult = {
  ok: boolean;
  error?: string;
};

export type MemorySyncProgressUpdate = {
  completed: number;
  total: number;
  label?: string;
};

export type MemoryProviderStatus = {
  backend: "builtin" | "qmd";
  provider: string;
  model?: string;
  requestedProvider?: string;
  files?: number;
  chunks?: number;
  dirty?: boolean;
  workspaceDir?: string;
  dbPath?: string;
  extraPaths?: string[];
  sources?: MemorySource[];
  sourceCounts?: Array<{ source: MemorySource; files: number; chunks: number }>;
  cache?: { enabled: boolean; entries?: number; maxEntries?: number };
  fts?: { enabled: boolean; available: boolean; error?: string };
  fallback?: { from: string; reason?: string };
  vector?: {
    enabled: boolean;
    available?: boolean;
    extensionPath?: string;
    loadError?: string;
    dims?: number;
  };
  batch?: {
    enabled: boolean;
    failures: number;
    limit: number;
    wait: boolean;
    concurrency: number;
    pollIntervalMs: number;
    timeoutMs: number;
    lastError?: string;
    lastProvider?: string;
  };
  custom?: Record<string, unknown>;
};

export type MemorySearchOptions = {
  maxResults?: number;
  minScore?: number;
  sessionKey?: string;
  source?: MemorySource | MemorySource[];
  memory_type?: MemoryType;
  accessScope?: MemoryAccessScope;
};

export type MemoryReadFileParams = {
  relPath: string;
  from?: number;
  lines?: number;
  accessScope?: MemoryAccessScope;
};

export type MemoryReadFileResult = { text: string; path: string };

export interface MemoryRetrievalRuntime {
  search(query: string, opts?: MemorySearchOptions): Promise<MemorySearchResult[]>;
  readFile(params: MemoryReadFileParams): Promise<MemoryReadFileResult>;
  close?(): Promise<void>;
}

export interface MemoryDiagnosticsRuntime {
  status(): MemoryProviderStatus;
  probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult>;
  probeVectorAvailability(): Promise<boolean>;
  close?(): Promise<void>;
}

export interface MemoryQueryRuntime extends MemoryRetrievalRuntime, MemoryDiagnosticsRuntime {}

export interface MemoryIndexLifecycleController {
  sync?(params?: {
    reason?: string;
    force?: boolean;
    progress?: (update: MemorySyncProgressUpdate) => void;
  }): Promise<void>;
  /** Register a callback invoked after the index is updated (re-indexed or re-embedded). */
  onIndexChanged?(callback: () => void): void;
  /** Track new tokens for hybrid embed scheduling. */
  trackNewTokens?(count: number): void;
  /** Trigger a BM25-only index update (fast, ~1s). Does not block on embedding. */
  flushIndex?(reason: string): Promise<void>;
}

export interface MemorySearchManager extends MemoryQueryRuntime, MemoryIndexLifecycleController {}
