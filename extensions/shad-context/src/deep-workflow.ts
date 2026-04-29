/**
 * Deep Workflow — multi-step reasoning pipeline for complex tasks.
 *
 * Only triggered when the task router classifies a prompt as "deep" lane.
 *
 * Architecture:
 *   Uses qmd (BM25 search) for retrieval and a direct LLM call for synthesis.
 *   Does NOT depend on `shad run` — that's too slow/flaky for the hot path
 *   (qmd SQLITE_BUSY locks, 40s+ timeouts). Instead, we:
 *     1. Clarify — extract entities/intent (heuristic, <1ms)
 *     2. Gather — multi-query qmd search (fast, ~2s)
 *     3. Process — LLM synthesis of gathered context (5-15s)
 *     4. Verify — check output covers the entities (heuristic, <1ms)
 *
 *   Optionally, a background `shad run` can be spawned for deeper analysis
 *   that arrives on the next turn (async enrichment).
 *
 * Design constraints:
 *   - Total sync path must complete in <30s (configurable)
 *   - No dependency on `shad run` for the sync path
 *   - Uses OpenAI API for synthesis (fast, key already available)
 *   - qmd search is BM25 only (no vector lock contention)
 *   - Falls back gracefully — if qmd or LLM fails, returns null
 */

import { spawn, execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { EdwinPAIConfig } from "../../../src/config/config.js";
import { runTextModelTurn } from "../../../src/agents/run-text-model-turn.js";

// ============================================================================
// Types
// ============================================================================

export type DeepWorkflowConfig = {
  /** Path to the shad binary (for optional async RLM) */
  shadBin: string;
  /** Collection paths for retrieval */
  collectionPaths: string[];
  /** RLM profile for async background run */
  rlmProfile: "fast" | "balanced" | "deep";
  /** Max time for async RLM */
  rlmMaxTimeSec: number;
  /** Output directory for deep results */
  outputDir: string;
  /** If true, block until deep synthesis completes. If false, run synthesis sync but skip async RLM. */
  synchronous: boolean;
  /** Maximum time for the sync synthesis path (ms) */
  syncTimeoutMs: number;
  /** Full EdwinPAI config for provider/model resolution */
  edwinConfig?: EdwinPAIConfig;
  /** Model for synthesis. Accepts provider/model, alias, or "primary". */
  synthesisModel: string;
  /** Max tokens for synthesis output */
  synthesisMaxTokens: number;
  /** Number of qmd results per query */
  qmdResultsPerQuery: number;
  /** qmd collection name to search */
  qmdCollection: string;
  /** Also spawn a background shad run for deeper async analysis */
  asyncRlmEnabled: boolean;
};

export type DeepResult = {
  /** The synthesized output */
  output: string;
  /** How long the workflow took (ms) */
  durationMs: number;
  /** Source documents used */
  sources: string[];
  /** Verification score (0-1) */
  verifyScore: number;
  /** The output file path (for async RLM results) */
  asyncOutputFile: string | null;
  /** Clarification metadata */
  meta: {
    intent: string;
    entities: string[];
    gatherResults: number;
    synthesisModel: string;
  };
};

type QmdResult = {
  path: string;
  score: string;
  snippet: string;
};

// ============================================================================
// Step 1: Clarify — decompose the goal
// ============================================================================

/**
 * Extract key entities, intent, and search queries from the prompt.
 * Pure heuristics — no LLM call. <1ms.
 */
export function clarifyGoal(prompt: string): {
  intent: string;
  entities: string[];
  searchQueries: string[];
} {
  const text = prompt.trim();

  // Extract potential entities
  const entities: string[] = [];

  // Quoted terms
  const quoted = text.match(/"([^"]+)"|'([^']+)'/g);
  if (quoted) {
    entities.push(...quoted.map((q) => q.replace(/['"]/g, "")));
  }

  // Capitalized multi-word terms (likely proper nouns)
  const capitalized = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g);
  if (capitalized) {
    entities.push(...capitalized);
  }

  // Technical terms (BRC-xxx, acronyms, tech names)
  const technical = text.match(
    /\b[A-Z]{2,}[-_]?\d+\b|\b[A-Z][a-zA-Z]+(?:API|SDK|CLI|DB|AI|ML)\b|\b(?:Edwin|Shad|BSV|LanceDB|SQLite|Redis|qmd)\b/gi,
  );
  if (technical) {
    entities.push(...technical);
  }

  // Deduplicate (case-insensitive)
  const seen = new Set<string>();
  const uniqueEntities = entities.filter((e) => {
    const lower = e.toLowerCase();
    if (seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });

  // Determine intent
  let intent = "general";
  if (/\b(compare|vs|versus|difference|between)\b/i.test(text)) intent = "comparison";
  else if (/\b(explain|what|how|why|describe)\b/i.test(text)) intent = "explanation";
  else if (/\b(design|architect|plan|build|implement|create)\b/i.test(text)) intent = "design";
  else if (/\b(write|draft|compose|generate)\b/i.test(text)) intent = "generation";
  else if (/\b(analyze|assess|evaluate|review)\b/i.test(text)) intent = "analysis";
  else if (/\b(summarize|summary|overview)\b/i.test(text)) intent = "summary";
  else if (/\b(research|investigate|explore)\b/i.test(text)) intent = "research";

  // Generate diverse search queries
  const searchQueries: string[] = [];

  // Main query (truncated)
  searchQueries.push(text.slice(0, 200));

  // Entity-focused queries
  for (const entity of uniqueEntities.slice(0, 3)) {
    searchQueries.push(entity);
  }

  // Intent-specific rephrasing
  if (intent === "comparison" && uniqueEntities.length >= 2) {
    searchQueries.push(`${uniqueEntities[0]} ${uniqueEntities[1]}`);
  }
  if (intent === "design" || intent === "generation") {
    // Add architecture/implementation keywords
    searchQueries.push(`${uniqueEntities[0] ?? text.slice(0, 40)} architecture implementation`);
  }

  return { intent, entities: uniqueEntities, searchQueries };
}

// ============================================================================
// Step 2: Gather — multi-query qmd search
// ============================================================================

function runQmdSearch(query: string, collection: string, limit: number): QmdResult[] {
  try {
    const output = execSync(
      `qmd search ${JSON.stringify(query)} -c ${collection} -n ${limit} --json 2>/dev/null`,
      { timeout: 5000, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    );

    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) {
      return parsed.map((r: any) => ({
        path: r.path ?? r.docid ?? "",
        score: r.score ?? "0",
        snippet: r.snippet ?? r.text ?? "",
      }));
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Gather context from multiple search queries, deduplicate by path.
 */
function gatherContext(
  queries: string[],
  collection: string,
  resultsPerQuery: number,
): { results: QmdResult[]; totalFound: number } {
  const seenPaths = new Set<string>();
  const allResults: QmdResult[] = [];
  let totalFound = 0;

  for (const query of queries) {
    const results = runQmdSearch(query, collection, resultsPerQuery);
    totalFound += results.length;

    for (const r of results) {
      if (!seenPaths.has(r.path)) {
        seenPaths.add(r.path);
        allResults.push(r);
      }
    }
  }

  // Sort by score descending, limit to top 15
  allResults.sort((a, b) => parseFloat(b.score) - parseFloat(a.score));
  return { results: allResults.slice(0, 15), totalFound };
}

// ============================================================================
// Step 3: Process — LLM synthesis
// ============================================================================

async function synthesize(
  prompt: string,
  intent: string,
  entities: string[],
  context: QmdResult[],
  config: {
    edwinConfig?: EdwinPAIConfig;
    workspaceDir?: string;
    model: string;
    maxTokens: number;
    timeoutMs: number;
    logger?: { warn?: (...args: any[]) => void };
  },
): Promise<{ output: string; modelLabel: string } | null> {
  if (context.length === 0) return null;
  if (!config.edwinConfig) {
    throw new Error("deep-workflow: missing EdwinPAI config for synthesis");
  }

  // Build context block from gathered documents
  const contextBlock = context
    .map((r, i) => {
      const snippet = r.snippet.slice(0, 800);
      return `[${i + 1}] ${r.path} (score: ${r.score})\n${snippet}`;
    })
    .join("\n\n---\n\n");

  const synthesisPrompt = `You are a research assistant synthesizing information from a document collection.

Your task: Given a user's query and relevant documents, produce a comprehensive, well-structured answer.

Rules:
- Synthesize across all provided documents — don't just summarize each one
- Cite specific documents by number when making claims: [1], [2], etc.
- If the documents don't fully answer the query, say what's missing
- Be thorough but concise — aim for 500-1500 words
- Use markdown formatting for structure
- Focus on the specific intent: ${intent}
${entities.length > 0 ? `- Key entities to address: ${entities.join(", ")}` : ""}

## Query
${prompt}

## Retrieved Documents (${context.length} results)

${contextBlock}

## Instructions
Synthesize the above documents into a comprehensive answer to the query. Structure your response with clear headers and cite sources by number.`;

  try {
    const result = await runTextModelTurn({
      cfg: config.edwinConfig,
      workspaceDir: config.workspaceDir ?? process.cwd(),
      prompt: synthesisPrompt,
      model: config.model,
      timeoutMs: config.timeoutMs,
      thinkLevel: "off",
      extraSystemPrompt:
        "You are running inside EdwinPAI deep workflow synthesis. Tools are disabled. Return only the final answer in markdown.",
      logger: config.logger,
    });

    return {
      output: result.text,
      modelLabel: `${result.provider}/${result.model}`,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    config.logger?.warn?.(`deep-workflow: synthesis error — ${reason}`);
    return null;
  }
}

// ============================================================================
// Step 4: Verify — check output quality
// ============================================================================

/**
 * Quick verification: does the output address the entities from the prompt?
 * Returns a score 0-1.
 */
function verifyOutput(output: string, entities: string[]): number {
  if (!output || output.length < 50) return 0;
  if (entities.length === 0) return 0.5;

  const lower = output.toLowerCase();
  let matched = 0;
  for (const entity of entities) {
    if (lower.includes(entity.toLowerCase())) {
      matched++;
    }
  }

  // Also check for citation markers [1], [2], etc. — indicates synthesis quality
  const citations = (output.match(/\[\d+\]/g) || []).length;
  const citationBonus = Math.min(citations / 3, 0.2); // up to 0.2 bonus

  const entityScore = entities.length > 0 ? matched / entities.length : 0.5;
  return Math.min(entityScore + citationBonus, 1.0);
}

// ============================================================================
// Optional: Async RLM enrichment
// ============================================================================

function spawnAsyncRlm(
  shadBin: string,
  goal: string,
  collectionPaths: string[],
  profile: string,
  maxTimeSec: number,
  outputFile: string,
): void {
  const args = [
    "run",
    goal,
    "--profile",
    profile,
    "--max-time",
    String(maxTimeSec),
    "--output",
    outputFile,
    "--no-code-mode",
  ];
  for (const p of collectionPaths) {
    args.push("-v", p);
  }

  const child = spawn(shadBin, args, {
    stdio: "ignore",
    detached: true,
    env: { ...process.env, NO_COLOR: "1" },
  });
  child.unref();
}

// ============================================================================
// Full workflow orchestrator
// ============================================================================

export async function runDeepWorkflow(
  cfg: DeepWorkflowConfig,
  prompt: string,
  logger?: { info?: (...args: any[]) => void; warn: (...args: any[]) => void },
): Promise<DeepResult | null> {
  const log = logger ?? { info: () => {}, warn: () => {} };
  const startTime = Date.now();

  // Step 1: Clarify
  const { intent, entities, searchQueries } = clarifyGoal(prompt);
  log.info?.(
    `deep-workflow: clarify — intent=${intent}, entities=[${entities.join(", ")}], queries=${searchQueries.length}`,
  );

  // Step 2: Gather via qmd
  const { results: gatherResults, totalFound } = gatherContext(
    searchQueries,
    cfg.qmdCollection,
    cfg.qmdResultsPerQuery,
  );
  log.info?.(
    `deep-workflow: gather — ${gatherResults.length} unique docs from ${totalFound} total hits`,
  );

  if (gatherResults.length === 0) {
    log.warn("deep-workflow: no documents found — aborting synthesis");
    return null;
  }

  // Step 3: Synthesize via LLM
  log.info?.(
    `deep-workflow: synthesize — model=${cfg.synthesisModel}, timeout=${cfg.syncTimeoutMs}ms`,
  );

  const synthesis = await synthesize(prompt, intent, entities, gatherResults, {
    edwinConfig: cfg.edwinConfig,
    workspaceDir: cfg.collectionPaths[0],
    model: cfg.synthesisModel,
    maxTokens: cfg.synthesisMaxTokens,
    timeoutMs: cfg.syncTimeoutMs,
    logger: log,
  });

  if (!synthesis) {
    log.warn("deep-workflow: synthesis failed or timed out");
    return null;
  }

  const output = synthesis.output;
  const resolvedSynthesisModel = synthesis.modelLabel;

  // Step 4: Verify
  const verifyScore = verifyOutput(output, entities);
  log.info?.(
    `deep-workflow: verify — score=${verifyScore.toFixed(2)}, output=${output.length} chars`,
  );

  if (verifyScore < 0.2) {
    log.warn(
      `deep-workflow: low verification score (${verifyScore.toFixed(2)}) — output may not address the query`,
    );
  }

  const durationMs = Date.now() - startTime;
  const sources = gatherResults.map((r) => r.path);

  // Optional: spawn async RLM for deeper analysis on next turn
  let asyncOutputFile: string | null = null;
  if (cfg.asyncRlmEnabled) {
    await fs.mkdir(cfg.outputDir, { recursive: true });
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toISOString().slice(11, 19).replace(/:/g, "");
    const hash = prompt
      .slice(0, 30)
      .replace(/[^a-zA-Z0-9]/g, "_")
      .toLowerCase();
    asyncOutputFile = path.join(cfg.outputDir, `${date}-${time}-deep-${hash}.md`);

    spawnAsyncRlm(
      cfg.shadBin,
      prompt,
      cfg.collectionPaths,
      cfg.rlmProfile,
      cfg.rlmMaxTimeSec,
      asyncOutputFile,
    );
    log.info?.(`deep-workflow: async RLM spawned → ${asyncOutputFile}`);
  }

  // Write the sync result to disk too (for future recall)
  try {
    await fs.mkdir(cfg.outputDir, { recursive: true });
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const resultFile = path.join(cfg.outputDir, `${date}-deep-result.md`);
    const header = `---\nquery: ${prompt.slice(0, 100)}\nintent: ${intent}\nentities: ${entities.join(", ")}\nverifyScore: ${verifyScore.toFixed(2)}\nduration: ${durationMs}ms\nmodel: ${cfg.synthesisModel}\nsources: ${sources.length}\n---\n\n`;
    await fs.appendFile(resultFile, header + output + "\n\n---\n\n", "utf-8");
  } catch {
    // Non-fatal — disk write failure shouldn't kill the workflow
  }

  return {
    output,
    durationMs,
    sources,
    verifyScore,
    asyncOutputFile,
    meta: {
      intent,
      entities,
      gatherResults: gatherResults.length,
      synthesisModel: resolvedSynthesisModel,
    },
  };
}
