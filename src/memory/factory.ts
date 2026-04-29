import type { EdwinPAIConfig } from "../config/config.js";
import type { ResolvedQmdConfig } from "./backend-config.js";
import type { MemorySearchManager } from "./types.js";

/**
 * Edwin-side concrete memory manager factories.
 *
 * This module still knows how to create host-specific manager implementations.
 * Higher-level host concerns like backend resolution and manager caching stay in
 * `search-manager.ts`, while runtime fallback behavior now lives in
 * `engine-runtime.ts`.
 */
export async function createBuiltinMemorySearchManager(params: {
  cfg: EdwinPAIConfig;
  agentId: string;
}): Promise<MemorySearchManager | null> {
  const { MemoryIndexManager } = await import("./manager.js");
  return await MemoryIndexManager.get(params);
}

export async function createQmdMemorySearchManager(params: {
  cfg: EdwinPAIConfig;
  agentId: string;
  resolved: ResolvedQmdConfig;
}): Promise<MemorySearchManager | null> {
  const { QmdMemoryManager } = await import("./qmd-manager.js");
  return await QmdMemoryManager.create({
    cfg: params.cfg,
    agentId: params.agentId,
    resolved: {
      backend: "qmd",
      citations: params.cfg.memory?.citations ?? "auto",
      qmd: params.resolved,
    },
  });
}
