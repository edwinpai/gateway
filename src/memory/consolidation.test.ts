import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConsolidationConfig,
  DEFAULT_CONSOLIDATION_CONFIG,
  consolidateGroup,
  filterEligibleRecords,
  groupBySimilarity,
  runConsolidation,
} from "./consolidation.js";
import { MemoryRecord, MemoryTier } from "./taxonomy.js";

const NOW = new Date("2026-03-31T00:00:00Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function makeEpisodicRecord(
  id: string,
  content: string,
  embedding: number[],
  overrides: Partial<MemoryRecord> = {},
): MemoryRecord & { embedding: number[] } {
  return {
    id,
    tier: MemoryTier.Episodic,
    content,
    eventTime: daysAgo(10),
    ingestionTime: daysAgo(10),
    sourcePath: `sessions/${id}.jsonl`,
    source: "sessions",
    accessCount: 1,
    lastAccessedAt: null,
    contentHash: `hash-${id}`,
    embedding,
    ...overrides,
  };
}

const mockSynthesize = vi.fn(
  async (contents: string[]) => `Consolidated: ${contents.length} items`,
);

describe("filterEligibleRecords", () => {
  it("includes episodic records older than maxEpisodicAgeDays", () => {
    const records = [makeEpisodicRecord("old", "old stuff", [1, 0], { eventTime: daysAgo(10) })];
    const eligible = filterEligibleRecords(records, NOW);
    expect(eligible).toHaveLength(1);
  });

  it("excludes recent episodic records", () => {
    const records = [makeEpisodicRecord("new", "new stuff", [1, 0], { eventTime: daysAgo(1) })];
    const eligible = filterEligibleRecords(records, NOW);
    expect(eligible).toHaveLength(0);
  });

  it("excludes semantic records", () => {
    const records = [
      makeEpisodicRecord("sem", "facts", [1, 0], {
        tier: MemoryTier.Semantic,
        eventTime: daysAgo(30),
      }),
    ];
    const eligible = filterEligibleRecords(records, NOW);
    expect(eligible).toHaveLength(0);
  });

  it("excludes working records", () => {
    const records = [
      makeEpisodicRecord("wrk", "active", [1, 0], {
        tier: MemoryTier.Working,
        eventTime: daysAgo(30),
      }),
    ];
    const eligible = filterEligibleRecords(records, NOW);
    expect(eligible).toHaveLength(0);
  });

  it("respects custom maxEpisodicAgeDays", () => {
    const config: ConsolidationConfig = { ...DEFAULT_CONSOLIDATION_CONFIG, maxEpisodicAgeDays: 30 };
    const records = [makeEpisodicRecord("mid", "medium", [1, 0], { eventTime: daysAgo(15) })];
    expect(filterEligibleRecords(records, NOW, config)).toHaveLength(0);
    expect(filterEligibleRecords(records, NOW, { ...config, maxEpisodicAgeDays: 10 })).toHaveLength(
      1,
    );
  });
});

describe("groupBySimilarity", () => {
  it("groups identical vectors together", () => {
    const records = [
      makeEpisodicRecord("a", "python async", [1, 0, 0]),
      makeEpisodicRecord("b", "python asyncio", [1, 0, 0]),
      makeEpisodicRecord("c", "python concurrency", [1, 0, 0]),
    ];
    const groups = groupBySimilarity(records, 0.9);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(3);
  });

  it("separates orthogonal vectors into different groups", () => {
    const records = [
      makeEpisodicRecord("a", "python", [1, 0, 0]),
      makeEpisodicRecord("b", "cooking", [0, 1, 0]),
      makeEpisodicRecord("c", "music", [0, 0, 1]),
    ];
    const groups = groupBySimilarity(records, 0.5);
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.members.length === 1)).toBe(true);
  });

  it("uses the highest-access-count record as representative", () => {
    const records = [
      makeEpisodicRecord("low", "a", [1, 0], { accessCount: 1 }),
      makeEpisodicRecord("high", "b", [1, 0], { accessCount: 10 }),
      makeEpisodicRecord("mid", "c", [1, 0], { accessCount: 5 }),
    ];
    const groups = groupBySimilarity(records, 0.9);
    expect(groups[0].representative.id).toBe("high");
  });

  it("returns empty groups for empty input", () => {
    expect(groupBySimilarity([], 0.5)).toEqual([]);
  });

  it("handles single record", () => {
    const records = [makeEpisodicRecord("solo", "alone", [1, 0])];
    const groups = groupBySimilarity(records, 0.5);
    expect(groups).toHaveLength(1);
    expect(groups[0].avgSimilarity).toBe(1.0);
  });
});

describe("consolidateGroup", () => {
  it("calls synthesize with all member contents", async () => {
    const members = [
      makeEpisodicRecord("a", "python async", [1, 0]),
      makeEpisodicRecord("b", "python await", [1, 0]),
      makeEpisodicRecord("c", "python concurrency", [1, 0]),
    ];
    const group = { representative: members[0], members, avgSimilarity: 0.95 };

    await consolidateGroup(group, mockSynthesize);
    expect(mockSynthesize).toHaveBeenCalledWith([
      "python async",
      "python await",
      "python concurrency",
    ]);
  });

  it("returns a semantic-tier record", async () => {
    const members = [makeEpisodicRecord("a", "test", [1, 0])];
    const group = { representative: members[0], members, avgSimilarity: 1.0 };

    const result = await consolidateGroup(group, mockSynthesize);
    expect(result.tier).toBe(MemoryTier.Semantic);
  });

  it("preserves audit trail in consolidatedFrom", async () => {
    const members = [makeEpisodicRecord("x1", "a", [1, 0]), makeEpisodicRecord("x2", "b", [1, 0])];
    const group = { representative: members[0], members, avgSimilarity: 0.9 };

    const result = await consolidateGroup(group, mockSynthesize);
    expect(result.consolidatedFrom).toContain("x1");
    expect(result.consolidatedFrom).toContain("x2");
  });
});

describe("runConsolidation", () => {
  beforeEach(() => {
    mockSynthesize.mockClear();
  });

  it("returns empty result for no records", async () => {
    const result = await runConsolidation([], mockSynthesize, NOW);
    expect(result.groupsFormed).toBe(0);
    expect(result.recordsConsolidated).toBe(0);
    expect(result.semanticRecords).toEqual([]);
    expect(result.consolidatedIds).toEqual([]);
  });

  it("returns empty result when all records are too recent", async () => {
    const records = [
      makeEpisodicRecord("new1", "a", [1, 0], { eventTime: daysAgo(1) }),
      makeEpisodicRecord("new2", "b", [1, 0], { eventTime: daysAgo(2) }),
      makeEpisodicRecord("new3", "c", [1, 0], { eventTime: daysAgo(3) }),
    ];
    const result = await runConsolidation(records, mockSynthesize, NOW);
    expect(result.groupsFormed).toBe(0);
  });

  it("consolidates a group of similar old episodic records", async () => {
    const records = [
      makeEpisodicRecord("e1", "python async patterns", [0.9, 0.1, 0]),
      makeEpisodicRecord("e2", "python asyncio usage", [0.91, 0.09, 0]),
      makeEpisodicRecord("e3", "python concurrent code", [0.88, 0.12, 0]),
    ];
    const config: ConsolidationConfig = {
      ...DEFAULT_CONSOLIDATION_CONFIG,
      groupSimilarityThreshold: 0.9,
      minGroupSize: 2,
    };
    const result = await runConsolidation(records, mockSynthesize, NOW, config);
    expect(result.groupsFormed).toBeGreaterThanOrEqual(1);
    expect(result.semanticRecords.length).toBeGreaterThanOrEqual(1);
    expect(result.semanticRecords[0].tier).toBe(MemoryTier.Semantic);
  });

  it("skips groups smaller than minGroupSize", async () => {
    const records = [
      makeEpisodicRecord("lone1", "unique topic A", [1, 0, 0]),
      makeEpisodicRecord("lone2", "unique topic B", [0, 1, 0]),
    ];
    const config: ConsolidationConfig = {
      ...DEFAULT_CONSOLIDATION_CONFIG,
      minGroupSize: 3,
    };
    const result = await runConsolidation(records, mockSynthesize, NOW, config);
    expect(result.groupsFormed).toBe(0);
    expect(mockSynthesize).not.toHaveBeenCalled();
  });

  it("respects batchSize limit", async () => {
    const records = Array.from({ length: 100 }, (_, i) =>
      makeEpisodicRecord(`r${i}`, `content ${i}`, [1, 0]),
    );
    const config: ConsolidationConfig = {
      ...DEFAULT_CONSOLIDATION_CONFIG,
      batchSize: 10,
      minGroupSize: 2,
    };
    const result = await runConsolidation(records, mockSynthesize, NOW, config);
    // At most 10 records should have been processed
    expect(result.recordsConsolidated).toBeLessThanOrEqual(10);
  });

  it("returns all consolidated IDs for marking", async () => {
    const records = [
      makeEpisodicRecord("e1", "same topic", [1, 0]),
      makeEpisodicRecord("e2", "same topic too", [1, 0]),
      makeEpisodicRecord("e3", "same topic also", [1, 0]),
    ];
    const config: ConsolidationConfig = {
      ...DEFAULT_CONSOLIDATION_CONFIG,
      minGroupSize: 2,
    };
    const result = await runConsolidation(records, mockSynthesize, NOW, config);
    expect(result.consolidatedIds).toContain("e1");
    expect(result.consolidatedIds).toContain("e2");
    expect(result.consolidatedIds).toContain("e3");
  });
});
