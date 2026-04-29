import type {
  MemoryLikeEmbeddingProbeResult,
  MemoryLikeSearchManager,
  MemoryLikeSyncProgressUpdate,
} from "./types.js";

export type InstantiatedMemorySearchManager = {
  manager: MemoryLikeSearchManager | null;
  backend: "builtin" | "qmd";
};

export async function instantiateMemoryEngineRuntime(params: {
  primaryBackend?: "qmd";
  createPrimary?: () => Promise<MemoryLikeSearchManager | null>;
  createFallback: () => Promise<MemoryLikeSearchManager | null>;
  onPrimaryCreateError?: (message: string) => void;
  onPrimaryClose?: () => void;
}): Promise<InstantiatedMemorySearchManager> {
  if (params.primaryBackend && params.createPrimary) {
    try {
      const primary = await params.createPrimary();
      if (primary) {
        return {
          backend: params.primaryBackend,
          manager: new FallbackMemoryManager(
            {
              primary,
              fallbackFactory: params.createFallback,
            },
            params.onPrimaryClose,
          ),
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      params.onPrimaryCreateError?.(message);
    }
  }

  return {
    backend: "builtin",
    manager: await params.createFallback(),
  };
}

class FallbackMemoryManager implements MemoryLikeSearchManager {
  private fallback: MemoryLikeSearchManager | null = null;
  private primaryFailed = false;
  private lastError?: string;

  constructor(
    private readonly deps: {
      primary: MemoryLikeSearchManager;
      fallbackFactory: () => Promise<MemoryLikeSearchManager | null>;
    },
    private readonly onClose?: () => void,
  ) {}

  async search(query: string, opts?: unknown) {
    if (!this.primaryFailed) {
      try {
        return await this.deps.primary.search(query, opts as never);
      } catch (err) {
        this.primaryFailed = true;
        this.lastError = err instanceof Error ? err.message : String(err);
        warn(`qmd memory failed; switching to builtin index: ${this.lastError}`);
        await this.deps.primary.close?.().catch(() => {});
      }
    }
    const fallback = await this.ensureFallback();
    if (fallback) {
      return await fallback.search(query, opts as never);
    }
    throw new Error(this.lastError ?? "memory search unavailable");
  }

  async readFile(params: unknown) {
    if (!this.primaryFailed) {
      return await this.deps.primary.readFile(params as never);
    }
    const fallback = await this.ensureFallback();
    if (fallback) {
      return await fallback.readFile(params as never);
    }
    throw new Error(this.lastError ?? "memory read unavailable");
  }

  status() {
    if (!this.primaryFailed) {
      return this.deps.primary.status();
    }
    const fallbackStatus = this.fallback?.status();
    const fallbackInfo = { from: "qmd", reason: this.lastError ?? "unknown" };
    if (fallbackStatus) {
      const custom = fallbackStatus.custom ?? {};
      return {
        ...fallbackStatus,
        fallback: fallbackInfo,
        custom: {
          ...custom,
          fallback: { disabled: true, reason: this.lastError ?? "unknown" },
        },
      };
    }
    const primaryStatus = this.deps.primary.status();
    const custom = primaryStatus.custom ?? {};
    return {
      ...primaryStatus,
      fallback: fallbackInfo,
      custom: {
        ...custom,
        fallback: { disabled: true, reason: this.lastError ?? "unknown" },
      },
    };
  }

  async sync(params?: {
    reason?: string;
    force?: boolean;
    progress?: (update: MemoryLikeSyncProgressUpdate) => void;
  }) {
    if (!this.primaryFailed) {
      await this.deps.primary.sync?.(params);
      return;
    }
    const fallback = await this.ensureFallback();
    await fallback?.sync?.(params);
  }

  async probeEmbeddingAvailability(): Promise<MemoryLikeEmbeddingProbeResult> {
    if (!this.primaryFailed) {
      return await this.deps.primary.probeEmbeddingAvailability();
    }
    const fallback = await this.ensureFallback();
    if (fallback) {
      return await fallback.probeEmbeddingAvailability();
    }
    return { ok: false, error: this.lastError ?? "memory embeddings unavailable" };
  }

  async probeVectorAvailability() {
    if (!this.primaryFailed) {
      return await this.deps.primary.probeVectorAvailability();
    }
    const fallback = await this.ensureFallback();
    return (await fallback?.probeVectorAvailability()) ?? false;
  }

  trackNewTokens(count: number): void {
    this.deps.primary.trackNewTokens?.(count);
  }

  async flushIndex(reason: string): Promise<void> {
    await this.deps.primary.flushIndex?.(reason);
  }

  async close() {
    await this.deps.primary.close?.();
    await this.fallback?.close?.();
    this.onClose?.();
  }

  private async ensureFallback(): Promise<MemoryLikeSearchManager | null> {
    if (this.fallback) {
      return this.fallback;
    }
    const fallback = await this.deps.fallbackFactory();
    if (!fallback) {
      warn("memory fallback requested but builtin index is unavailable");
      return null;
    }
    this.fallback = fallback;
    return this.fallback;
  }
}

function warn(message: string): void {
  console.warn(`[memory] ${message}`);
}
