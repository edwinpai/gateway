/**
 * Adaptive hybrid search weights based on query type and collection characteristics.
 *
 * Inspired by the cross-system analysis:
 * - Entity/keyword queries → favor BM25 (alpha low)
 * - Conceptual/semantic queries → favor vector (alpha high)
 * - Per-collection tuning: user content (keyword-heavy) vs docs (semantic-heavy)
 */

export type HybridSource = string;

/** Query classification for adaptive weight selection. */
export type QueryType = "entity" | "conceptual" | "mixed";

/** Per-collection weight overrides. */
export interface CollectionWeightOverride {
  name: string;
  vectorWeight: number;
  textWeight: number;
}

/**
 * Classify a query to determine optimal BM25/vector weight balance.
 * Entity queries (proper nouns, specific identifiers) favor BM25.
 * Conceptual queries (how/why/what patterns, abstract concepts) favor vector.
 */
export function classifyQuery(query: string): QueryType {
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "mixed";

  // Heuristics for entity detection
  const entitySignals = [
    // Capitalized words (not at sentence start)
    words.slice(1).filter((w) => /^[A-Z][a-z]/.test(w)).length,
    // camelCase or PascalCase identifiers
    words.filter((w) => /^[a-z]+[A-Z]/.test(w) || /^[A-Z][a-z]+[A-Z]/.test(w)).length,
    // File paths or dotted names
    words.filter((w) => /[./\\]/.test(w)).length,
    // Quoted terms
    (query.match(/["'`][^"'`]+["'`]/g) || []).length,
  ];
  const entityScore = entitySignals.reduce((a, b) => a + b, 0);

  // Heuristics for conceptual queries
  const conceptualPatterns = /^(how|why|what|explain|describe|compare|when|where)\b/i;
  const isConceptual = conceptualPatterns.test(query.trim());

  if (entityScore >= 2 && !isConceptual) return "entity";
  if (isConceptual && entityScore < 2) return "conceptual";
  return "mixed";
}

/**
 * Get adaptive weights based on query type.
 * Entity queries: favor BM25 (text=0.7, vector=0.3)
 * Conceptual queries: favor vector (text=0.3, vector=0.7)
 * Mixed: balanced (text=0.5, vector=0.5)
 */
export function getAdaptiveWeights(
  queryType: QueryType,
  collectionOverride?: CollectionWeightOverride,
): { vectorWeight: number; textWeight: number } {
  if (collectionOverride) {
    return {
      vectorWeight: collectionOverride.vectorWeight,
      textWeight: collectionOverride.textWeight,
    };
  }
  switch (queryType) {
    case "entity":
      return { vectorWeight: 0.3, textWeight: 0.7 };
    case "conceptual":
      return { vectorWeight: 0.7, textWeight: 0.3 };
    case "mixed":
    default:
      return { vectorWeight: 0.5, textWeight: 0.5 };
  }
}

export type HybridVectorResult = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  source: HybridSource;
  snippet: string;
  vectorScore: number;
};

export type HybridKeywordResult = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  source: HybridSource;
  snippet: string;
  textScore: number;
};

export function buildFtsQuery(raw: string): string | null {
  const tokens =
    raw
      .match(/[A-Za-z0-9_]+/g)
      ?.map((t) => t.trim())
      .filter(Boolean) ?? [];
  if (tokens.length === 0) {
    return null;
  }
  const quoted = tokens.map((t) => `"${t.replaceAll('"', "")}"`);
  return quoted.join(" AND ");
}

export function bm25RankToScore(rank: number): number {
  const normalized = Number.isFinite(rank) ? Math.max(0, rank) : 999;
  return 1 / (1 + normalized);
}

export function mergeHybridResults(params: {
  vector: HybridVectorResult[];
  keyword: HybridKeywordResult[];
  vectorWeight: number;
  textWeight: number;
}): Array<{
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: HybridSource;
}> {
  const byId = new Map<
    string,
    {
      id: string;
      path: string;
      startLine: number;
      endLine: number;
      source: HybridSource;
      snippet: string;
      vectorScore: number;
      textScore: number;
    }
  >();

  for (const r of params.vector) {
    byId.set(r.id, {
      id: r.id,
      path: r.path,
      startLine: r.startLine,
      endLine: r.endLine,
      source: r.source,
      snippet: r.snippet,
      vectorScore: r.vectorScore,
      textScore: 0,
    });
  }

  for (const r of params.keyword) {
    const existing = byId.get(r.id);
    if (existing) {
      existing.textScore = r.textScore;
      if (r.snippet && r.snippet.length > 0) {
        existing.snippet = r.snippet;
      }
    } else {
      byId.set(r.id, {
        id: r.id,
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        source: r.source,
        snippet: r.snippet,
        vectorScore: 0,
        textScore: r.textScore,
      });
    }
  }

  const merged = Array.from(byId.values()).map((entry) => {
    const score = params.vectorWeight * entry.vectorScore + params.textWeight * entry.textScore;
    return {
      path: entry.path,
      startLine: entry.startLine,
      endLine: entry.endLine,
      score,
      snippet: entry.snippet,
      source: entry.source,
    };
  });

  return merged.toSorted((a, b) => b.score - a.score);
}
