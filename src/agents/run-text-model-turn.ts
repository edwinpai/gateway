import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { EdwinPAIConfig } from "../config/config.js";
import { resolveUserPath } from "../utils.js";
import { runCliAgent } from "./cli-runner.js";
import { runWithModelFallback } from "./model-fallback.js";
import {
  buildModelAliasIndex,
  isCliProvider,
  resolveConfiguredModelRef,
  resolveModelRefFromString,
} from "./model-selection.js";
import { runEmbeddedPiAgent } from "./pi-embedded.js";

export type RunTextModelTurnParams = {
  cfg: EdwinPAIConfig;
  workspaceDir: string;
  prompt: string;
  model: string;
  timeoutMs: number;
  extraSystemPrompt?: string;
  thinkLevel?: "off" | "low" | "medium" | "high" | "max" | "xhigh";
  logger?: { warn?: (...args: any[]) => void };
};

export type RunTextModelTurnResult = {
  text: string;
  provider: string;
  model: string;
  attempts: Array<{ provider: string; model: string; error: string }>;
};

function resolveRequestedModel(params: { cfg: EdwinPAIConfig; model: string }): {
  provider: string;
  model: string;
} {
  const primary = resolveConfiguredModelRef({
    cfg: params.cfg,
    defaultProvider: "anthropic",
    defaultModel: "sonnet",
  });
  const raw = params.model.trim();
  if (!raw || raw === "primary" || raw === "default") {
    return primary;
  }
  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg,
    defaultProvider: primary.provider,
  });
  const resolved = resolveModelRefFromString({
    raw,
    defaultProvider: primary.provider,
    aliasIndex,
  });
  if (!resolved) {
    throw new Error(`Could not resolve model selector: ${params.model}`);
  }
  return resolved.ref;
}

function extractText(result: Awaited<ReturnType<typeof runEmbeddedPiAgent>>): string {
  return (result.payloads ?? [])
    .map((payload) => payload.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export async function runTextModelTurn(
  params: RunTextModelTurnParams,
): Promise<RunTextModelTurnResult> {
  const requested = resolveRequestedModel({ cfg: params.cfg, model: params.model });
  const workspaceDir = resolveUserPath(params.workspaceDir);
  const runId = crypto.randomUUID();
  const sessionId = `deep-workflow-${runId}`;
  const sessionDir = path.join(workspaceDir, ".deep-workflow");
  await fs.mkdir(sessionDir, { recursive: true });
  const sessionFile = path.join(sessionDir, `${sessionId}.jsonl`);

  const result = await runWithModelFallback({
    cfg: params.cfg,
    provider: requested.provider,
    model: requested.model,
    run: async (provider, model) => {
      if (isCliProvider(provider, params.cfg)) {
        return await runCliAgent({
          sessionId,
          sessionKey: sessionId,
          sessionFile,
          workspaceDir,
          config: params.cfg,
          prompt: params.prompt,
          provider,
          model,
          thinkLevel: params.thinkLevel ?? "off",
          timeoutMs: params.timeoutMs,
          runId,
          extraSystemPrompt: params.extraSystemPrompt,
        });
      }

      return await runEmbeddedPiAgent({
        sessionId,
        sessionKey: sessionId,
        sessionFile,
        workspaceDir,
        config: params.cfg,
        prompt: params.prompt,
        extraSystemPrompt: params.extraSystemPrompt,
        disableTools: true,
        provider,
        model,
        thinkLevel: params.thinkLevel ?? "off",
        timeoutMs: params.timeoutMs,
        runId,
      });
    },
    onError: async (attempt) => {
      const reason = attempt.error instanceof Error ? attempt.error.message : String(attempt.error);
      params.logger?.warn?.(
        `run-text-model-turn: attempt failed for ${attempt.provider}/${attempt.model} — ${reason}`,
      );
    },
  });

  const text = extractText(result.result);
  if (!text) {
    throw new Error(`Model run returned no text for ${result.provider}/${result.model}`);
  }

  return {
    text,
    provider: result.provider,
    model: result.model,
    attempts: result.attempts.map((attempt) => ({
      provider: attempt.provider,
      model: attempt.model,
      error: attempt.error,
    })),
  };
}
