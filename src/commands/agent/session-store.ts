import type { EdwinPAIConfig } from "../../config/config.js";
import { setCliSessionId } from "../../agents/cli-session.js";
import { lookupContextTokens } from "../../agents/context.js";
import { DEFAULT_CONTEXT_TOKENS } from "../../agents/defaults.js";
import { isCliProvider } from "../../agents/model-selection.js";
import { hasNonzeroUsage } from "../../agents/usage.js";
import { type SessionEntry, updateSessionStore } from "../../config/sessions.js";

type RunResult = Awaited<
  ReturnType<(typeof import("../../agents/pi-embedded.js"))["runEmbeddedPiAgent"]>
>;

export async function updateSessionStoreAfterAgentRun(params: {
  cfg: EdwinPAIConfig;
  contextTokensOverride?: number;
  sessionId: string;
  sessionKey: string;
  storePath: string;
  sessionStore: Record<string, SessionEntry>;
  defaultProvider: string;
  defaultModel: string;
  fallbackProvider?: string;
  fallbackModel?: string;
  result: RunResult;
}) {
  const {
    cfg,
    sessionId,
    sessionKey,
    storePath,
    sessionStore,
    defaultProvider,
    defaultModel,
    fallbackProvider,
    fallbackModel,
    result,
  } = params;

  const usage = result.meta.agentMeta?.usage;
  const modelUsed = result.meta.agentMeta?.model ?? fallbackModel ?? defaultModel;
  const providerUsed = result.meta.agentMeta?.provider ?? fallbackProvider ?? defaultProvider;
  const contextTokens =
    params.contextTokensOverride ?? lookupContextTokens(modelUsed) ?? DEFAULT_CONTEXT_TOKENS;

  const staleEntry = sessionStore[sessionKey] ?? {
    sessionId,
    updatedAt: Date.now(),
  };

  const next = await updateSessionStore(storePath, (store) => {
    // Re-read the entry inside updateSessionStore's lock. Agent tools (notably
    // task_state) can update the same session while the model run is active;
    // using the pre-run in-memory entry here would clobber those updates and
    // prevent task auto-continue from seeing newly-created/progressed tasks.
    const entry = store[sessionKey] ?? staleEntry;
    const merged: SessionEntry = {
      ...entry,
      sessionId,
      updatedAt: Date.now(),
      modelProvider: providerUsed,
      model: modelUsed,
      contextTokens,
    };
    if (isCliProvider(providerUsed, cfg)) {
      const cliSessionId = result.meta.agentMeta?.sessionId?.trim();
      if (cliSessionId) {
        setCliSessionId(merged, providerUsed, cliSessionId);
      }
    }
    merged.abortedLastRun = result.meta.aborted ?? false;
    if (hasNonzeroUsage(usage)) {
      const input = usage.input ?? 0;
      const output = usage.output ?? 0;
      const promptTokens = input + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
      merged.inputTokens = input;
      merged.outputTokens = output;
      merged.totalTokens = promptTokens > 0 ? promptTokens : (usage.total ?? input);
    }
    store[sessionKey] = merged;
    return merged;
  });

  sessionStore[sessionKey] = next;
  return next;
}
