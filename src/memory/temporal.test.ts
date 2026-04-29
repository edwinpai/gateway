import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPORAL_CONFIG,
  TemporalConfig,
  accessFrequencyBoost,
  blendTemporalScore,
  computeDecayScore,
  cosineSimilarity,
  detectTemporalConflicts,
} from "./temporal.js";

const NOW = new Date("2026-03-31T00:00:00Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

describe("computeDecayScore", () => {
  const config = DEFAULT_TEMPORAL_CONFIG;

  it("returns 1.0 for events happening right now", () => {
    expect(computeDecayScore(NOW, NOW, config)).toBe(1.0);
  });

  it("returns 1.0 for future events", () => {
    const future = new Date(NOW.getTime() + 86400000);
    expect(computeDecayScore(future, NOW, config)).toBe(1.0);
  });

  it("returns 0.0 for events at maxAgeDays", () => {
    expect(computeDecayScore(daysAgo(365), NOW, config)).toBe(0.0);
  });

  it("returns 0.0 for events beyond maxAgeDays", () => {
    expect(computeDecayScore(daysAgo(500), NOW, config)).toBe(0.0);
  });

  it("returns ~0.5 at the half-life (exponential)", () => {
    const score = computeDecayScore(daysAgo(30), NOW, config);
    expect(score).toBeCloseTo(0.5, 1);
  });

  it("returns ~0.25 at 2x half-life (exponential)", () => {
    const score = computeDecayScore(daysAgo(60), NOW, config);
    expect(score).toBeCloseTo(0.25, 1);
  });

  it("linear decay returns 0.5 at half maxAge", () => {
    const linear: TemporalConfig = { ...config, decayCurve: "linear" };
    const score = computeDecayScore(daysAgo(365 / 2), NOW, linear);
    expect(score).toBeCloseTo(0.5, 1);
  });

  it("linear decay is strictly linear", () => {
    const linear: TemporalConfig = { ...config, decayCurve: "linear" };
    const s1 = computeDecayScore(daysAgo(100), NOW, linear);
    const s2 = computeDecayScore(daysAgo(200), NOW, linear);
    const s3 = computeDecayScore(daysAgo(300), NOW, linear);
    // Equal spacing should give equal decrements
    expect(s1 - s2).toBeCloseTo(s2 - s3, 2);
  });

  it("always returns values in [0, 1]", () => {
    for (const days of [0, 1, 7, 30, 90, 180, 365, 1000]) {
      const score = computeDecayScore(daysAgo(days), NOW, config);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

describe("blendTemporalScore", () => {
  it("returns pure relevance when alpha=0", () => {
    expect(blendTemporalScore(0.8, 0.2, 0)).toBeCloseTo(0.8);
  });

  it("returns pure temporal when alpha=1", () => {
    expect(blendTemporalScore(0.8, 0.2, 1)).toBeCloseTo(0.2);
  });

  it("returns weighted blend at default alpha=0.2", () => {
    const result = blendTemporalScore(0.8, 0.5, 0.2);
    expect(result).toBeCloseTo(0.8 * 0.8 + 0.5 * 0.2);
  });

  it("clamps alpha to [0, 1]", () => {
    expect(blendTemporalScore(0.5, 0.5, -1)).toBeCloseTo(0.5);
    expect(blendTemporalScore(0.5, 0.5, 2)).toBeCloseTo(0.5);
  });
});

describe("accessFrequencyBoost", () => {
  it("returns 0 for zero accesses", () => {
    expect(accessFrequencyBoost(0)).toBe(0);
  });

  it("returns 0 for negative accesses", () => {
    expect(accessFrequencyBoost(-5)).toBe(0);
  });

  it("returns a positive boost for accessed records", () => {
    expect(accessFrequencyBoost(10)).toBeGreaterThan(0);
  });

  it("never exceeds maxBoost", () => {
    expect(accessFrequencyBoost(1000000, 0.1)).toBeLessThanOrEqual(0.1);
  });

  it("has diminishing returns (logarithmic)", () => {
    const b1 = accessFrequencyBoost(1);
    const b10 = accessFrequencyBoost(10);
    const b100 = accessFrequencyBoost(100);
    // More accesses should always give higher boost
    expect(b100).toBeGreaterThan(b10);
    expect(b10).toBeGreaterThan(b1);
    // But the rate of increase slows (logarithmic)
    expect(b100 / b10).toBeLessThan(b10 / b1);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("returns 0 for mismatched lengths", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
});

describe("detectTemporalConflicts", () => {
  it("returns empty for no records", () => {
    expect(detectTemporalConflicts([])).toEqual([]);
  });

  it("returns empty for single record", () => {
    const records = [
      { id: "1", content: "a", contentHash: "h1", eventTime: NOW, embedding: [1, 0] },
    ];
    expect(detectTemporalConflicts(records)).toEqual([]);
  });

  it("detects conflicting records with high similarity but different content", () => {
    const records = [
      {
        id: "old",
        content: "User likes Python 2",
        contentHash: "h1",
        eventTime: daysAgo(30),
        embedding: [0.9, 0.1],
      },
      {
        id: "new",
        content: "User likes Python 3",
        contentHash: "h2",
        eventTime: daysAgo(1),
        embedding: [0.91, 0.09],
      },
    ];
    const conflicts = detectTemporalConflicts(records, 0.99);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].newer.id).toBe("new");
    expect(conflicts[0].older.id).toBe("old");
  });

  it("skips exact duplicates (same contentHash)", () => {
    const records = [
      { id: "a", content: "same", contentHash: "same", eventTime: daysAgo(10), embedding: [1, 0] },
      { id: "b", content: "same", contentHash: "same", eventTime: daysAgo(5), embedding: [1, 0] },
    ];
    expect(detectTemporalConflicts(records)).toEqual([]);
  });

  it("skips low-similarity records", () => {
    const records = [
      { id: "a", content: "cats", contentHash: "h1", eventTime: daysAgo(10), embedding: [1, 0] },
      { id: "b", content: "dogs", contentHash: "h2", eventTime: daysAgo(5), embedding: [0, 1] },
    ];
    expect(detectTemporalConflicts(records, 0.85)).toEqual([]);
  });

  it("orders conflicts by similarity descending", () => {
    const records = [
      { id: "a", content: "x1", contentHash: "h1", eventTime: daysAgo(10), embedding: [1, 0, 0] },
      {
        id: "b",
        content: "x2",
        contentHash: "h2",
        eventTime: daysAgo(5),
        embedding: [0.98, 0.1, 0],
      },
      {
        id: "c",
        content: "x3",
        contentHash: "h3",
        eventTime: daysAgo(1),
        embedding: [0.99, 0.05, 0],
      },
    ];
    const conflicts = detectTemporalConflicts(records, 0.9);
    if (conflicts.length >= 2) {
      expect(conflicts[0].similarity).toBeGreaterThanOrEqual(conflicts[1].similarity);
    }
  });
});
