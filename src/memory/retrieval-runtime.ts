import type { EdwinPAIConfig } from "../config/config.js";
import type { MemoryRetrievalRuntime } from "./types.js";
import { getMemoryHostRuntime } from "./host-runtime.js";

export type MemoryRetrievalRuntimeResult = {
  runtime: MemoryRetrievalRuntime | null;
  error?: string;
};

export async function getMemoryRetrievalRuntime(params: {
  cfg: EdwinPAIConfig;
  agentId: string;
}): Promise<MemoryRetrievalRuntimeResult> {
  return await getMemoryHostRuntime(params);
}
