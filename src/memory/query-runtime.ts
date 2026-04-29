import type { EdwinPAIConfig } from "../config/config.js";
import type { MemoryQueryRuntime } from "./types.js";
import { getMemoryHostRuntime } from "./host-runtime.js";

export type MemoryQueryRuntimeResult = {
  runtime: MemoryQueryRuntime | null;
  error?: string;
};

export async function getMemoryQueryRuntime(params: {
  cfg: EdwinPAIConfig;
  agentId: string;
}): Promise<MemoryQueryRuntimeResult> {
  return await getMemoryHostRuntime(params);
}
