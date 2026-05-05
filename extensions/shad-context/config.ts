import { homedir } from "node:os";
import { join } from "node:path";

export type ShadContextConfig = {
  collectionPaths: string[];
  shadBin: string;
  maxChars: number;
  timeout: number;
  searchMode: "hybrid" | "bm25" | "vector";
  limit: number;

  /** Model used by `shad context` for synthesis/reranking */
  leafModel: string | null;

  /**
   * If enabled, spawn an asynchronous deep RLM run (shad run --profile fast)
   * when recall confidence is low (heuristic).
   *
   * This is intentionally NOT on the hot path.
   */
  asyncRlm: boolean;
  rlmProfile: "fast" | "balanced" | "deep";
  rlmMaxTimeSec: number;

  minPromptChars: number;
  cacheTtlMs: number;
  cacheMaxEntries: number;
  autoRecall: boolean;
  autoCapture: boolean;
  captureDir: string;
  rlmDir: string;

  // ---- Task Router ----
  /** Enable the task router (fast/recall/deep lane classification). Default: true */
  routerEnabled: boolean;

  // ---- Semantic Cache ----
  /** Enable semantic (embedding-similarity) cache. Default: true */
  semanticCacheEnabled: boolean;
  /** Cosine similarity threshold for hard cache hits. Default: 0.92 */
  semanticCacheThreshold: number;
  /** Cosine similarity threshold for soft hits (returned but flagged). Default: 0.85 */
  semanticCacheSoftThreshold: number;
  /** Maximum entries in semantic cache. Default: 500 */
  semanticCacheMaxEntries: number;
  /** TTL for semantic cache entries in ms. Default: 86400000 (24h) */
  semanticCacheTtlMs: number;
  /** Path for the semantic cache SQLite DB. Default: <first collectionPath>/.cache/semantic-cache.db */
  semanticCacheDbPath: string;
  /** OpenAI API key for embeddings (falls back to OPENAI_API_KEY env var) */
  embeddingApiKey: string;
  /** Embedding model. Default: text-embedding-3-small */
  embeddingModel: string;
  /** Vector dimensions for the embedding model. Default: 1536 */
  embeddingDims: number;

  // ---- Deep Workflow ----
  /** Enable the deep workflow lane. Default: false (must be explicitly opted in) */
  deepWorkflowEnabled: boolean;
  /** Run deep workflow synchronously (blocks agent). Default: false (async) */
  deepWorkflowSync: boolean;
  /** Timeout for synchronous deep workflow before falling back to async (ms). Default: 60000 */
  deepWorkflowSyncTimeoutMs: number;
  /** RLM profile for deep workflow. Default: "balanced" */
  deepWorkflowProfile: "fast" | "balanced" | "deep";
  /** Legacy direct-provider setting, retained for backward-compatible config parsing. */
  deepWorkflowApiProvider: "openai" | "anthropic";
  /** Legacy direct-provider setting, retained for backward-compatible config parsing. */
  deepWorkflowApiKey: string;
  /** Model for deep workflow synthesis. Accepts provider/model, alias, or "primary". Default: primary */
  deepWorkflowSynthesisModel: string;
  /** Max tokens for deep workflow synthesis output. Default: 4096 */
  deepWorkflowMaxTokens: number;
  /** Number of qmd results per search query. Default: 8 */
  deepWorkflowQmdResults: number;
  /** qmd collection name to search. Default: workspace */
  deepWorkflowQmdCollection: string;
  /** Spawn async shad run for deeper analysis. Default: false */
  deepWorkflowAsyncRlm: boolean;
};

// Back-compat: vaultPaths maps to collectionPaths
export type ShadContextConfigInput = Partial<ShadContextConfig> & {
  vaultPaths?: string[];
};

const DEFAULT_SHAD_BIN = join(homedir(), ".shad", "bin", "shad");
const DEFAULT_VAULT_PATH = join(homedir(), ".edwinpai", "workspace");
const VALID_MODES = new Set(["hybrid", "bm25", "vector"]);
const VALID_RLM_PROFILES = new Set(["fast", "balanced", "deep"]);

const ALLOWED_KEYS = [
  "collectionPaths",
  "vaultPaths",
  "shadBin",
  "maxChars",
  "timeout",
  "searchMode",
  "limit",
  "leafModel",
  "asyncRlm",
  "rlmProfile",
  "rlmMaxTimeSec",
  "minPromptChars",
  "cacheTtlMs",
  "cacheMaxEntries",
  "autoRecall",
  "autoCapture",
  "captureDir",
  "rlmDir",
  // Router
  "routerEnabled",
  // Semantic cache
  "semanticCacheEnabled",
  "semanticCacheThreshold",
  "semanticCacheSoftThreshold",
  "semanticCacheMaxEntries",
  "semanticCacheTtlMs",
  "semanticCacheDbPath",
  "embeddingApiKey",
  "embeddingModel",
  "embeddingDims",
  // Deep workflow
  "deepWorkflowEnabled",
  "deepWorkflowSync",
  "deepWorkflowSyncTimeoutMs",
  "deepWorkflowProfile",
  "deepWorkflowApiProvider",
  "deepWorkflowApiKey",
  "deepWorkflowSynthesisModel",
  "deepWorkflowMaxTokens",
  "deepWorkflowQmdResults",
  "deepWorkflowQmdCollection",
  "deepWorkflowAsyncRlm",
];

function assertAllowedKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) {
    return;
  }
  throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
}

function resolveCollectionPaths(cfg: Record<string, unknown>): string[] {
  const paths: string[] = [];

  // From config (preferred)
  if (Array.isArray(cfg.collectionPaths) && cfg.collectionPaths.length > 0) {
    paths.push(
      ...cfg.collectionPaths.filter((v): v is string => typeof v === "string" && v.length > 0),
    );
  }

  // Back-compat: vaultPaths
  if (Array.isArray(cfg.vaultPaths) && cfg.vaultPaths.length > 0) {
    paths.push(...cfg.vaultPaths.filter((v): v is string => typeof v === "string" && v.length > 0));
  }

  if (paths.length > 0) {
    return Array.from(new Set(paths));
  }

  // Fallback: SHAD_COLLECTION_PATH env var (colon-separated)
  const envPaths = process.env.SHAD_COLLECTION_PATH || process.env.SHAD_VAULT_PATH;
  if (envPaths) {
    return envPaths.split(":").filter((p) => p.length > 0);
  }
  // Default: Edwin workspace (sessions/docs/memory)
  return [DEFAULT_VAULT_PATH];
}

export const shadContextConfigSchema = {
  parse(value: unknown): ShadContextConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("shad-context config required");
    }
    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(cfg, ALLOWED_KEYS, "shad-context config");

    const collectionPaths = resolveCollectionPaths(cfg);
    if (collectionPaths.length === 0) {
      throw new Error(
        "collectionPaths is required (set in config or via SHAD_COLLECTION_PATH/SHAD_VAULT_PATH env var)",
      );
    }

    const searchMode = typeof cfg.searchMode === "string" ? cfg.searchMode : "hybrid";
    if (!VALID_MODES.has(searchMode)) {
      throw new Error(`searchMode must be one of: hybrid, bm25, vector`);
    }

    const rlmProfile =
      typeof cfg.rlmProfile === "string" && VALID_RLM_PROFILES.has(cfg.rlmProfile)
        ? (cfg.rlmProfile as "fast" | "balanced" | "deep")
        : "fast";

    const deepProfile =
      typeof cfg.deepWorkflowProfile === "string" && VALID_RLM_PROFILES.has(cfg.deepWorkflowProfile)
        ? (cfg.deepWorkflowProfile as "fast" | "balanced" | "deep")
        : "balanced";

    // Resolve semantic cache DB path
    const defaultCacheDbPath = join(collectionPaths[0], ".cache", "semantic-cache.db");
    const semanticCacheDbPath =
      typeof cfg.semanticCacheDbPath === "string" && cfg.semanticCacheDbPath.length > 0
        ? cfg.semanticCacheDbPath
        : defaultCacheDbPath;

    // Embedding API key: config > env var
    const embeddingApiKey =
      typeof cfg.embeddingApiKey === "string" && cfg.embeddingApiKey.length > 0
        ? cfg.embeddingApiKey
        : (process.env.OPENAI_API_KEY ?? "");

    return {
      collectionPaths,
      shadBin: typeof cfg.shadBin === "string" ? cfg.shadBin : DEFAULT_SHAD_BIN,
      maxChars: typeof cfg.maxChars === "number" ? cfg.maxChars : 6000,
      timeout: typeof cfg.timeout === "number" ? cfg.timeout : 12000,
      searchMode: searchMode as ShadContextConfig["searchMode"],
      limit: typeof cfg.limit === "number" ? cfg.limit : 8,
      leafModel:
        typeof cfg.leafModel === "string" && cfg.leafModel.length > 0 ? cfg.leafModel : "sonnet",
      asyncRlm: cfg.asyncRlm === true,
      rlmProfile,
      rlmMaxTimeSec: typeof cfg.rlmMaxTimeSec === "number" ? cfg.rlmMaxTimeSec : 90,
      minPromptChars: typeof cfg.minPromptChars === "number" ? cfg.minPromptChars : 20,
      cacheTtlMs: typeof cfg.cacheTtlMs === "number" ? cfg.cacheTtlMs : 120000,
      cacheMaxEntries: typeof cfg.cacheMaxEntries === "number" ? cfg.cacheMaxEntries : 50,
      autoRecall: cfg.autoRecall !== false,
      autoCapture: cfg.autoCapture !== false,
      captureDir: typeof cfg.captureDir === "string" ? cfg.captureDir : "sessions",
      rlmDir: typeof cfg.rlmDir === "string" ? cfg.rlmDir : "rlm",

      // Router
      routerEnabled: cfg.routerEnabled !== false, // default: true

      // Semantic cache
      semanticCacheEnabled: cfg.semanticCacheEnabled !== false, // default: true
      semanticCacheThreshold:
        typeof cfg.semanticCacheThreshold === "number" ? cfg.semanticCacheThreshold : 0.92,
      semanticCacheSoftThreshold:
        typeof cfg.semanticCacheSoftThreshold === "number" ? cfg.semanticCacheSoftThreshold : 0.85,
      semanticCacheMaxEntries:
        typeof cfg.semanticCacheMaxEntries === "number" ? cfg.semanticCacheMaxEntries : 500,
      semanticCacheTtlMs:
        typeof cfg.semanticCacheTtlMs === "number" ? cfg.semanticCacheTtlMs : 86400000,
      semanticCacheDbPath,
      embeddingApiKey,
      embeddingModel:
        typeof cfg.embeddingModel === "string" && cfg.embeddingModel.length > 0
          ? cfg.embeddingModel
          : "text-embedding-3-small",
      embeddingDims: typeof cfg.embeddingDims === "number" ? cfg.embeddingDims : 1536,

      // Deep workflow
      deepWorkflowEnabled: cfg.deepWorkflowEnabled === true, // default: false (opt-in)
      deepWorkflowSync: cfg.deepWorkflowSync === true, // default: false (async)
      deepWorkflowSyncTimeoutMs:
        typeof cfg.deepWorkflowSyncTimeoutMs === "number" ? cfg.deepWorkflowSyncTimeoutMs : 60000,
      deepWorkflowProfile: deepProfile,
      deepWorkflowApiProvider: cfg.deepWorkflowApiProvider === "openai" ? "openai" : "anthropic",
      deepWorkflowApiKey:
        typeof cfg.deepWorkflowApiKey === "string" && cfg.deepWorkflowApiKey.length > 0
          ? cfg.deepWorkflowApiKey
          : (process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? ""),
      deepWorkflowSynthesisModel:
        typeof cfg.deepWorkflowSynthesisModel === "string" &&
        cfg.deepWorkflowSynthesisModel.length > 0
          ? cfg.deepWorkflowSynthesisModel
          : "primary",
      deepWorkflowMaxTokens:
        typeof cfg.deepWorkflowMaxTokens === "number" ? cfg.deepWorkflowMaxTokens : 4096,
      deepWorkflowQmdResults:
        typeof cfg.deepWorkflowQmdResults === "number" ? cfg.deepWorkflowQmdResults : 8,
      deepWorkflowQmdCollection:
        typeof cfg.deepWorkflowQmdCollection === "string" &&
        cfg.deepWorkflowQmdCollection.length > 0
          ? cfg.deepWorkflowQmdCollection
          : "workspace",
      deepWorkflowAsyncRlm: cfg.deepWorkflowAsyncRlm === true,
    };
  },

  uiHints: {
    collectionPaths: {
      label: "Collection Paths",
      help: "Collection path(s) for Shad retrieval (or set SHAD_COLLECTION_PATH env var)",
    },
    shadBin: {
      label: "Shad Binary",
      placeholder: "~/.shad/bin/shad",
      advanced: true,
    },
    maxChars: {
      label: "Max Context Chars",
      placeholder: "6000",
      help: "Maximum characters for the synthesized context brief",
    },
    timeout: {
      label: "Timeout (ms)",
      placeholder: "12000",
      advanced: true,
      help: "Max milliseconds to wait for shad context retrieval",
    },
    searchMode: {
      label: "Search Mode",
      placeholder: "hybrid",
      help: "Retrieval mode: hybrid (default), bm25, or vector",
    },
    limit: {
      label: "Max Results",
      placeholder: "8",
      help: "Maximum documents retrieved per context lookup",
    },
    leafModel: {
      label: "Synthesis Model",
      placeholder: "sonnet",
      advanced: true,
      help: "Model for context synthesis/reranking (e.g., sonnet for higher precision)",
    },
    asyncRlm: {
      label: "Async RLM",
      advanced: true,
      help: "If enabled, run a background shad run (RLM) when recall seems weak (not on hot path)",
    },
    rlmProfile: {
      label: "RLM Profile",
      placeholder: "fast",
      advanced: true,
      help: "Budget profile for background RLM runs (fast|balanced|deep)",
    },
    rlmMaxTimeSec: {
      label: "RLM Max Time (sec)",
      placeholder: "90",
      advanced: true,
      help: "Wall-time limit for background RLM runs",
    },
    minPromptChars: {
      label: "Min Prompt Length",
      placeholder: "20",
      advanced: true,
      help: "Skip auto-recall for very short prompts",
    },
    cacheTtlMs: {
      label: "Cache TTL (ms)",
      placeholder: "120000",
      advanced: true,
      help: "Cache shad-context results for repeated prompts",
    },
    cacheMaxEntries: {
      label: "Cache Max Entries",
      placeholder: "50",
      advanced: true,
      help: "Max cached results to keep in memory",
    },
    autoRecall: {
      label: "Auto-Recall",
      help: "Automatically inject collection context on session start",
    },
    autoCapture: {
      label: "Auto-Capture",
      help: "Export session summaries to the collection after conversations",
    },
    captureDir: {
      label: "Capture Directory",
      placeholder: "sessions",
      advanced: true,
      help: "Collection subdirectory for session capture files",
    },
    rlmDir: {
      label: "RLM Output Directory",
      placeholder: "rlm",
      advanced: true,
      help: "Vault subdirectory for background RLM outputs",
    },
    // Router
    routerEnabled: {
      label: "Task Router",
      help: "Classify prompts into fast/recall/deep lanes to skip unnecessary retrieval",
    },
    // Semantic cache
    semanticCacheEnabled: {
      label: "Semantic Cache",
      help: "Cache context results and match by embedding similarity (saves Shad calls for similar questions)",
    },
    semanticCacheThreshold: {
      label: "Cache Similarity Threshold",
      placeholder: "0.92",
      advanced: true,
      help: "Minimum cosine similarity for a hard cache hit (0.0-1.0)",
    },
    semanticCacheSoftThreshold: {
      label: "Cache Soft Threshold",
      placeholder: "0.85",
      advanced: true,
      help: "Minimum cosine similarity for a soft cache hit (returned but flagged)",
    },
    semanticCacheMaxEntries: {
      label: "Semantic Cache Max Entries",
      placeholder: "500",
      advanced: true,
      help: "Maximum entries in the semantic cache",
    },
    semanticCacheTtlMs: {
      label: "Semantic Cache TTL (ms)",
      placeholder: "86400000",
      advanced: true,
      help: "Time-to-live for semantic cache entries (default: 24 hours)",
    },
    embeddingModel: {
      label: "Embedding Model",
      placeholder: "text-embedding-3-small",
      advanced: true,
      help: "OpenAI embedding model for semantic cache",
    },
    // Deep workflow
    deepWorkflowEnabled: {
      label: "Deep Workflow",
      advanced: true,
      help: "Enable the deep workflow lane (full RLM pipeline for complex tasks)",
    },
    deepWorkflowSync: {
      label: "Deep Workflow Sync Mode",
      advanced: true,
      help: "If enabled, block the agent until deep workflow completes (otherwise runs async)",
    },
    deepWorkflowProfile: {
      label: "Deep Workflow RLM Profile",
      placeholder: "balanced",
      advanced: true,
      help: "RLM budget profile for deep workflow tasks (fast|balanced|deep)",
    },
    deepWorkflowSynthesisModel: {
      label: "Deep Workflow Synthesis Model",
      placeholder: "gpt-4.1-mini",
      advanced: true,
      help: "EdwinPAI model for deep workflow synthesis (provider/model, alias, or primary)",
    },
    deepWorkflowMaxTokens: {
      label: "Deep Workflow Max Tokens",
      placeholder: "4096",
      advanced: true,
      help: "Maximum tokens for deep workflow synthesis output",
    },
    deepWorkflowQmdResults: {
      label: "Deep Workflow QMD Results",
      placeholder: "8",
      advanced: true,
      help: "Number of qmd results per search query in deep workflow",
    },
    deepWorkflowQmdCollection: {
      label: "Deep Workflow QMD Collection",
      placeholder: "workspace",
      advanced: true,
      help: "qmd collection name to search in deep workflow",
    },
    deepWorkflowAsyncRlm: {
      label: "Deep Workflow Async RLM",
      advanced: true,
      help: "Also spawn a background shad run for deeper analysis (arrives on next turn)",
    },
  },
};
