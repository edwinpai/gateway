/**
 * Memory type taxonomy — classifies memories into distinct cognitive tiers.
 *
 * Inspired by LangMem (semantic/episodic/procedural), Honcho (dreamer consolidation),
 * and Graphiti (temporal knowledge graphs). Designed for EdwinPAI's retrieval-over-context-window
 * architecture where memories are searched via QMD/hybrid and injected into the context window.
 *
 * Memory lifecycle:
 *   working → episodic → semantic (via consolidation)
 *   procedural is updated via feedback loops, not promotion
 */

/** The four memory tiers, ordered by volatility (most volatile first). */
export enum MemoryTier {
  /** Active session state — ephemeral, never persisted to disk. */
  Working = "working",
  /** Timestamped conversation transcripts with full detail. */
  Episodic = "episodic",
  /** Consolidated facts/knowledge extracted from episodes. */
  Semantic = "semantic",
  /** Learned behavioral rules, prompt patterns, preferences. */
  Procedural = "procedural",
}

/** Valid promotion paths between tiers. */
const VALID_PROMOTIONS: ReadonlyMap<MemoryTier, MemoryTier> = new Map([
  [MemoryTier.Working, MemoryTier.Episodic],
  [MemoryTier.Episodic, MemoryTier.Semantic],
]);

/** Check if a promotion from one tier to another is valid. */
export function isValidPromotion(from: MemoryTier, to: MemoryTier): boolean {
  return VALID_PROMOTIONS.get(from) === to;
}

/** A timestamped, typed memory record that can live in any tier. */
export interface MemoryRecord {
  id: string;
  tier: MemoryTier;
  content: string;
  /** When the event described by this memory actually occurred. */
  eventTime: Date;
  /** When this record was ingested into the memory system. */
  ingestionTime: Date;
  /** Source path (markdown file, session transcript, etc.) */
  sourcePath: string;
  source: "memory" | "sessions";
  /** Access count — used for decay scoring. */
  accessCount: number;
  /** Last time this record was accessed by a search. */
  lastAccessedAt: Date | null;
  /** SHA-256 hash of content for deduplication. */
  contentHash: string;
  /** Optional parent record ID (for consolidation audit trail). */
  consolidatedFrom?: string[];
  /** Arbitrary metadata. */
  metadata?: Record<string, unknown>;
}

export interface PromotionResult {
  promoted: MemoryRecord;
  originalId: string;
  fromTier: MemoryTier;
  toTier: MemoryTier;
}

/**
 * Promote a record to the next tier. Returns a new record (records are immutable).
 * Throws if the promotion path is invalid.
 */
export function promoteRecord(record: MemoryRecord, newContent?: string): PromotionResult {
  const target = VALID_PROMOTIONS.get(record.tier);
  if (!target) {
    throw new Error(`Cannot promote from ${record.tier}: no valid promotion target`);
  }
  const now = new Date();
  const promoted: MemoryRecord = {
    ...record,
    id: `${record.id}-promoted-${now.getTime()}`,
    tier: target,
    content: newContent ?? record.content,
    ingestionTime: now,
    accessCount: 0,
    lastAccessedAt: null,
    consolidatedFrom: [record.id, ...(record.consolidatedFrom ?? [])],
  };
  return {
    promoted,
    originalId: record.id,
    fromTier: record.tier,
    toTier: target,
  };
}

/** Parse a string to MemoryTier, case-insensitive. Returns undefined for invalid input. */
export function parseMemoryTier(value: string): MemoryTier | undefined {
  const lower = value.toLowerCase();
  const values = Object.values(MemoryTier) as string[];
  return values.includes(lower) ? (lower as MemoryTier) : undefined;
}

/** All tier values in volatility order. */
export const ALL_TIERS: readonly MemoryTier[] = [
  MemoryTier.Working,
  MemoryTier.Episodic,
  MemoryTier.Semantic,
  MemoryTier.Procedural,
];
