/**
 * Memory consolidation pipeline — "dreamer" pattern inspired by Honcho.
 *
 * Periodically groups semantically similar episodic memories, synthesizes them
 * into semantic entries via LLM, and prunes redundant records while preserving
 * originals for audit trail.
 *
 * Design: non-destructive. Original episodic records are marked as consolidated
 * (not deleted). The semantic summary references its sources via consolidatedFrom.
 */

import { MemoryRecord, MemoryTier, promoteRecord } from "./taxonomy.js";
import { cosineSimilarity } from "./temporal.js";

export interface ConsolidationConfig {
  /** Minimum cosine similarity to group records together. Default 0.75. */
  groupSimilarityThreshold: number;
  /** Minimum number of episodic records in a group before consolidation triggers. Default 3. */
  minGroupSize: number;
  /** Maximum age in days for episodic records to be eligible. Default 7. */
  maxEpisodicAgeDays: number;
  /** Maximum number of records to consolidate in one batch. Default 50. */
  batchSize: number;
}

export const DEFAULT_CONSOLIDATION_CONFIG: Readonly<ConsolidationConfig> = {
  groupSimilarityThreshold: 0.75,
  minGroupSize: 3,
  maxEpisodicAgeDays: 7,
  batchSize: 50,
};

/** A group of similar episodic records ready for consolidation. */
export interface ConsolidationGroup {
  /** Representative record (highest access count). */
  representative: MemoryRecord;
  /** All records in this group, including the representative. */
  members: MemoryRecord[];
  /** Average pairwise similarity within the group. */
  avgSimilarity: number;
}

/** Result of running the consolidation pipeline. */
export interface ConsolidationResult {
  /** Number of groups formed. */
  groupsFormed: number;
  /** Number of episodic records consolidated. */
  recordsConsolidated: number;
  /** New semantic records created. */
  semanticRecords: MemoryRecord[];
  /** IDs of episodic records that were consolidated (for marking). */
  consolidatedIds: string[];
}

/**
 * Group episodic records by semantic similarity using embeddings.
 * Uses a simple greedy clustering: for each unassigned record, find all records
 * within the similarity threshold and form a group.
 */
export function groupBySimilarity(
  records: Array<MemoryRecord & { embedding: number[] }>,
  threshold: number = DEFAULT_CONSOLIDATION_CONFIG.groupSimilarityThreshold,
): ConsolidationGroup[] {
  const assigned = new Set<string>();
  const groups: ConsolidationGroup[] = [];

  // Sort by access count descending — popular records become representatives
  const sorted = [...records].sort((a, b) => b.accessCount - a.accessCount);

  for (const record of sorted) {
    if (assigned.has(record.id)) continue;

    const members: Array<MemoryRecord & { embedding: number[] }> = [record];
    assigned.add(record.id);

    for (const candidate of sorted) {
      if (assigned.has(candidate.id)) continue;
      const sim = cosineSimilarity(record.embedding, candidate.embedding);
      if (sim >= threshold) {
        members.push(candidate);
        assigned.add(candidate.id);
      }
    }

    // Compute average pairwise similarity
    let totalSim = 0;
    let pairs = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        totalSim += cosineSimilarity(members[i].embedding, members[j].embedding);
        pairs++;
      }
    }

    groups.push({
      representative: record,
      members,
      avgSimilarity: pairs > 0 ? totalSim / pairs : 1.0,
    });
  }

  return groups;
}

/**
 * Filter episodic records eligible for consolidation.
 * Eligible = episodic tier + older than maxEpisodicAgeDays.
 */
export function filterEligibleRecords(
  records: MemoryRecord[],
  now: Date,
  config: ConsolidationConfig = DEFAULT_CONSOLIDATION_CONFIG,
): MemoryRecord[] {
  const cutoff = new Date(now.getTime() - config.maxEpisodicAgeDays * 24 * 60 * 60 * 1000);
  return records.filter((r) => r.tier === MemoryTier.Episodic && r.eventTime <= cutoff);
}

/**
 * Synthesize a group of episodic records into a single semantic summary.
 * This is the "dreamer" step — the caller provides the LLM synthesis function.
 *
 * @param group - The consolidation group
 * @param synthesize - LLM function that takes an array of content strings and returns a summary
 * @returns The new semantic MemoryRecord
 */
export async function consolidateGroup(
  group: ConsolidationGroup,
  synthesize: (contents: string[]) => Promise<string>,
): Promise<MemoryRecord> {
  const contents = group.members.map((m) => m.content);
  const summary = await synthesize(contents);

  const result = promoteRecord(
    {
      ...group.representative,
      tier: MemoryTier.Episodic, // ensure we're promoting from episodic
      consolidatedFrom: group.members.map((m) => m.id),
    },
    summary,
  );

  return result.promoted;
}

/**
 * Run the full consolidation pipeline.
 *
 * @param records - All episodic records with embeddings
 * @param synthesize - LLM synthesis function
 * @param now - Current time
 * @param config - Consolidation configuration
 */
export async function runConsolidation(
  records: Array<MemoryRecord & { embedding: number[] }>,
  synthesize: (contents: string[]) => Promise<string>,
  now: Date = new Date(),
  config: ConsolidationConfig = DEFAULT_CONSOLIDATION_CONFIG,
): Promise<ConsolidationResult> {
  // 1. Filter eligible records
  const eligible = filterEligibleRecords(records, now, config) as Array<
    MemoryRecord & { embedding: number[] }
  >;

  if (eligible.length === 0) {
    return { groupsFormed: 0, recordsConsolidated: 0, semanticRecords: [], consolidatedIds: [] };
  }

  // 2. Limit batch size
  const batch = eligible.slice(0, config.batchSize);

  // 3. Group by similarity
  const groups = groupBySimilarity(batch, config.groupSimilarityThreshold);

  // 4. Filter groups that meet minimum size
  const consolidatable = groups.filter((g) => g.members.length >= config.minGroupSize);

  // 5. Synthesize each group
  const semanticRecords: MemoryRecord[] = [];
  const consolidatedIds: string[] = [];

  for (const group of consolidatable) {
    const semantic = await consolidateGroup(group, synthesize);
    semanticRecords.push(semantic);
    consolidatedIds.push(...group.members.map((m) => m.id));
  }

  return {
    groupsFormed: consolidatable.length,
    recordsConsolidated: consolidatedIds.length,
    semanticRecords,
    consolidatedIds,
  };
}
