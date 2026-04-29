import { randomUUID } from "node:crypto";
import type { ModelCatalogEntry } from "../agents/model-catalog.js";
import type { EdwinPAIConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../agents/defaults.js";
import { resolveAllowedModelRef, resolveConfiguredModelRef } from "../agents/model-selection.js";
import { normalizeGroupActivation } from "../auto-reply/group-activation.js";
import {
  formatThinkingLevels,
  formatXHighModelHint,
  normalizeElevatedLevel,
  normalizeReasoningLevel,
  normalizeThinkLevel,
  normalizeUsageDisplay,
  supportsXHighThinking,
} from "../auto-reply/thinking.js";
import { isSubagentSessionKey } from "../routing/session-key.js";
import { applyVerboseOverride, parseVerboseOverride } from "../sessions/level-overrides.js";
import { applyModelOverrideToSessionEntry } from "../sessions/model-overrides.js";
import { normalizeSendPolicy } from "../sessions/send-policy.js";
import { parseSessionLabel } from "../sessions/session-label.js";
import {
  ErrorCodes,
  type ErrorShape,
  errorShape,
  type SessionsPatchParams,
} from "./protocol/index.js";
import { deleteTask, getActiveTask, reconcileActiveTask, setActiveTask } from "./tasks.js";

function invalid(message: string): { ok: false; error: ErrorShape } {
  return { ok: false, error: errorShape(ErrorCodes.INVALID_REQUEST, message) };
}

function normalizeExecHost(raw: string): "sandbox" | "gateway" | "node" | undefined {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "sandbox" || normalized === "gateway" || normalized === "node") {
    return normalized;
  }
  return undefined;
}

function normalizeExecSecurity(raw: string): "deny" | "allowlist" | "full" | undefined {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "deny" || normalized === "allowlist" || normalized === "full") {
    return normalized;
  }
  return undefined;
}

function normalizeExecAsk(raw: string): "off" | "on-miss" | "always" | undefined {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "off" || normalized === "on-miss" || normalized === "always") {
    return normalized;
  }
  return undefined;
}

export async function applySessionsPatchToStore(params: {
  cfg: EdwinPAIConfig;
  store: Record<string, SessionEntry>;
  storeKey: string;
  patch: SessionsPatchParams;
  loadGatewayModelCatalog?: () => Promise<ModelCatalogEntry[]>;
}): Promise<{ ok: true; entry: SessionEntry } | { ok: false; error: ErrorShape }> {
  const { cfg, store, storeKey, patch } = params;
  const now = Date.now();

  const existing = store[storeKey];
  const next: SessionEntry = existing
    ? {
        ...existing,
        updatedAt: Math.max(existing.updatedAt ?? 0, now),
      }
    : { sessionId: randomUUID(), updatedAt: now };

  if ("spawnedBy" in patch) {
    const raw = patch.spawnedBy;
    if (raw === null) {
      if (existing?.spawnedBy) {
        return invalid("spawnedBy cannot be cleared once set");
      }
    } else if (raw !== undefined) {
      const trimmed = String(raw).trim();
      if (!trimmed) {
        return invalid("invalid spawnedBy: empty");
      }
      if (!isSubagentSessionKey(storeKey)) {
        return invalid("spawnedBy is only supported for subagent:* sessions");
      }
      if (existing?.spawnedBy && existing.spawnedBy !== trimmed) {
        return invalid("spawnedBy cannot be changed once set");
      }
      next.spawnedBy = trimmed;
    }
  }

  if ("label" in patch) {
    const raw = patch.label;
    if (raw === null) {
      delete next.label;
    } else if (raw !== undefined) {
      const parsed = parseSessionLabel(raw);
      if (!parsed.ok) {
        return invalid(parsed.error);
      }
      for (const [key, entry] of Object.entries(store)) {
        if (key === storeKey) {
          continue;
        }
        if (entry?.label === parsed.label) {
          return invalid(`label already in use: ${parsed.label}`);
        }
      }
      next.label = parsed.label;
    }
  }

  if ("thinkingLevel" in patch) {
    const raw = patch.thinkingLevel;
    if (raw === null) {
      delete next.thinkingLevel;
    } else if (raw !== undefined) {
      const normalized = normalizeThinkLevel(String(raw));
      if (!normalized) {
        const resolvedDefault = resolveConfiguredModelRef({
          cfg,
          defaultProvider: DEFAULT_PROVIDER,
          defaultModel: DEFAULT_MODEL,
        });
        const hintProvider = existing?.providerOverride?.trim() || resolvedDefault.provider;
        const hintModel = existing?.modelOverride?.trim() || resolvedDefault.model;
        return invalid(
          `invalid thinkingLevel (use ${formatThinkingLevels(hintProvider, hintModel, "|")})`,
        );
      }
      if (normalized === "off") {
        delete next.thinkingLevel;
      } else {
        next.thinkingLevel = normalized;
      }
    }
  }

  if ("verboseLevel" in patch) {
    const raw = patch.verboseLevel;
    const parsed = parseVerboseOverride(raw);
    if (!parsed.ok) {
      return invalid(parsed.error);
    }
    applyVerboseOverride(next, parsed.value);
  }

  if ("reasoningLevel" in patch) {
    const raw = patch.reasoningLevel;
    if (raw === null) {
      delete next.reasoningLevel;
    } else if (raw !== undefined) {
      const normalized = normalizeReasoningLevel(String(raw));
      if (!normalized) {
        return invalid('invalid reasoningLevel (use "on"|"off"|"stream")');
      }
      if (normalized === "off") {
        delete next.reasoningLevel;
      } else {
        next.reasoningLevel = normalized;
      }
    }
  }

  if ("responseUsage" in patch) {
    const raw = patch.responseUsage;
    if (raw === null) {
      delete next.responseUsage;
    } else if (raw !== undefined) {
      const normalized = normalizeUsageDisplay(String(raw));
      if (!normalized) {
        return invalid('invalid responseUsage (use "off"|"tokens"|"full")');
      }
      if (normalized === "off") {
        delete next.responseUsage;
      } else {
        next.responseUsage = normalized;
      }
    }
  }

  if ("elevatedLevel" in patch) {
    const raw = patch.elevatedLevel;
    if (raw === null) {
      delete next.elevatedLevel;
    } else if (raw !== undefined) {
      const normalized = normalizeElevatedLevel(String(raw));
      if (!normalized) {
        return invalid('invalid elevatedLevel (use "on"|"off"|"ask"|"full")');
      }
      // Persist "off" explicitly so patches can override defaults.
      next.elevatedLevel = normalized;
    }
  }

  if ("execHost" in patch) {
    const raw = patch.execHost;
    if (raw === null) {
      delete next.execHost;
    } else if (raw !== undefined) {
      const normalized = normalizeExecHost(String(raw));
      if (!normalized) {
        return invalid('invalid execHost (use "sandbox"|"gateway"|"node")');
      }
      next.execHost = normalized;
    }
  }

  if ("execSecurity" in patch) {
    const raw = patch.execSecurity;
    if (raw === null) {
      delete next.execSecurity;
    } else if (raw !== undefined) {
      const normalized = normalizeExecSecurity(String(raw));
      if (!normalized) {
        return invalid('invalid execSecurity (use "deny"|"allowlist"|"full")');
      }
      next.execSecurity = normalized;
    }
  }

  if ("execAsk" in patch) {
    const raw = patch.execAsk;
    if (raw === null) {
      delete next.execAsk;
    } else if (raw !== undefined) {
      const normalized = normalizeExecAsk(String(raw));
      if (!normalized) {
        return invalid('invalid execAsk (use "off"|"on-miss"|"always")');
      }
      next.execAsk = normalized;
    }
  }

  if ("execNode" in patch) {
    const raw = patch.execNode;
    if (raw === null) {
      delete next.execNode;
    } else if (raw !== undefined) {
      const trimmed = String(raw).trim();
      if (!trimmed) {
        return invalid("invalid execNode: empty");
      }
      next.execNode = trimmed;
    }
  }

  if (
    "autoContinueEnabled" in patch ||
    "autoContinueMaxIterations" in patch ||
    "autoContinueDelayMs" in patch
  ) {
    const nextAutoContinue = { ...(next.autoContinue ?? {}) };

    if ("autoContinueEnabled" in patch) {
      const raw = patch.autoContinueEnabled;
      if (raw === null) {
        delete nextAutoContinue.enabled;
        nextAutoContinue.active = false;
        nextAutoContinue.iterationCount = 0;
      } else if (raw !== undefined) {
        nextAutoContinue.enabled = Boolean(raw);
        if (!nextAutoContinue.enabled) {
          nextAutoContinue.active = false;
          nextAutoContinue.iterationCount = 0;
        }
      }
    }

    if ("autoContinueMaxIterations" in patch) {
      const raw = patch.autoContinueMaxIterations;
      if (raw === null) {
        delete nextAutoContinue.maxIterations;
      } else if (raw !== undefined) {
        nextAutoContinue.maxIterations = Number(raw);
      }
    }

    if ("autoContinueDelayMs" in patch) {
      const raw = patch.autoContinueDelayMs;
      if (raw === null) {
        delete nextAutoContinue.delayMs;
      } else if (raw !== undefined) {
        nextAutoContinue.delayMs = Number(raw);
      }
    }

    if (Object.keys(nextAutoContinue).length === 0) {
      delete next.autoContinue;
    } else {
      next.autoContinue = nextAutoContinue;
    }
  }

  if (
    "taskId" in patch ||
    "taskGoal" in patch ||
    "taskDefinitionOfDone" in patch ||
    "taskCriteria" in patch ||
    "taskCompletedCriteria" in patch ||
    "taskBlockedReason" in patch ||
    "taskNeedsUserReason" in patch ||
    "taskStatus" in patch ||
    "taskAutoContinueEnabled" in patch ||
    "taskMaxIterations" in patch ||
    "taskDelayMs" in patch
  ) {
    const currentTask = { ...(getActiveTask(next) ?? {}) };

    if ("taskId" in patch) {
      const raw = patch.taskId;
      if (raw === null) {
        const existingId = getActiveTask(next)?.id;
        if (existingId) {
          const deleted = deleteTask(next, existingId);
          if (!deleted.ok) {
            return deleted;
          }
          Object.assign(next, deleted.entry);
        }
      } else if (raw !== undefined) {
        currentTask.id = String(raw).trim();
      }
    }
    if ("taskGoal" in patch) {
      const raw = patch.taskGoal;
      if (raw === null) {
        delete currentTask.goal;
      } else if (raw !== undefined) {
        currentTask.goal = String(raw).trim();
      }
    }
    if ("taskDefinitionOfDone" in patch) {
      const raw = patch.taskDefinitionOfDone;
      if (raw === null) {
        delete currentTask.definitionOfDone;
      } else if (raw !== undefined) {
        currentTask.definitionOfDone = String(raw).trim();
      }
    }
    if ("taskCriteria" in patch) {
      const raw = patch.taskCriteria;
      if (raw === null) {
        delete currentTask.criteria;
      } else if (raw !== undefined) {
        currentTask.criteria = raw.map((item) => String(item).trim()).filter(Boolean);
      }
    }
    if ("taskCompletedCriteria" in patch) {
      const raw = patch.taskCompletedCriteria;
      if (raw === null) {
        delete currentTask.completedCriteria;
      } else if (raw !== undefined) {
        currentTask.completedCriteria = raw.map((item) => String(item).trim()).filter(Boolean);
      }
    }
    if ("taskBlockedReason" in patch) {
      const raw = patch.taskBlockedReason;
      if (raw === null) {
        delete currentTask.blockedReason;
      } else if (raw !== undefined) {
        currentTask.blockedReason = String(raw).trim();
      }
    }
    if ("taskNeedsUserReason" in patch) {
      const raw = patch.taskNeedsUserReason;
      if (raw === null) {
        delete currentTask.needsUserReason;
      } else if (raw !== undefined) {
        currentTask.needsUserReason = String(raw).trim();
      }
    }
    if ("taskStatus" in patch) {
      const raw = patch.taskStatus;
      if (raw === null) {
        delete currentTask.status;
      } else if (raw !== undefined) {
        currentTask.status = raw;
      }
    }
    if ("taskAutoContinueEnabled" in patch) {
      const raw = patch.taskAutoContinueEnabled;
      if (raw === null) {
        delete currentTask.autoContinueEnabled;
        currentTask.active = false;
        currentTask.iterationCount = 0;
      } else if (raw !== undefined) {
        currentTask.autoContinueEnabled = Boolean(raw);
        if (!currentTask.autoContinueEnabled) {
          currentTask.active = false;
          currentTask.iterationCount = 0;
        }
      }
    }
    if ("taskMaxIterations" in patch) {
      const raw = patch.taskMaxIterations;
      if (raw === null) {
        delete currentTask.maxIterations;
      } else if (raw !== undefined) {
        currentTask.maxIterations = Number(raw);
      }
    }
    if ("taskDelayMs" in patch) {
      const raw = patch.taskDelayMs;
      if (raw === null) {
        delete currentTask.delayMs;
      } else if (raw !== undefined) {
        currentTask.delayMs = Number(raw);
      }
    }

    if (Object.keys(currentTask).length > 0) {
      Object.assign(next, setActiveTask(next, currentTask));
    }
  }

  if ("model" in patch) {
    const raw = patch.model;
    const resolvedDefault = resolveConfiguredModelRef({
      cfg,
      defaultProvider: DEFAULT_PROVIDER,
      defaultModel: DEFAULT_MODEL,
    });
    if (raw === null) {
      applyModelOverrideToSessionEntry({
        entry: next,
        selection: {
          provider: resolvedDefault.provider,
          model: resolvedDefault.model,
          isDefault: true,
        },
      });
    } else if (raw !== undefined) {
      const trimmed = String(raw).trim();
      if (!trimmed) {
        return invalid("invalid model: empty");
      }
      if (!params.loadGatewayModelCatalog) {
        return {
          ok: false,
          error: errorShape(ErrorCodes.UNAVAILABLE, "model catalog unavailable"),
        };
      }
      const catalog = await params.loadGatewayModelCatalog();
      const resolved = resolveAllowedModelRef({
        cfg,
        catalog,
        raw: trimmed,
        defaultProvider: resolvedDefault.provider,
        defaultModel: resolvedDefault.model,
      });
      if ("error" in resolved) {
        return invalid(resolved.error);
      }
      const isDefault =
        resolved.ref.provider === resolvedDefault.provider &&
        resolved.ref.model === resolvedDefault.model;

      // Clear stale authProfileOverride when switching providers so the auto
      // profile resolution picks the correct provider on the next turn.
      // Without this, switching e.g. from openai-codex to anthropic leaves
      // the session pinned to "openai-codex:default" which rejects the new model.
      const providerChanged =
        !isDefault &&
        next.authProfileOverrideSource === "auto" &&
        next.authProfileOverride &&
        !next.authProfileOverride.startsWith(`${resolved.ref.provider}:`);

      applyModelOverrideToSessionEntry({
        entry: next,
        selection: {
          provider: resolved.ref.provider,
          model: resolved.ref.model,
          isDefault,
        },
      });

      // If the provider changed and the auth profile override is stale (pointing
      // at the old provider), clear it so auto-resolution picks the correct
      // profile for the new provider on the next turn. Without this, switching
      // e.g. from openai-codex to anthropic leaves the session pinned to
      // "openai-codex:default" which rejects the new model.
      if (providerChanged) {
        delete next.authProfileOverride;
        delete next.authProfileOverrideSource;
        delete next.authProfileOverrideCompactionCount;
      }
    }
  }

  if (next.thinkingLevel === "xhigh") {
    const resolvedDefault = resolveConfiguredModelRef({
      cfg,
      defaultProvider: DEFAULT_PROVIDER,
      defaultModel: DEFAULT_MODEL,
    });
    const effectiveProvider = next.providerOverride ?? resolvedDefault.provider;
    const effectiveModel = next.modelOverride ?? resolvedDefault.model;
    if (!supportsXHighThinking(effectiveProvider, effectiveModel)) {
      if ("thinkingLevel" in patch) {
        return invalid(`thinkingLevel "xhigh" is only supported for ${formatXHighModelHint()}`);
      }
      next.thinkingLevel = "high";
    }
  }

  if ("sendPolicy" in patch) {
    const raw = patch.sendPolicy;
    if (raw === null) {
      delete next.sendPolicy;
    } else if (raw !== undefined) {
      const normalized = normalizeSendPolicy(String(raw));
      if (!normalized) {
        return invalid('invalid sendPolicy (use "allow"|"deny")');
      }
      next.sendPolicy = normalized;
    }
  }

  if ("groupActivation" in patch) {
    const raw = patch.groupActivation;
    if (raw === null) {
      delete next.groupActivation;
    } else if (raw !== undefined) {
      const normalized = normalizeGroupActivation(String(raw));
      if (!normalized) {
        return invalid('invalid groupActivation (use "mention"|"always")');
      }
      next.groupActivation = normalized;
    }
  }

  const reconciled = reconcileActiveTask(next);
  store[storeKey] = reconciled;
  return { ok: true, entry: reconciled };
}
