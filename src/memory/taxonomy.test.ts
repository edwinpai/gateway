import { describe, expect, it } from "vitest";
import {
  ALL_TIERS,
  MemoryRecord,
  MemoryTier,
  isValidPromotion,
  parseMemoryTier,
  promoteRecord,
} from "./taxonomy.js";

function makeRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "test-001",
    tier: MemoryTier.Episodic,
    content: "User asked about Python async patterns",
    eventTime: new Date("2026-03-30T10:00:00Z"),
    ingestionTime: new Date("2026-03-30T10:00:01Z"),
    sourcePath: "sessions/chat-001.jsonl",
    source: "sessions",
    accessCount: 0,
    lastAccessedAt: null,
    contentHash: "abc123",
    ...overrides,
  };
}

describe("MemoryTier enum", () => {
  it("defines all four tiers", () => {
    expect(ALL_TIERS).toHaveLength(4);
    expect(ALL_TIERS).toContain(MemoryTier.Working);
    expect(ALL_TIERS).toContain(MemoryTier.Episodic);
    expect(ALL_TIERS).toContain(MemoryTier.Semantic);
    expect(ALL_TIERS).toContain(MemoryTier.Procedural);
  });

  it("tier values are lowercase strings", () => {
    for (const tier of ALL_TIERS) {
      expect(tier).toBe(tier.toLowerCase());
    }
  });
});

describe("isValidPromotion", () => {
  it("allows working → episodic", () => {
    expect(isValidPromotion(MemoryTier.Working, MemoryTier.Episodic)).toBe(true);
  });

  it("allows episodic → semantic", () => {
    expect(isValidPromotion(MemoryTier.Episodic, MemoryTier.Semantic)).toBe(true);
  });

  it("rejects skipping tiers (working → semantic)", () => {
    expect(isValidPromotion(MemoryTier.Working, MemoryTier.Semantic)).toBe(false);
  });

  it("rejects demotion (semantic → episodic)", () => {
    expect(isValidPromotion(MemoryTier.Semantic, MemoryTier.Episodic)).toBe(false);
  });

  it("rejects promotion from semantic (terminal for this path)", () => {
    expect(isValidPromotion(MemoryTier.Semantic, MemoryTier.Procedural)).toBe(false);
  });

  it("rejects promotion from procedural", () => {
    expect(isValidPromotion(MemoryTier.Procedural, MemoryTier.Semantic)).toBe(false);
  });

  it("rejects same-tier promotion", () => {
    expect(isValidPromotion(MemoryTier.Episodic, MemoryTier.Episodic)).toBe(false);
  });
});

describe("promoteRecord", () => {
  it("promotes episodic → semantic", () => {
    const record = makeRecord({ tier: MemoryTier.Episodic });
    const result = promoteRecord(record);

    expect(result.fromTier).toBe(MemoryTier.Episodic);
    expect(result.toTier).toBe(MemoryTier.Semantic);
    expect(result.promoted.tier).toBe(MemoryTier.Semantic);
    expect(result.originalId).toBe("test-001");
  });

  it("promotes working → episodic", () => {
    const record = makeRecord({ tier: MemoryTier.Working });
    const result = promoteRecord(record);

    expect(result.promoted.tier).toBe(MemoryTier.Episodic);
  });

  it("preserves original content when no new content given", () => {
    const record = makeRecord();
    const result = promoteRecord(record);
    expect(result.promoted.content).toBe(record.content);
  });

  it("uses new content when provided", () => {
    const record = makeRecord();
    const result = promoteRecord(record, "Consolidated: user interested in Python concurrency");
    expect(result.promoted.content).toBe("Consolidated: user interested in Python concurrency");
  });

  it("records audit trail in consolidatedFrom", () => {
    const record = makeRecord({ id: "original-001" });
    const result = promoteRecord(record);
    expect(result.promoted.consolidatedFrom).toContain("original-001");
  });

  it("chains consolidatedFrom across multiple promotions", () => {
    const record = makeRecord({
      id: "gen2",
      tier: MemoryTier.Working,
      consolidatedFrom: ["gen1"],
    });
    const r1 = promoteRecord(record); // working → episodic
    expect(r1.promoted.consolidatedFrom).toContain("gen2");
    expect(r1.promoted.consolidatedFrom).toContain("gen1");
  });

  it("resets accessCount on promotion", () => {
    const record = makeRecord({ accessCount: 42 });
    const result = promoteRecord(record);
    expect(result.promoted.accessCount).toBe(0);
  });

  it("throws for invalid promotion (semantic has no target)", () => {
    const record = makeRecord({ tier: MemoryTier.Semantic });
    expect(() => promoteRecord(record)).toThrow("Cannot promote from semantic");
  });

  it("throws for procedural promotion", () => {
    const record = makeRecord({ tier: MemoryTier.Procedural });
    expect(() => promoteRecord(record)).toThrow("Cannot promote from procedural");
  });

  it("does not mutate the original record", () => {
    const record = makeRecord();
    const originalTier = record.tier;
    promoteRecord(record);
    expect(record.tier).toBe(originalTier);
  });
});

describe("parseMemoryTier", () => {
  it("parses valid lowercase values", () => {
    expect(parseMemoryTier("working")).toBe(MemoryTier.Working);
    expect(parseMemoryTier("episodic")).toBe(MemoryTier.Episodic);
    expect(parseMemoryTier("semantic")).toBe(MemoryTier.Semantic);
    expect(parseMemoryTier("procedural")).toBe(MemoryTier.Procedural);
  });

  it("parses case-insensitively", () => {
    expect(parseMemoryTier("WORKING")).toBe(MemoryTier.Working);
    expect(parseMemoryTier("Episodic")).toBe(MemoryTier.Episodic);
    expect(parseMemoryTier("SEMANTIC")).toBe(MemoryTier.Semantic);
  });

  it("returns undefined for invalid strings", () => {
    expect(parseMemoryTier("invalid")).toBeUndefined();
    expect(parseMemoryTier("")).toBeUndefined();
    expect(parseMemoryTier("memory")).toBeUndefined();
  });
});
