import type { EdwinPAIConfig } from "../config/config.js";
import type { MemorySearchManager } from "./types.js";
import { getMemorySearchManager } from "./search-manager.js";

export type MemoryHostRuntimeResult = {
  runtime: MemorySearchManager | null;
  error?: string;
};

/**
 * Edwin-side host adapter that narrows the lifecycle-bearing manager getter down
 * to the runtime handle used by the public retrieval/query/diagnostics seams.
 *
 * This keeps the public runtime adapters from wiring directly to the full
 * manager-construction path while preserving the current external contracts.
 */
export async function getMemoryHostRuntime(params: {
  cfg: EdwinPAIConfig;
  agentId: string;
}): Promise<MemoryHostRuntimeResult> {
  const { manager, error } = await getMemorySearchManager(params);
  return {
    runtime: manager,
    error,
  };
}
