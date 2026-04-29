import type { EdwinPAIConfig } from "../config/config.js";
import type { ResolvedQmdConfig } from "./backend-config.js";
import type { MemorySearchManager } from "./types.js";
import { instantiateMemoryEngineRuntime } from "../../packages/shad-core/src/index.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveMemoryBackendConfig } from "./backend-config.js";
import { createBuiltinMemorySearchManager, createQmdMemorySearchManager } from "./factory.js";

const log = createSubsystemLogger("memory");
const QMD_MANAGER_CACHE = new Map<string, MemorySearchManager>();

export type MemorySearchManagerResult = {
  manager: MemorySearchManager | null;
  error?: string;
};

/**
 * Edwin-side host wrapper for the memory runtime.
 *
 * Responsibilities that stay here:
 * - backend/config resolution
 * - host-local QMD manager caching
 * - wiring concrete host manager factories into the engine runtime path
 */
export async function getMemorySearchManager(params: {
  cfg: EdwinPAIConfig;
  agentId: string;
}): Promise<MemorySearchManagerResult> {
  const resolved = resolveMemoryBackendConfig(params);
  const resolvedQmd = resolved.qmd;

  if (resolved.backend === "qmd" && resolvedQmd) {
    const cacheKey = buildQmdCacheKey(params.agentId, resolvedQmd);
    const cached = QMD_MANAGER_CACHE.get(cacheKey);
    if (cached) {
      return { manager: cached };
    }

    try {
      const created = await instantiateMemoryEngineRuntime({
        primaryBackend: "qmd",
        createPrimary: async () => {
          return (await createQmdMemorySearchManager({
            cfg: params.cfg,
            agentId: params.agentId,
            resolved: resolvedQmd,
          })) as MemorySearchManager | null;
        },
        createFallback: async () => {
          return (await createBuiltinMemorySearchManager({
            cfg: params.cfg,
            agentId: params.agentId,
          })) as MemorySearchManager | null;
        },
        onPrimaryCreateError: (message) => {
          log.warn(`qmd memory unavailable; falling back to builtin: ${message}`);
        },
        onPrimaryClose: () => QMD_MANAGER_CACHE.delete(cacheKey),
      });
      const manager = created.manager as MemorySearchManager | null;
      if (manager) {
        if (created.backend === "qmd") {
          QMD_MANAGER_CACHE.set(cacheKey, manager);
        }
        return { manager };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { manager: null, error: message };
    }
  }

  try {
    const created = await instantiateMemoryEngineRuntime({
      createFallback: async () => {
        return (await createBuiltinMemorySearchManager({
          cfg: params.cfg,
          agentId: params.agentId,
        })) as MemorySearchManager | null;
      },
    });
    return { manager: created.manager as MemorySearchManager | null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { manager: null, error: message };
  }
}

function buildQmdCacheKey(agentId: string, config: ResolvedQmdConfig): string {
  return `${agentId}:${stableSerialize(config)}`;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }
  if (value && typeof value === "object") {
    const sortedEntries = Object.keys(value as Record<string, unknown>)
      .toSorted((a, b) => a.localeCompare(b))
      .map((key) => [key, sortValue((value as Record<string, unknown>)[key])]);
    return Object.fromEntries(sortedEntries);
  }
  return value;
}
