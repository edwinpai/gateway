/**
 * Response Cache — full LLM response caching by semantic similarity.
 *
 * Sits in the gateway request path between prompt parsing and LLM invocation.
 * If an incoming question is semantically similar to a previously-answered one,
 * the cached response is returned directly — zero LLM tokens consumed.
 *
 * Storage: ~/.edwinpai/.cache/response-cache.db (outside workspace per design).
 * Embeddings: OpenAI text-embedding-3-small (same as Shad semantic cache).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadConfig } from "../config/config.js";
import { STATE_DIR } from "../config/paths.js";

// ============================================================================
// Types
// ============================================================================

export type ResponseCacheEntry = {
  id: string;
  prompt: string;
  response: string;
  model: string;
  createdAt: number;
  hitCount: number;
};

export type ResponseCacheHit = {
  entry: ResponseCacheEntry;
  similarity: number;
  kind: "exact" | "semantic";
};

export type ResponseCacheConfig = {
  enabled: boolean;
  /** Cosine similarity threshold for returning cached response (default: 0.94) */
  similarityThreshold: number;
  /** Maximum cache entries (default: 200) */
  maxEntries: number;
  /** TTL in milliseconds (default: 72 hours) */
  ttlMs: number;
  /** Embedding model dimensions (default: 1536 for text-embedding-3-small) */
  vectorDims: number;
};

const DEFAULT_CONFIG: ResponseCacheConfig = {
  enabled: true,
  similarityThreshold: 0.94,
  maxEntries: 200,
  ttlMs: 72 * 60 * 60 * 1000, // 72 hours
  vectorDims: 1536,
};

// ============================================================================
// Singleton
// ============================================================================

let instance: ResponseCache | null = null;

export function getResponseCache(): ResponseCache {
  if (!instance) {
    const cfg = loadConfig();
    const rcCfg = cfg?.gateway?.responseCache;
    instance = new ResponseCache({
      enabled: rcCfg?.enabled ?? true,
      similarityThreshold: rcCfg?.similarityThreshold,
      maxEntries: rcCfg?.maxEntries,
      ttlMs: rcCfg?.ttlMs,
    });
  }
  return instance;
}

// ============================================================================
// ResponseCache
// ============================================================================

export class ResponseCache {
  private db: DatabaseSync | null = null;
  private config: ResponseCacheConfig;
  private initialized = false;
  private initAttempted = false;
  private embeddingApiKey: string | undefined;

  constructor(config?: Partial<ResponseCacheConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // --------------------------------------------------------------------------
  // Init
  // --------------------------------------------------------------------------

  async initialize(): Promise<boolean> {
    if (this.initialized) return true;
    if (this.initAttempted) return false;
    this.initAttempted = true;

    try {
      // Resolve embedding API key
      const cfg = loadConfig();
      this.embeddingApiKey =
        cfg?.memory?.qmd?.embeddingApiKey || process.env.OPENAI_API_KEY || undefined;

      if (!this.embeddingApiKey) {
        return false; // Can't embed without a key
      }

      // Resolve DB path: STATE_DIR/.cache/response-cache.db
      const cacheDir = path.join(STATE_DIR, ".cache");
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      const dbPath = path.join(cacheDir, "response-cache.db");

      this.db = new DatabaseSync(dbPath);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS response_cache (
          id TEXT PRIMARY KEY,
          prompt TEXT NOT NULL,
          prompt_hash TEXT NOT NULL,
          prompt_embedding BLOB NOT NULL,
          response TEXT NOT NULL,
          model TEXT DEFAULT '',
          created_at INTEGER NOT NULL,
          hit_count INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_resp_prompt_hash ON response_cache(prompt_hash);
        CREATE INDEX IF NOT EXISTS idx_resp_created_at ON response_cache(created_at);
      `);

      this.initialized = true;
      return true;
    } catch {
      this.db = null;
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Lookup
  // --------------------------------------------------------------------------

  async lookup(prompt: string): Promise<ResponseCacheHit | null> {
    if (!this.config.enabled) return null;
    if (!this.initialized && !(await this.initialize())) return null;
    if (!this.db) return null;

    const now = Date.now();
    const cutoff = now - this.config.ttlMs;

    // 1. Exact hash match (no embedding call needed)
    const hash = hashPrompt(prompt);
    const exactRow = this.db
      .prepare(
        `SELECT id, prompt, response, model, created_at, hit_count
         FROM response_cache WHERE prompt_hash = ? AND created_at > ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(hash, cutoff) as any;

    if (exactRow) {
      this.db
        .prepare("UPDATE response_cache SET hit_count = hit_count + 1 WHERE id = ?")
        .run(exactRow.id);
      return {
        entry: rowToEntry(exactRow),
        similarity: 1.0,
        kind: "exact",
      };
    }

    // 2. Semantic search via embedding
    let embedding: Float32Array;
    try {
      embedding = await this.embed(prompt);
    } catch {
      return null;
    }

    const bestMatch = this.findNearest(embedding, cutoff);
    if (!bestMatch) return null;

    if (bestMatch.similarity >= this.config.similarityThreshold) {
      this.db!.prepare("UPDATE response_cache SET hit_count = hit_count + 1 WHERE id = ?").run(
        bestMatch.entry.id,
      );
      return { ...bestMatch, kind: "semantic" };
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Store
  // --------------------------------------------------------------------------

  async store(prompt: string, response: string, model: string = ""): Promise<string | null> {
    if (!this.config.enabled) return null;
    if (!this.initialized && !(await this.initialize())) return null;
    if (!this.db) return null;

    // Don't cache very short or error responses
    if (response.length < 20) return null;

    const id = crypto.randomUUID();
    const hash = hashPrompt(prompt);
    const now = Date.now();

    let embedding: Float32Array;
    try {
      embedding = await this.embed(prompt);
    } catch {
      return null;
    }

    const embeddingBlob = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);

    this.db
      .prepare(
        `INSERT OR REPLACE INTO response_cache
         (id, prompt, prompt_hash, prompt_embedding, response, model, created_at, hit_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(id, prompt, hash, embeddingBlob, response, model, now);

    this.evictIfNeeded();
    return id;
  }

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  stats(): { entries: number; enabled: boolean; oldestMs: number | null; newestMs: number | null } {
    if (!this.initialized || !this.db) {
      return { entries: 0, enabled: this.config.enabled, oldestMs: null, newestMs: null };
    }
    const row = this.db
      .prepare(
        "SELECT COUNT(*) as cnt, MIN(created_at) as oldest, MAX(created_at) as newest FROM response_cache",
      )
      .get() as any;
    return {
      entries: row.cnt ?? 0,
      enabled: this.config.enabled,
      oldestMs: row.oldest ?? null,
      newestMs: row.newest ?? null,
    };
  }

  // --------------------------------------------------------------------------
  // Prune
  // --------------------------------------------------------------------------

  prune(): number {
    if (!this.initialized || !this.db) return 0;
    const cutoff = Date.now() - this.config.ttlMs;
    const result = this.db.prepare("DELETE FROM response_cache WHERE created_at <= ?").run(cutoff);
    return Number(result.changes);
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private async embed(text: string): Promise<Float32Array> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.embeddingApiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return new Float32Array(data.data[0].embedding);
  }

  private findNearest(
    queryEmbedding: Float32Array,
    cutoff: number,
  ): { entry: ResponseCacheEntry; similarity: number } | null {
    if (!this.db) return null;

    // Brute-force cosine similarity scan (sufficient for ≤200 entries)
    const rows = this.db
      .prepare(
        `SELECT id, prompt, prompt_embedding, response, model, created_at, hit_count
         FROM response_cache WHERE created_at > ?`,
      )
      .all(cutoff) as any[];

    let best: { entry: ResponseCacheEntry; similarity: number } | null = null;

    for (const row of rows) {
      const storedEmbedding = new Float32Array(
        (row.prompt_embedding as Buffer).buffer,
        (row.prompt_embedding as Buffer).byteOffset,
        (row.prompt_embedding as Buffer).byteLength / 4,
      );
      const sim = cosineSimilarity(queryEmbedding, storedEmbedding);
      if (!best || sim > best.similarity) {
        best = { entry: rowToEntry(row), similarity: sim };
      }
    }

    return best;
  }

  private evictIfNeeded(): void {
    if (!this.db) return;
    const countRow = this.db.prepare("SELECT COUNT(*) as cnt FROM response_cache").get() as any;
    const count = countRow?.cnt ?? 0;

    if (count > this.config.maxEntries) {
      const excess = count - this.config.maxEntries;
      this.db
        .prepare(
          `DELETE FROM response_cache WHERE id IN (
            SELECT id FROM response_cache ORDER BY hit_count ASC, created_at ASC LIMIT ?
          )`,
        )
        .run(excess);
    }
  }

  close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        /* */
      }
      this.db = null;
    }
    this.initialized = false;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function hashPrompt(prompt: string): string {
  return crypto.createHash("sha256").update(prompt.trim().toLowerCase()).digest("hex");
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function rowToEntry(row: any): ResponseCacheEntry {
  return {
    id: row.id,
    prompt: row.prompt,
    response: row.response,
    model: row.model ?? "",
    createdAt: row.created_at,
    hitCount: row.hit_count ?? 0,
  };
}
