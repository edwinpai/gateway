import { describe, expect, it } from "vitest";
import {
  bm25RankToScore,
  buildFtsQuery,
  classifyQuery,
  getAdaptiveWeights,
  mergeHybridResults,
} from "./hybrid.js";

describe("memory hybrid helpers", () => {
  it("buildFtsQuery tokenizes and AND-joins", () => {
    expect(buildFtsQuery("hello world")).toBe('"hello" AND "world"');
    expect(buildFtsQuery("FOO_bar baz-1")).toBe('"FOO_bar" AND "baz" AND "1"');
    expect(buildFtsQuery("   ")).toBeNull();
  });

  it("bm25RankToScore is monotonic and clamped", () => {
    expect(bm25RankToScore(0)).toBeCloseTo(1);
    expect(bm25RankToScore(1)).toBeCloseTo(0.5);
    expect(bm25RankToScore(10)).toBeLessThan(bm25RankToScore(1));
    expect(bm25RankToScore(-100)).toBeCloseTo(1);
  });

  it("mergeHybridResults unions by id and combines weighted scores", () => {
    const merged = mergeHybridResults({
      vectorWeight: 0.7,
      textWeight: 0.3,
      vector: [
        {
          id: "a",
          path: "memory/a.md",
          startLine: 1,
          endLine: 2,
          source: "memory",
          snippet: "vec-a",
          vectorScore: 0.9,
        },
      ],
      keyword: [
        {
          id: "b",
          path: "memory/b.md",
          startLine: 3,
          endLine: 4,
          source: "memory",
          snippet: "kw-b",
          textScore: 1.0,
        },
      ],
    });

    expect(merged).toHaveLength(2);
    const a = merged.find((r) => r.path === "memory/a.md");
    const b = merged.find((r) => r.path === "memory/b.md");
    expect(a?.score).toBeCloseTo(0.7 * 0.9);
    expect(b?.score).toBeCloseTo(0.3 * 1.0);
  });

  it("mergeHybridResults prefers keyword snippet when ids overlap", () => {
    const merged = mergeHybridResults({
      vectorWeight: 0.5,
      textWeight: 0.5,
      vector: [
        {
          id: "a",
          path: "memory/a.md",
          startLine: 1,
          endLine: 2,
          source: "memory",
          snippet: "vec-a",
          vectorScore: 0.2,
        },
      ],
      keyword: [
        {
          id: "a",
          path: "memory/a.md",
          startLine: 1,
          endLine: 2,
          source: "memory",
          snippet: "kw-a",
          textScore: 1.0,
        },
      ],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.snippet).toBe("kw-a");
    expect(merged[0]?.score).toBeCloseTo(0.5 * 0.2 + 0.5 * 1.0);
  });
});

describe("classifyQuery", () => {
  it("classifies conceptual queries (how/why/what)", () => {
    expect(classifyQuery("how does memory consolidation work")).toBe("conceptual");
    expect(classifyQuery("why is Python popular")).toBe("conceptual");
    expect(classifyQuery("what are the best practices")).toBe("conceptual");
    expect(classifyQuery("explain the architecture")).toBe("conceptual");
  });

  it("classifies entity queries (proper nouns, identifiers)", () => {
    expect(classifyQuery("find UserManager.search method")).toBe("entity");
    expect(classifyQuery('check "api_key" in config.yaml')).toBe("entity");
  });

  it("classifies mixed queries", () => {
    expect(classifyQuery("authentication")).toBe("mixed");
    expect(classifyQuery("search for results")).toBe("mixed");
  });

  it("returns mixed for empty query", () => {
    expect(classifyQuery("")).toBe("mixed");
  });
});

describe("getAdaptiveWeights", () => {
  it("favors BM25 for entity queries", () => {
    const weights = getAdaptiveWeights("entity");
    expect(weights.textWeight).toBeGreaterThan(weights.vectorWeight);
    expect(weights.textWeight).toBe(0.7);
    expect(weights.vectorWeight).toBe(0.3);
  });

  it("favors vector for conceptual queries", () => {
    const weights = getAdaptiveWeights("conceptual");
    expect(weights.vectorWeight).toBeGreaterThan(weights.textWeight);
    expect(weights.vectorWeight).toBe(0.7);
    expect(weights.textWeight).toBe(0.3);
  });

  it("returns balanced weights for mixed queries", () => {
    const weights = getAdaptiveWeights("mixed");
    expect(weights.vectorWeight).toBe(0.5);
    expect(weights.textWeight).toBe(0.5);
  });

  it("uses collection override when provided", () => {
    const override = { name: "docs", vectorWeight: 0.8, textWeight: 0.2 };
    const weights = getAdaptiveWeights("entity", override);
    expect(weights.vectorWeight).toBe(0.8);
    expect(weights.textWeight).toBe(0.2);
  });

  it("weights always sum to 1", () => {
    for (const qt of ["entity", "conceptual", "mixed"] as const) {
      const w = getAdaptiveWeights(qt);
      expect(w.vectorWeight + w.textWeight).toBeCloseTo(1.0);
    }
  });
});
