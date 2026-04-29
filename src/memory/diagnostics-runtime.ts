import type { EdwinPAIConfig } from "../config/config.js";
import type { MemoryDiagnosticsRuntime } from "./types.js";
import { getMemoryHostRuntime } from "./host-runtime.js";

export type MemoryDiagnosticsRuntimeResult = {
  runtime: MemoryDiagnosticsRuntime | null;
  error?: string;
};

export async function getMemoryDiagnosticsRuntime(params: {
  cfg: EdwinPAIConfig;
  agentId: string;
}): Promise<MemoryDiagnosticsRuntimeResult> {
  return await getMemoryHostRuntime(params);
}
