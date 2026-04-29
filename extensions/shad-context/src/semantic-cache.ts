/**
 * Semantic Cache — embedding-similarity cache for Shad context results.
 *
 * Instead of exact string matching on prompts, we embed each prompt and
 * check cosine similarity against cached embeddings. Similar questions
 * ("BRC-108 ownership" vs "how do BRC tokens handle ownership") return
 * cached results instead of re-querying Shad.
 *
 * Storage: SQLite + sqlite-vec (already an Edwin dependency).
 * Embeddings: OpenAI text-embedding-3-small via Edwin's embedding infra.
 *
 * The cache is local, single-process, and designed for Edwin's typical
 * workload: repeated topics across sessions within a 24h window.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// ============================================================================
// Types
// ============================================================================

export type CachedEntry = {
  id: string;
  prompt: string;
  promptEmbedding: Float32Array;
  resultJson: string;
  createdAt: number;
  hitCount: number;
  /** Comma-separated list of source file paths used in this result */
  sourcePaths: string;
};

export type CacheHit = {
  entry: CachedEntry;
  similarity: number;
  kind: "exact" | "semantic";
};

export type SemanticCacheConfig = {
  /** Path to the SQLite database file */
  dbPath: string;
  /** Cosine similarity threshold for cache hits (default: 0.92) */
  similarityThreshold: number;
  /** Soft hit threshold — return result but flag as potentially stale (default: 0.85) */
  softThreshold: number;
  /** Maximum cache entries (default: 500) */
  maxEntries: number;
  /** TTL in milliseconds (default: 24 hours) */
  ttlMs: number;
  /** Vector dimensions (must match embedding model — 1536 for text-embedding-3-small) */
  vectorDims: number;
};

export const DEFAULT_CACHE_CONFIG: SemanticCacheConfig = {
  dbPath: "",
  similarityThreshold: 0.92,
  softThreshold: 0.85,
  maxEntries: 500,
  ttlMs: 24 * 60 * 60 * 1000, // 24 hours
  vectorDims: 1536,
};

// ============================================================================
// Embedding function type (injected — no direct OpenAI dependency)
// ============================================================================

export type EmbedFn = (text: string) => Promise<Float32Array>;

// ============================================================================
// SemanticCache
// ============================================================================

export class SemanticCache {
  private db: DatabaseSync | null = null;
  private config: SemanticCacheConfig;
  private embedFn: EmbedFn;
  private initialized = false;
  private vecLoaded = false;

  constructor(config: SemanticCacheConfig, embedFn: EmbedFn) {
    this.config = config;
    this.embedFn = embedFn;
  }

  // --------------------------------------------------------------------------
  // Init
  // --------------------------------------------------------------------------

  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    try {
      // Ensure directory exists
      const dir = path.dirname(this.config.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.db = new DatabaseSync(this.config.dbPath);

      // Try to load sqlite-vec extension
      try {
        const sqliteVec = await import("sqlite-vec");
        this.db.enableLoadExtension(true);
        sqliteVec.load(this.db);
        this.vecLoaded = true;
      } catch {
        // sqlite-vec not available — fall back to brute-force scan
        this.vecLoaded = false;
      }

      // Create tables
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS cache_entries (
          id TEXT PRIMARY KEY,
          prompt TEXT NOT NULL,
          prompt_hash TEXT NOT NULL,
          prompt_embedding BLOB NOT NULL,
          result_json TEXT NOT NULL,
          source_paths TEXT DEFAULT '',
          created_at INTEGER NOT NULL,
          hit_count INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_cache_prompt_hash ON cache_entries(prompt_hash);
        CREATE INDEX IF NOT EXISTS idx_cache_created_at ON cache_entries(created_at);
      `);

      // Create virtual vec table if sqlite-vec is available
      if (this.vecLoaded) {
        try {
          this.db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS cache_vec USING vec0(
              id TEXT PRIMARY KEY,
              embedding float[${this.config.vectorDims}]
            );
          `);
        } catch {
          // vec0 table creation might fail on some platforms
          this.vecLoaded = false;
        }
      }

      this.initialized = true;
      return true;
    } catch (err) {
      this.db = null;
      this.initialized = false;
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Lookup
  // --------------------------------------------------------------------------

  /**
   * Look up a prompt in the cache.
   *
   * Strategy:
   *  1. Exact hash match (instant — no embedding needed)
   *  2. Semantic similarity via embedding (requires embed call)
   *
   * Returns null on miss, or a CacheHit with similarity score.
   */
  async lookup(prompt: string): Promise<CacheHit | null> {
    if (!this.initialized || !this.db) return null;

    const now = Date.now();
    const cutoff = now - this.config.ttlMs;

    // 1. Exact match by prompt hash
    const hash = hashPrompt(prompt);
    const exactRow = this.db
      .prepare(
        `SELECT id, prompt, prompt_embedding, result_json, source_paths, created_at, hit_count
         FROM cache_entries WHERE prompt_hash = ? AND created_at > ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(hash, cutoff) as any;

    if (exactRow) {
      // Bump hit count
      this.db
        .prepare("UPDATE cache_entries SET hit_count = hit_count + 1 WHERE id = ?")
        .run(exactRow.id);
      return {
        entry: rowToEntry(exactRow),
        similarity: 1.0,
        kind: "exact",
      };
    }

    // 2. Semantic search — embed the prompt and find nearest neighbor
    let embedding: Float32Array;
    try {
      embedding = await this.embedFn(prompt);
    } catch {
      return null; // Embedding failed — treat as miss
    }

    const bestMatch = this.findNearest(embedding, cutoff);
    if (!bestMatch) return null;

    if (bestMatch.similarity >= this.config.similarityThreshold) {
      // Strong hit — bump count
      this.db!.prepare("UPDATE cache_entries SET hit_count = hit_count + 1 WHERE id = ?").run(
        bestMatch.entry.id,
      );
      return { ...bestMatch, kind: "semantic" };
    }

    if (bestMatch.similarity >= this.config.softThreshold) {
      // Soft hit — return it but flagged
      this.db!.prepare("UPDATE cache_entries SET hit_count = hit_count + 1 WHERE id = ?").run(
        bestMatch.entry.id,
      );
      return { ...bestMatch, kind: "semantic" };
    }

    return null; // Below threshold
  }

  // --------------------------------------------------------------------------
  // Store
  // --------------------------------------------------------------------------

  /**
   * Store a prompt + result in the cache.
   */
  async store(prompt: string, resultJson: string, sourcePaths: string[] = []): Promise<string> {
    if (!this.initialized || !this.db) throw new Error("Cache not initialized");

    const id = crypto.randomUUID();
    const hash = hashPrompt(prompt);
    const now = Date.now();

    let embedding: Float32Array;
    try {
      embedding = await this.embedFn(prompt);
    } catch (err) {
      throw new Error(`Failed to embed prompt: ${err}`);
    }

    const embeddingBlob = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);

    this.db
      .prepare(
        `INSERT OR REPLACE INTO cache_entries (id, prompt, prompt_hash, prompt_embedding, result_json, source_paths, created_at, hit_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(id, prompt, hash, embeddingBlob, resultJson, sourcePaths.join(","), now);

    // Also insert into vec table if available
    if (this.vecLoaded) {
      try {
        this.db
          .prepare(`INSERT INTO cache_vec (id, embedding) VALUES (?, ?)`)
          .run(id, embeddingBlob);
      } catch {
        // Non-fatal — brute force fallback still works
      }
    }

    // Evict if over max entries
    this.evictIfNeeded();

    return id;
  }

  // --------------------------------------------------------------------------
  // Invalidation
  // --------------------------------------------------------------------------

  /** Remove expired entries. */
  prune(): number {
    if (!this.initialized || !this.db) return 0;
    const cutoff = Date.now() - this.config.ttlMs;

    // Get IDs to delete (for vec table cleanup)
    const rows = this.db
      .prepare("SELECT id FROM cache_entries WHERE created_at <= ?")
      .all(cutoff) as any[];

    if (rows.length === 0) return 0;

    const ids = rows.map((r: any) => r.id);
    this.db.prepare(`DELETE FROM cache_entries WHERE created_at <= ?`).run(cutoff);

    if (this.vecLoaded) {
      for (const id of ids) {
        try {
          this.db!.prepare("DELETE FROM cache_vec WHERE id = ?").run(id);
        } catch {
          /* ignore */
        }
      }
    }

    return ids.length;
  }

  /** Invalidate entries whose source files have changed (by mtime check). */
  invalidateBySourceChange(): number {
    if (!this.initialized || !this.db) return 0;

    const rows = this.db
      .prepare("SELECT id, source_paths, created_at FROM cache_entries WHERE source_paths != ''")
      .all() as any[];

    let invalidated = 0;
    for (const row of rows) {
      const paths = (row.source_paths as string).split(",").filter(Boolean);
      for (const p of paths) {
        try {
          const stat = fs.statSync(p);
          if (stat.mtimeMs > row.created_at) {
            this.db!.prepare("DELETE FROM cache_entries WHERE id = ?").run(row.id);
            if (this.vecLoaded) {
              try {
                this.db!.prepare("DELETE FROM cache_vec WHERE id = ?").run(row.id);
              } catch {
                /* */
              }
            }
            invalidated++;
            break;
          }
        } catch {
          // File doesn't exist — invalidate
          this.db!.prepare("DELETE FROM cache_entries WHERE id = ?").run(row.id);
          if (this.vecLoaded) {
            try {
              this.db!.prepare("DELETE FROM cache_vec WHERE id = ?").run(row.id);
            } catch {
              /* */
            }
          }
          invalidated++;
          break;
        }
      }
    }

    return invalidated;
  }

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  stats(): {
    entries: number;
    vecLoaded: boolean;
    oldestMs: number | null;
    newestMs: number | null;
  } {
    if (!this.initialized || !this.db) {
      return { entries: 0, vecLoaded: false, oldestMs: null, newestMs: null };
    }
    const row = this.db
      .prepare(
        "SELECT COUNT(*) as cnt, MIN(created_at) as oldest, MAX(created_at) as newest FROM cache_entries",
      )
      .get() as any;

    return {
      entries: row.cnt ?? 0,
      vecLoaded: this.vecLoaded,
      oldestMs: row.oldest ?? null,
      newestMs: row.newest ?? null,
    };
  }

  // --------------------------------------------------------------------------
  // Shutdown
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private findNearest(
    queryEmbedding: Float32Array,
    cutoff: number,
  ): { entry: CachedEntry; similarity: number } | null {
    if (!this.db) return null;

    const queryBlob = Buffer.from(
      queryEmbedding.buffer,
      queryEmbedding.byteOffset,
      queryEmbedding.byteLength,
    );

    // Try sqlite-vec accelerated search first
    if (this.vecLoaded) {
      try {
        const vecRows = this.db
          .prepare(
            `SELECT v.id, v.distance
           FROM cache_vec v
           WHERE v.embedding MATCH ?
           ORDER BY v.distance
           LIMIT 5`,
          )
          .all(queryBlob) as any[];

        if (vecRows.length > 0) {
          // vec0 returns L2 distance — convert to cosine similarity
          // For normalized vectors: cosine_sim = 1 - (L2^2 / 2)
          let bestMatch: { entry: CachedEntry; similarity: number } | null = null;

          for (const vr of vecRows) {
            const row = this.db!.prepare(
              `SELECT id, prompt, prompt_embedding, result_json, source_paths, created_at, hit_count
               FROM cache_entries WHERE id = ? AND created_at > ?`,
            ).get(vr.id, cutoff) as any;

            if (!row) continue;

            const dist = vr.distance as number;
            const similarity = 1 - (dist * dist) / 2;

            if (!bestMatch || similarity > bestMatch.similarity) {
              bestMatch = { entry: rowToEntry(row), similarity };
            }
          }

          return bestMatch;
        }
      } catch {
        // Fall through to brute force
      }
    }

    // Brute force fallback — scan all non-expired entries
    const rows = this.db
      .prepare(
        `SELECT id, prompt, prompt_embedding, result_json, source_paths, created_at, hit_count
       FROM cache_entries WHERE created_at > ?`,
      )
      .all(cutoff) as any[];

    if (rows.length === 0) return null;

    let bestSim = -1;
    let bestRow: any = null;

    for (const row of rows) {
      const storedEmbedding = blobToFloat32Array(row.prompt_embedding as Buffer);
      const sim = cosineSimilarity(queryEmbedding, storedEmbedding);
      if (sim > bestSim) {
        bestSim = sim;
        bestRow = row;
      }
    }

    if (!bestRow || bestSim < this.config.softThreshold) return null;

    return { entry: rowToEntry(bestRow), similarity: bestSim };
  }

  private evictIfNeeded(): void {
    if (!this.db) return;

    const countRow = this.db.prepare("SELECT COUNT(*) as cnt FROM cache_entries").get() as any;
    const count = countRow?.cnt ?? 0;

    if (count <= this.config.maxEntries) return;

    // Delete oldest entries that exceed the limit
    const excess = count - this.config.maxEntries;
    const toDelete = this.db
      .prepare(`SELECT id FROM cache_entries ORDER BY created_at ASC LIMIT ?`)
      .all(excess) as any[];

    for (const row of toDelete) {
      this.db!.prepare("DELETE FROM cache_entries WHERE id = ?").run(row.id);
      if (this.vecLoaded) {
        try {
          this.db!.prepare("DELETE FROM cache_vec WHERE id = ?").run(row.id);
        } catch {
          /* */
        }
      }
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function hashPrompt(prompt: string): string {
  return crypto.createHash("sha256").update(prompt.trim().toLowerCase()).digest("hex").slice(0, 32);
}

function rowToEntry(row: any): CachedEntry {
  return {
    id: row.id as string,
    prompt: row.prompt as string,
    promptEmbedding: blobToFloat32Array(row.prompt_embedding as Buffer),
    resultJson: row.result_json as string,
    createdAt: row.created_at as number,
    hitCount: row.hit_count as number,
    sourcePaths: (row.source_paths as string) ?? "",
  };
}

function blobToFloat32Array(buf: Buffer): Float32Array {
  // Ensure proper alignment
  const ab = new ArrayBuffer(buf.byteLength);
  const view = new Uint8Array(ab);
  view.set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  return new Float32Array(ab);
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
  return denom < 1e-10 ? 0 : dot / denom;
}
