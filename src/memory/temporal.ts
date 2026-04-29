/**
 * Temporal awareness layer — bi-temporal timestamps, query-time decay, and conflict detection.
 *
 * Inspired by Graphiti's bi-temporal model (event_time + ingestion_time),
 * Honcho's exponential decay, and EdwinPAI's query-time-only approach.
 *
 * Design choice: decay is applied at QUERY TIME, never at write time.
 * This preserves EdwinPAI's audit-friendly immutability while enabling
 * recency-weighted retrieval.
 */

export interface TemporalConfig {
  /** Half-life in days for exponential decay. Default 30. */
  halfLifeDays: number;
  /** Maximum age in days before a memory scores 0. Default 365. */
  maxAgeDays: number;
  /** Blend factor for temporal score: final = (1-alpha)*relevance + alpha*temporal. Default 0.2. */
  temporalAlpha: number;
  /** Decay curve: 'exponential' or 'linear'. Default 'exponential'. */
  decayCurve: "exponential" | "linear";
}

export const DEFAULT_TEMPORAL_CONFIG: Readonly<TemporalConfig> = {
  halfLifeDays: 30,
  maxAgeDays: 365,
  temporalAlpha: 0.2,
  decayCurve: "exponential",
};

/**
 * Compute a temporal decay score between 0 and 1.
 * 1.0 = just happened, 0.0 = older than maxAgeDays.
 */
export function computeDecayScore(
  eventTime: Date,
  now: Date,
  config: TemporalConfig = DEFAULT_TEMPORAL_CONFIG,
): number {
  const ageMs = now.getTime() - eventTime.getTime();
  if (ageMs <= 0) return 1.0; // future or same instant

  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays >= config.maxAgeDays) return 0.0;

  if (config.decayCurve === "linear") {
    return Math.max(0, 1 - ageDays / config.maxAgeDays);
  }

  // Exponential: score = 2^(-age/halfLife)
  const decay = Math.pow(2, -ageDays / config.halfLifeDays);
  return Math.max(0, Math.min(1, decay));
}

/**
 * Blend a relevance score with a temporal decay score.
 * Returns a score in [0, 1].
 */
export function blendTemporalScore(
  relevanceScore: number,
  temporalScore: number,
  alpha: number = DEFAULT_TEMPORAL_CONFIG.temporalAlpha,
): number {
  const clamped = Math.max(0, Math.min(1, alpha));
  return (1 - clamped) * relevanceScore + clamped * temporalScore;
}

/**
 * Compute an access-frequency boost for a memory record.
 * More frequently accessed memories get a small boost.
 * Returns a value in [0, 0.1] to add to the base score.
 */
export function accessFrequencyBoost(accessCount: number, maxBoost: number = 0.1): number {
  if (accessCount <= 0) return 0;
  // Logarithmic scaling: diminishing returns
  return Math.min(maxBoost, maxBoost * (Math.log2(accessCount + 1) / 10));
}

/** A pair of memories that may contradict each other. */
export interface TemporalConflict {
  newer: { id: string; content: string; eventTime: Date };
  older: { id: string; content: string; eventTime: Date };
  /** Cosine similarity between the two (high similarity + different content = likely conflict). */
  similarity: number;
}

/**
 * Detect potential temporal conflicts: records with high embedding similarity
 * but different content that were created at different times.
 * The newer record likely supersedes the older one.
 *
 * @param records - Array of { id, content, contentHash, eventTime, embedding }
 * @param similarityThreshold - Minimum cosine similarity to flag (default 0.85)
 * @returns Array of conflict pairs, ordered by similarity descending
 */
export function detectTemporalConflicts(
  records: Array<{
    id: string;
    content: string;
    contentHash: string;
    eventTime: Date;
    embedding: number[];
  }>,
  similarityThreshold: number = 0.85,
): TemporalConflict[] {
  const conflicts: TemporalConflict[] = [];

  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i];
      const b = records[j];

      // Same content hash = exact duplicate, not a conflict
      if (a.contentHash === b.contentHash) continue;

      const sim = cosineSimilarity(a.embedding, b.embedding);
      if (sim < similarityThreshold) continue;

      const [newer, older] = a.eventTime > b.eventTime ? [a, b] : [b, a];

      conflicts.push({
        newer: { id: newer.id, content: newer.content, eventTime: newer.eventTime },
        older: { id: older.id, content: older.content, eventTime: older.eventTime },
        similarity: sim,
      });
    }
  }

  return conflicts.sort((a, b) => b.similarity - a.similarity);
}

/** Cosine similarity between two vectors. Returns 0 if either is empty. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
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
