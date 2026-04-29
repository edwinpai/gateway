export type MemoryLikeAccessScope = unknown;

export type MemoryLikeSearchOptions = {
  maxResults?: number;
  minScore?: number;
  sessionKey?: string;
  source?: "memory" | "sessions" | Array<"memory" | "sessions">;
  memory_type?: string;
  accessScope?: MemoryLikeAccessScope;
};

export type MemoryLikeReadFileParams = {
  relPath: string;
  from?: number;
  lines?: number;
  accessScope?: MemoryLikeAccessScope;
};

export type MemoryLikeProviderStatus = {
  backend: "builtin" | "qmd";
  provider: string;
  custom?: Record<string, unknown>;
  fallback?: { from: string; reason?: string };
};

export type MemoryLikeEmbeddingProbeResult = {
  ok: boolean;
  error?: string;
};

export type MemoryLikeSyncProgressUpdate = {
  completed: number;
  total: number;
  label?: string;
};

export interface MemoryLikeSearchManager {
  search(query: string, opts?: MemoryLikeSearchOptions): Promise<unknown>;
  readFile(params: MemoryLikeReadFileParams): Promise<unknown>;
  status(): MemoryLikeProviderStatus;
  sync?(params?: {
    reason?: string;
    force?: boolean;
    progress?: (update: MemoryLikeSyncProgressUpdate) => void;
  }): Promise<void>;
  probeEmbeddingAvailability(): Promise<MemoryLikeEmbeddingProbeResult>;
  probeVectorAvailability(): Promise<boolean>;
  trackNewTokens?(count: number): void;
  flushIndex?(reason: string): Promise<void>;
  close?(): Promise<void>;
}
