/**
 * Edwin Shad Context Plugin
 *
 * Auto-inject collection context via Shad retrieval + synthesis.
 *
 * Architecture (v2):
 *  1. Task Router — classifies prompts into fast/recall/deep lanes
 *  2. Semantic Cache — embedding-similarity cache (skips Shad for similar prompts)
 *  3. Shad Context — hybrid retrieval + LLM synthesis (recall lane)
 *  4. Deep Workflow — full RLM pipeline (deep lane, opt-in)
 *  5. Auto-Capture — writes session summaries to collection
 */

import type { EdwinPAIPluginApi } from "@edwinpai/edwinpai/plugin-sdk";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveQmdCommand } from "../../src/memory/backend-config.js";
import { resolveAgentIdFromSessionKey } from "../../src/routing/session-key.js";
import { shadContextConfigSchema, type ShadContextConfig } from "./config.js";
import { runDeepWorkflow, type DeepWorkflowConfig, type DeepResult } from "./src/deep-workflow.js";
import { classifyPrompt, type Lane } from "./src/router.js";
import { SemanticCache, type EmbedFn, DEFAULT_CACHE_CONFIG } from "./src/semantic-cache.js";

// ============================================================================
// Types
// ============================================================================

type ShadContextResult = {
  brief: string;
  sources: Array<{ path: string; score: number }>;
  query: string;
  chars: number;
  retrieval_count: number;
  synthesis_model: string | null;
};

// ============================================================================
// Shad CLI runner
// ============================================================================

function runShadContext(cfg: ShadContextConfig, query: string): Promise<ShadContextResult | null> {
  return new Promise((resolve) => {
    const args = [
      "context",
      query,
      "--max-chars",
      String(cfg.maxChars),
      "--mode",
      cfg.searchMode,
      "--limit",
      String(cfg.limit),
      "--json",
    ];
    if (cfg.leafModel) {
      args.push("--leaf-model", cfg.leafModel);
    }
    for (const collectionPath of cfg.collectionPaths) {
      args.push("--collection", collectionPath);
    }

    const child = spawn(cfg.shadBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: cfg.timeout,
      env: { ...process.env, NO_COLOR: "1" },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, cfg.timeout);

    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as ShadContextResult;
        resolve(parsed);
      } catch {
        resolve(null);
      }
    });
  });
}

function spawnShadRlmAsync(cfg: ShadContextConfig, goal: string, outputFile: string): void {
  const args: string[] = [
    "run",
    goal,
    "--profile",
    cfg.rlmProfile,
    "--max-time",
    String(cfg.rlmMaxTimeSec),
    "-q",
    "--output",
    outputFile,
  ];
  for (const vaultPath of cfg.collectionPaths) {
    args.push("-v", vaultPath);
  }

  const child = spawn(cfg.shadBin, args, {
    stdio: "ignore",
    detached: true,
    env: { ...process.env, NO_COLOR: "1" },
  });

  child.unref();
}

function runQmdCommand(
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; embeddingApiKey?: string },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveQmdCommand("qmd"), args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: opts.cwd,
      timeout: opts.timeoutMs,
      env: {
        ...process.env,
        NO_COLOR: "1",
        QMD_OPENAI: "1",
        ...(opts.embeddingApiKey ? { OPENAI_API_KEY: opts.embeddingApiKey } : {}),
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const details = (stderr || stdout).trim();
      const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      reject(new Error(`qmd ${args.join(" ")} failed (${reason})${details ? `: ${details}` : ""}`));
    });
  });
}

// ============================================================================
// OpenAI Embedding helper (lightweight — no dependency beyond fetch)
// ============================================================================

function createOpenAiEmbedFn(apiKey: string, model: string): EmbedFn {
  return async (text: string): Promise<Float32Array> => {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: text,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`OpenAI embedding failed: ${response.status} ${errText.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    return new Float32Array(data.data[0].embedding);
  };
}

// ============================================================================
// Session capture helpers
// ============================================================================

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") {
        parts.push(b.text);
      } else if (b.type === "tool_use") {
        const name = typeof b.name === "string" ? b.name : "unknown";
        const input = b.input ? JSON.stringify(b.input).slice(0, 200) : "";
        parts.push(`[tool: ${name}${input ? ` ${input}` : ""}]`);
      } else if (b.type === "tool_result") {
        const text = typeof b.content === "string" ? b.content.slice(0, 300) : "";
        const toolId = typeof b.tool_use_id === "string" ? b.tool_use_id : "";
        if (text) parts.push(`[result${toolId ? ` (${toolId})` : ""}: ${text}]`);
      }
    }
    return parts.join("\n");
  }
  return "";
}

function buildSessionSummary(messages: unknown[]): string {
  const userTexts: Array<{ text: string; timestamp?: number }> = [];
  const assistantTexts: Array<{ text: string; timestamp?: number }> = [];
  const toolTexts: Array<{ text: string; timestamp?: number }> = [];

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") {
      continue;
    }
    const msgObj = msg as Record<string, unknown>;
    const role = msgObj.role;
    const content = msgObj.content;
    const text = extractTextFromContent(content);
    if (!text) {
      continue;
    }
    const timestamp = typeof msgObj.timestamp === "number" ? msgObj.timestamp : undefined;
    if (role === "user") {
      userTexts.push({ text, timestamp });
    } else if (role === "assistant") {
      assistantTexts.push({ text, timestamp });
    } else if (role === "tool") {
      toolTexts.push({ text: text.slice(0, 500), timestamp });
    }
  }

  if (userTexts.length === 0 && assistantTexts.length === 0) {
    return "";
  }

  const parts: string[] = [];

  if (userTexts.length > 0) {
    parts.push("## User Messages\n");
    for (const entry of userTexts) {
      const ts = entry.timestamp ? new Date(entry.timestamp).toISOString().slice(11, 19) : "";
      const prefix = ts ? `[${ts}] ` : "";
      parts.push(`${prefix}${entry.text.slice(0, 500)}\n`);
    }
  }

  if (assistantTexts.length > 0) {
    const recent = assistantTexts.slice(-5);
    parts.push("## Assistant Responses\n");
    for (const entry of recent) {
      const ts = entry.timestamp ? new Date(entry.timestamp).toISOString().slice(11, 19) : "";
      const prefix = ts ? `[${ts}] ` : "";
      parts.push(`${prefix}${entry.text.slice(0, 1500)}\n`);
    }
  }

  if (toolTexts.length > 0) {
    const recent = toolTexts.slice(-10);
    parts.push("## Tool Calls\n");
    for (const entry of recent) {
      const ts = entry.timestamp ? new Date(entry.timestamp).toISOString().slice(11, 19) : "";
      const prefix = ts ? `[${ts}] ` : "";
      parts.push(`${prefix}${entry.text}\n`);
    }
  }

  return parts.join("\n");
}

// ============================================================================
// Plugin Definition
// ============================================================================

const shadContextPlugin = {
  id: "shad-context",
  name: "Shad Context",
  description: "Auto-inject collection context via Shad retrieval + synthesis",
  kind: "memory" as const,
  configSchema: shadContextConfigSchema,

  register(api: EdwinPAIPluginApi) {
    const cfg = shadContextConfigSchema.parse(api.pluginConfig);

    api.logger.info(
      `shad-context: registered (collections: ${cfg.collectionPaths.join(", ")}, ` +
        `mode: ${cfg.searchMode}, router: ${cfg.routerEnabled}, ` +
        `semantic-cache: ${cfg.semanticCacheEnabled}, deep: ${cfg.deepWorkflowEnabled})`,
    );

    // ========================================================================
    // Semantic Cache initialization (lazy)
    // ========================================================================

    let semanticCache: SemanticCache | null = null;
    let semanticCacheReady = false;
    let semanticCacheInitPromise: Promise<boolean> | null = null;

    function getSemanticCache(): Promise<SemanticCache | null> {
      if (!cfg.semanticCacheEnabled) return Promise.resolve(null);
      if (semanticCacheReady) return Promise.resolve(semanticCache);

      if (!semanticCacheInitPromise) {
        semanticCacheInitPromise = (async () => {
          try {
            if (!cfg.embeddingApiKey) {
              api.logger.warn(
                "shad-context: semantic cache disabled — no embedding API key (set embeddingApiKey or OPENAI_API_KEY)",
              );
              return false;
            }

            const embedFn = createOpenAiEmbedFn(cfg.embeddingApiKey, cfg.embeddingModel);
            semanticCache = new SemanticCache(
              {
                ...DEFAULT_CACHE_CONFIG,
                dbPath: cfg.semanticCacheDbPath,
                similarityThreshold: cfg.semanticCacheThreshold,
                softThreshold: cfg.semanticCacheSoftThreshold,
                maxEntries: cfg.semanticCacheMaxEntries,
                ttlMs: cfg.semanticCacheTtlMs,
                vectorDims: cfg.embeddingDims,
              },
              embedFn,
            );

            const ok = await semanticCache.initialize();
            if (ok) {
              semanticCacheReady = true;
              const stats = semanticCache.stats();
              api.logger.info(
                `shad-context: semantic cache initialized (${stats.entries} entries, vec=${stats.vecLoaded})`,
              );

              // Prune expired entries on startup
              const pruned = semanticCache.prune();
              if (pruned > 0) {
                api.logger.info(`shad-context: pruned ${pruned} expired cache entries`);
              }

              // Invalidate entries with changed source files
              const invalidated = semanticCache.invalidateBySourceChange();
              if (invalidated > 0) {
                api.logger.info(`shad-context: invalidated ${invalidated} stale cache entries`);
              }

              return true;
            }
            return false;
          } catch (err) {
            api.logger.warn(`shad-context: semantic cache init failed: ${String(err)}`);
            return false;
          }
        })();
      }

      return semanticCacheInitPromise.then((ok) => (ok ? semanticCache : null));
    }

    // ========================================================================
    // In-memory cache (legacy — kept as L1 for exact matches)
    // ========================================================================

    const memCache = new Map<string, { result: ShadContextResult; at: number }>();

    const getMemCacheKey = (query: string): string => {
      return [
        query.trim(),
        cfg.searchMode,
        String(cfg.maxChars),
        String(cfg.limit),
        cfg.leafModel ?? "",
        cfg.collectionPaths.join("|"),
      ].join("::");
    };

    const readMemCache = (key: string): ShadContextResult | null => {
      const entry = memCache.get(key);
      if (!entry) return null;
      if (Date.now() - entry.at > cfg.cacheTtlMs) {
        memCache.delete(key);
        return null;
      }
      return entry.result;
    };

    const writeMemCache = (key: string, result: ShadContextResult) => {
      memCache.set(key, { result, at: Date.now() });
      if (memCache.size > cfg.cacheMaxEntries) {
        const oldest = memCache.keys().next().value;
        if (oldest) memCache.delete(oldest);
      }
    };

    // ========================================================================
    // Hook 1: before_agent_start — Routed auto-recall
    // ========================================================================

    if (cfg.autoRecall) {
      api.on("before_agent_start", async (event, ctx) => {
        if (!event.prompt || event.prompt.length < cfg.minPromptChars) {
          return;
        }

        // ---- Step 1: Route ----
        let lane: Lane = "recall"; // default if router disabled
        let routeReason = "router disabled";

        if (cfg.routerEnabled) {
          const route = classifyPrompt(event.prompt);
          lane = route.lane;
          routeReason = route.reason;
          api.logger.info?.(`shad-context: route → ${lane} (${routeReason})`);
        }

        // Fast lane: skip everything
        if (lane === "fast") {
          return;
        }

        // ---- Step 2: Semantic cache check ----
        const cache = await getSemanticCache();
        if (cache) {
          try {
            const hit = await cache.lookup(event.prompt);
            if (hit) {
              const result = JSON.parse(hit.entry.resultJson) as ShadContextResult;
              const softTag = hit.similarity < cfg.semanticCacheThreshold ? " [soft-hit]" : "";
              api.logger.info?.(
                `shad-context: semantic cache ${hit.kind} (sim=${hit.similarity.toFixed(3)}${softTag}, ` +
                  `${result.chars} chars, ${result.retrieval_count} docs)`,
              );

              let brief = result.brief;
              if (hit.similarity < cfg.semanticCacheThreshold) {
                brief = `[Note: cached result from similar query — similarity ${(hit.similarity * 100).toFixed(0)}%]\n\n${brief}`;
              }

              return {
                prependContext: `<collection-context>\n${brief}\n</collection-context>`,
              };
            }
          } catch (err) {
            api.logger.warn(`shad-context: semantic cache lookup failed: ${String(err)}`);
          }
        }

        // ---- Step 3: Recall lane ----
        // Prefer qmd-manager (no SQLite locks) over shad CLI for the recall lane.
        // Shad CLI path is kept as fallback for deep lane and when qmd is unavailable.
        try {
          const memKey = getMemCacheKey(event.prompt);
          const memCached = readMemCache(memKey);
          let result: ShadContextResult | null = memCached ?? null;

          if (!result && lane === "recall") {
            try {
              const { getMemorySearchManager } = await import("../../src/memory/search-manager.js");
              const { manager: mgr } = await getMemorySearchManager({
                cfg: api.config,
                agentId: resolveAgentIdFromSessionKey(ctx?.sessionKey),
              });
              if (mgr) {
                const hits = await mgr.search(event.prompt, { maxResults: 8 });
                if (hits.length > 0) {
                  const brief = hits.map((h) => h.snippet).join("\n\n---\n\n");
                  result = {
                    brief,
                    chars: brief.length,
                    retrieval_count: hits.length,
                    sources: hits.map((h) => ({ path: h.path, score: h.score })),
                    synthesis_model: "qmd-direct",
                  };
                  api.logger.info?.(
                    `shad-context: qmd-direct recall → ${hits.length} docs, ${brief.length} chars`,
                  );
                }
              }
            } catch (qmdErr) {
              api.logger.warn(
                `shad-context: qmd-direct failed, falling back to shad CLI: ${String(qmdErr)}`,
              );
            }
          }

          // Fallback: run shad context CLI (for deep lane or qmd failure)
          if (!result) {
            result = await runShadContext(cfg, event.prompt);
          }

          if (!result || !result.brief) {
            // Retrieval failed — if deep lane, still try deep workflow
            if (lane === "deep" && cfg.deepWorkflowEnabled) {
              return await handleDeepLane(cfg, event.prompt, api);
            }
            return;
          }

          if (!memCached) {
            writeMemCache(memKey, result);
          }

          // Store in semantic cache for future similar queries
          if (cache && !memCached) {
            try {
              const sourcePaths = result.sources?.map((s) => s.path).filter(Boolean) ?? [];
              await cache.store(event.prompt, JSON.stringify(result), sourcePaths);
            } catch (err) {
              api.logger.warn(`shad-context: semantic cache store failed: ${String(err)}`);
            }
          }

          api.logger.info?.(
            `shad-context: injecting ${result.chars} chars from ${result.retrieval_count} docs ` +
              `(model=${result.synthesis_model ?? "default"}, lane=${lane})`,
          );

          // ---- Step 4: Deep lane — additionally kick off deep workflow ----
          if (lane === "deep" && cfg.deepWorkflowEnabled) {
            const deepResult = await handleDeepLane(cfg, event.prompt, api);
            if (deepResult?.prependContext) {
              // If deep workflow returned sync result, use it instead of recall result
              return deepResult;
            }
            // Otherwise deep is running async — use recall result for now
          }

          // ---- Legacy: async RLM on weak recall ----
          if (cfg.asyncRlm && !cfg.deepWorkflowEnabled) {
            const looksWeak = result.retrieval_count < 2 || result.chars < 600;
            if (looksWeak) {
              const vaultPath = cfg.collectionPaths[0];
              if (vaultPath) {
                const outDir = path.join(vaultPath, cfg.rlmDir);
                await fs.mkdir(outDir, { recursive: true });

                const now = new Date();
                const date = now.toISOString().slice(0, 10);
                const time = now.toISOString().slice(11, 19);
                const sessionKey = ctx.sessionKey ?? "unknown";
                const sanitizedKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
                const outFile = path.join(outDir, `${date}-${time}-${sanitizedKey}.md`);

                spawnShadRlmAsync(cfg, event.prompt, outFile);
                api.logger.info?.(`shad-context: spawned async RLM run → ${outFile}`);
              }
            }
          }

          return {
            prependContext: `<collection-context>\n${result.brief}\n</collection-context>`,
          };
        } catch (err) {
          api.logger.warn(`shad-context: recall failed: ${String(err)}`);
        }
      });
    }

    // ========================================================================
    // Deep lane handler
    // ========================================================================

    async function handleDeepLane(
      cfg: ShadContextConfig,
      prompt: string,
      api: EdwinPAIPluginApi,
    ): Promise<{ prependContext: string } | undefined> {
      const deepCfg: DeepWorkflowConfig = {
        shadBin: cfg.shadBin,
        collectionPaths: cfg.collectionPaths,
        rlmProfile: cfg.deepWorkflowProfile,
        rlmMaxTimeSec: cfg.rlmMaxTimeSec,
        outputDir: path.join(cfg.collectionPaths[0] ?? "", cfg.rlmDir),
        synchronous: cfg.deepWorkflowSync,
        syncTimeoutMs: cfg.deepWorkflowSyncTimeoutMs,
        edwinConfig: api.config,
        synthesisModel: cfg.deepWorkflowSynthesisModel,
        synthesisMaxTokens: cfg.deepWorkflowMaxTokens,
        qmdResultsPerQuery: cfg.deepWorkflowQmdResults,
        qmdCollection: cfg.deepWorkflowQmdCollection,
        asyncRlmEnabled: cfg.deepWorkflowAsyncRlm,
      };

      try {
        const result = await runDeepWorkflow(deepCfg, prompt, api.logger);

        if (result && result.output) {
          const verifyTag = result.verifyScore < 0.3 ? " [low-confidence]" : "";
          api.logger.info?.(
            `shad-context: deep workflow complete — ${result.output.length} chars, ` +
              `${result.durationMs}ms, verify=${result.verifyScore.toFixed(2)}, ` +
              `sources=${result.sources.length}, model=${result.meta.synthesisModel}` +
              `${result.asyncOutputFile ? `, async-rlm=${result.asyncOutputFile}` : ""}`,
          );

          // Store deep result in semantic cache
          const cache = await getSemanticCache();
          if (cache) {
            try {
              const syntheticResult = {
                brief: result.output,
                sources: result.sources.map((p: string) => ({ path: p, score: 1.0 })),
                query: prompt,
                chars: result.output.length,
                retrieval_count: result.sources.length,
                synthesis_model: result.meta.synthesisModel,
              };
              await cache.store(prompt, JSON.stringify(syntheticResult), result.sources);
            } catch {
              // Non-fatal
            }
          }

          return {
            prependContext:
              `<collection-context source="deep-workflow" intent="${result.meta.intent}" ` +
              `verify="${result.verifyScore.toFixed(2)}"${verifyTag}>\n${result.output}\n</collection-context>`,
          };
        }
      } catch (err) {
        api.logger.warn(`shad-context: deep workflow failed: ${String(err)}`);
      }

      return undefined;
    }

    // ========================================================================
    // Hook 2: agent_end — Auto-capture
    // ========================================================================

    if (cfg.autoCapture) {
      api.on("agent_end", async (event, ctx) => {
        api.logger.info?.(
          `shad-context: agent_end fired (messages=${event.messages?.length ?? 0}, ` +
            `success=${event.success}, sessionKey=${ctx.sessionKey ?? "none"})`,
        );

        if (!event.messages || event.messages.length === 0) {
          api.logger.info?.("shad-context: no messages to capture, skipping");
          return;
        }

        try {
          const summary = buildSessionSummary(event.messages);
          if (!summary) {
            api.logger.info?.("shad-context: empty summary, skipping capture");
            return;
          }

          const collectionPath = cfg.collectionPaths[0];
          if (!collectionPath) {
            api.logger.warn("shad-context: no collection path configured for capture");
            return;
          }
          const captureDir = path.join(collectionPath, cfg.captureDir);
          await fs.mkdir(captureDir, { recursive: true });

          const now = new Date();
          const date = now.toISOString().slice(0, 10);
          const time = now.toISOString().slice(11, 19);
          const sessionKey = ctx.sessionKey ?? "unknown";
          const sanitizedKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);

          const filename = `${date}-${sanitizedKey}.md`;
          const filepath = path.join(captureDir, filename);

          let content: string;
          try {
            await fs.access(filepath);
            content = `\n---\n\n## Turn at ${time}\n\n${summary}\n`;
          } catch {
            const header =
              `---\ndate: ${date}\nsessionKey: ${sessionKey}\nchannel: ${ctx.messageProvider ?? "unknown"}\n---\n\n` +
              `# Session ${date}\n\n## Turn at ${time}\n\n`;
            content = header + summary + "\n";
          }

          await fs.appendFile(filepath, content, "utf-8");

          api.logger.info?.(
            `shad-context: captured ${event.messages.length} messages to ${filename}`,
          );

          // Async reindex + embed so next turn's recall sees this capture
          void (async () => {
            try {
              const cwd = cfg.collectionPaths[0];
              await runQmdCommand(["update", "-c", "workspace"], {
                cwd,
                timeoutMs: 30_000,
                embeddingApiKey: cfg.embeddingApiKey,
              });
              await runQmdCommand(["embed", "-c", "workspace"], {
                cwd,
                timeoutMs: 30_000,
                embeddingApiKey: cfg.embeddingApiKey,
              });
              api.logger.info?.("shad-context: qmd reindex + embed complete");
            } catch (err) {
              api.logger.warn(`shad-context: qmd reindex failed: ${String(err)}`);
            }
          })();
        } catch (err) {
          api.logger.warn(`shad-context: capture failed: ${String(err)}`);
        }
      });
    }

    // ========================================================================
    // Hook 3: before_compaction — Pre-compaction flush
    // ========================================================================

    api.on("before_compaction", async (event, ctx) => {
      api.logger.info?.(
        `shad-context: before_compaction (messages=${event.messageCount}, tokens=${event.tokenCount ?? "?"})`,
      );
      try {
        const { getMemorySearchManager } = await import("../../src/memory/search-manager.js");
        const { manager } = await getMemorySearchManager({
          cfg: api.config,
          agentId: resolveAgentIdFromSessionKey(ctx?.sessionKey),
        });
        if (manager?.flushIndex) {
          await manager.flushIndex("pre-compaction");
          api.logger.info?.("shad-context: pre-compaction flush complete (BM25 index updated)");
        }
      } catch (err) {
        api.logger.warn(`shad-context: pre-compaction flush failed: ${String(err)}`);
      }
    });

    // ========================================================================
    // Hook 4: message_sent — Token watermark tracking
    // ========================================================================

    api.on("message_sent", async (event) => {
      try {
        if (!event.content) return;
        const estimatedTokens = Math.ceil(event.content.length / 4);
        const { getMemorySearchManager } = await import("../../src/memory/search-manager.js");
        const { manager } = await getMemorySearchManager({ cfg: api.config, agentId: "main" });
        manager?.trackNewTokens?.(estimatedTokens);
      } catch {
        // Best-effort, non-fatal
      }
    });

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "shad-context",
      start: () => {
        api.logger.info(
          `shad-context: initialized (collections: ${cfg.collectionPaths.length}, ` +
            `recall: ${cfg.autoRecall}, capture: ${cfg.autoCapture}, ` +
            `router: ${cfg.routerEnabled}, semantic-cache: ${cfg.semanticCacheEnabled}, ` +
            `deep: ${cfg.deepWorkflowEnabled})`,
        );

        // Kick off lazy init of semantic cache in background
        if (cfg.semanticCacheEnabled) {
          getSemanticCache().catch(() => {});
        }
      },
      stop: () => {
        if (semanticCache) {
          semanticCache.close();
          semanticCache = null;
          semanticCacheReady = false;
        }
        api.logger.info("shad-context: stopped");
      },
    });
  },
};

export default shadContextPlugin;
