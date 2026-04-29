import { Type } from "@sinclair/typebox";
import crypto from "node:crypto";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import type { AnyAgentTool } from "./common.js";
import { formatThinkingLevels, normalizeThinkLevel } from "../../auto-reply/thinking.js";
import { loadConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import {
  normalizeRuntimeAttachmentPolicy,
  resolveMemoryCapabilityTier,
  type MemoryRuntimeAttachmentPolicy,
} from "../../memory/public-policy.js";
import {
  isSubagentSessionKey,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../../routing/session-key.js";
import { normalizeDeliveryContext } from "../../utils/delivery-context.js";
import { resolveAgentConfig } from "../agent-scope.js";
import {
  formatKnowledgeDisciplineDoctorHint,
  loadKnowledgeDisciplineProfiles,
} from "../knowledge-discipline-profiles.js";
import { AGENT_LANE_SUBAGENT } from "../lanes.js";
import { optionalStringEnum } from "../schema/typebox.js";
import { buildSubagentSystemPrompt } from "../subagent-announce.js";
import { registerSubagentRun } from "../subagent-registry.js";
import { jsonResult, readStringParam } from "./common.js";
import {
  resolveDisplaySessionKey,
  resolveInternalSessionKey,
  resolveMainSessionAlias,
} from "./sessions-helpers.js";

const SessionsSpawnToolSchema = Type.Object({
  task: Type.String(),
  label: Type.Optional(Type.String()),
  agentId: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  thinking: Type.Optional(Type.String()),
  profile: Type.Optional(Type.String()),
  allowedCollections: Type.Optional(Type.Array(Type.String())),
  runTimeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  // Back-compat alias. Prefer runTimeoutSeconds.
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  cleanup: optionalStringEnum(["delete", "keep"] as const),
});

function splitModelRef(ref?: string) {
  if (!ref) {
    return { provider: undefined, model: undefined };
  }
  const trimmed = ref.trim();
  if (!trimmed) {
    return { provider: undefined, model: undefined };
  }
  const [provider, model] = trimmed.split("/", 2);
  if (model) {
    return { provider, model };
  }
  return { provider: undefined, model: trimmed };
}

function normalizeModelSelection(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const primary = (value as { primary?: unknown }).primary;
  if (typeof primary === "string" && primary.trim()) {
    return primary.trim();
  }
  return undefined;
}

type ResolvedSubagentKnowledgeProfile = {
  profile?: string;
  allowedCollections?: string[];
  runtimeAttachmentPolicy?: MemoryRuntimeAttachmentPolicy;
  error?: string;
};

function normalizeProfileId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed || undefined;
}

function normalizeCollections(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = Array.from(
    new Set(value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean)),
  );
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeProfileBindingsMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [rawAgentId, rawProfileId] of Object.entries(value)) {
    const agentId = normalizeAgentId(rawAgentId);
    const profileId = normalizeProfileId(rawProfileId);
    if (!agentId || !profileId) {
      continue;
    }
    out[agentId] = profileId;
  }
  return out;
}

function normalizeProfileMap(value: unknown): Record<
  string,
  {
    selectedCollections?: string[];
    runtimeAttachmentPolicy?: MemoryRuntimeAttachmentPolicy;
    invalidRuntimeAttachmentPolicy?: string;
  }
> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const out: Record<
    string,
    {
      selectedCollections?: string[];
      runtimeAttachmentPolicy?: MemoryRuntimeAttachmentPolicy;
      invalidRuntimeAttachmentPolicy?: string;
    }
  > = {};
  for (const [rawId, rawProfile] of Object.entries(value)) {
    const id = normalizeProfileId(rawId);
    if (!id || !rawProfile || typeof rawProfile !== "object") {
      continue;
    }
    const selectedCollections = normalizeCollections(
      (rawProfile as { selectedCollections?: unknown }).selectedCollections,
    );
    const runtimeAttachmentPolicyRaw = (rawProfile as { runtimeAttachmentPolicy?: unknown })
      .runtimeAttachmentPolicy;
    const rawRuntimeAttachmentPolicy =
      typeof runtimeAttachmentPolicyRaw === "string" && runtimeAttachmentPolicyRaw.trim()
        ? runtimeAttachmentPolicyRaw.trim()
        : undefined;
    const runtimeAttachmentPolicy = normalizeRuntimeAttachmentPolicy(rawRuntimeAttachmentPolicy);
    out[id] = {
      selectedCollections,
      runtimeAttachmentPolicy,
      invalidRuntimeAttachmentPolicy:
        rawRuntimeAttachmentPolicy && !runtimeAttachmentPolicy
          ? rawRuntimeAttachmentPolicy
          : undefined,
    };
  }
  return out;
}

function resolveSubagentKnowledgeProfile(params: {
  explicitAllowedCollections?: unknown;
  explicitProfile?: unknown;
  requesterAgentConfig?: ReturnType<typeof resolveAgentConfig>;
  targetAgentId?: string;
  targetAgentConfig?: ReturnType<typeof resolveAgentConfig>;
  defaultsSubagents?: ReturnType<typeof loadConfig>["agents"] extends { defaults?: infer T }
    ? T extends { subagents?: infer U }
      ? U
      : undefined
    : undefined;
}): ResolvedSubagentKnowledgeProfile {
  const explicitAllowedCollections = normalizeCollections(params.explicitAllowedCollections);
  if (explicitAllowedCollections) {
    return { allowedCollections: explicitAllowedCollections };
  }

  const disciplineProfiles = loadKnowledgeDisciplineProfiles();
  const defaultProfiles = normalizeProfileMap(params.defaultsSubagents?.profiles);
  const agentProfiles = normalizeProfileMap(params.targetAgentConfig?.subagents?.profiles);
  const profiles = {
    ...disciplineProfiles,
    ...defaultProfiles,
    ...agentProfiles,
  };

  const defaultProfileBindings = normalizeProfileBindingsMap(
    params.defaultsSubagents?.profileBindings,
  );
  const requesterProfileBindings = normalizeProfileBindingsMap(
    params.requesterAgentConfig?.subagents?.profileBindings,
  );
  const boundProfile = params.targetAgentId
    ? (requesterProfileBindings[normalizeAgentId(params.targetAgentId)] ??
      defaultProfileBindings[normalizeAgentId(params.targetAgentId)])
    : undefined;

  const requestedProfile =
    normalizeProfileId(params.explicitProfile) ??
    boundProfile ??
    normalizeProfileId(params.targetAgentConfig?.subagents?.profile) ??
    normalizeProfileId(params.defaultsSubagents?.profile);

  if (requestedProfile) {
    const resolved = profiles[requestedProfile];
    const doctorHint = formatKnowledgeDisciplineDoctorHint();
    if (!resolved) {
      return {
        error: `Unknown subagent profile "${requestedProfile}". ${doctorHint}`,
      };
    }
    if (resolved.invalidRuntimeAttachmentPolicy) {
      return {
        error: `Subagent profile "${requestedProfile}" has invalid runtimeAttachmentPolicy "${resolved.invalidRuntimeAttachmentPolicy}". ${doctorHint}`,
      };
    }
    if (!resolved.selectedCollections || resolved.selectedCollections.length === 0) {
      return {
        error: `Subagent profile "${requestedProfile}" must define selectedCollections. ${doctorHint}`,
      };
    }
    return {
      profile: requestedProfile,
      allowedCollections: resolved.selectedCollections,
      runtimeAttachmentPolicy: resolved.runtimeAttachmentPolicy,
    };
  }

  const inheritedAllowedCollections = normalizeCollections(
    params.targetAgentConfig?.subagents?.allowedCollections ??
      params.defaultsSubagents?.allowedCollections,
  );
  return {
    allowedCollections: inheritedAllowedCollections,
  };
}

export function createSessionsSpawnTool(opts?: {
  agentSessionKey?: string;
  agentChannel?: GatewayMessageChannel;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  agentGroupId?: string | null;
  agentGroupChannel?: string | null;
  agentGroupSpace?: string | null;
  sandboxed?: boolean;
  /** Explicit agent ID override for cron/hook sessions where session key parsing may not work. */
  requesterAgentIdOverride?: string;
}): AnyAgentTool {
  return {
    label: "Sessions",
    name: "sessions_spawn",
    description:
      "Spawn a background sub-agent run in an isolated session and announce the result back to the requester chat.",
    parameters: SessionsSpawnToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const task = readStringParam(params, "task", { required: true });
      const label = typeof params.label === "string" ? params.label.trim() : "";
      const requestedAgentId = readStringParam(params, "agentId");
      const modelOverride = readStringParam(params, "model");
      const thinkingOverrideRaw = readStringParam(params, "thinking");
      const requestedProfile = readStringParam(params, "profile");
      const cleanup =
        params.cleanup === "keep" || params.cleanup === "delete" ? params.cleanup : "keep";
      const requesterOrigin = normalizeDeliveryContext({
        channel: opts?.agentChannel,
        accountId: opts?.agentAccountId,
        to: opts?.agentTo,
        threadId: opts?.agentThreadId,
      });
      const runTimeoutSeconds = (() => {
        const explicit =
          typeof params.runTimeoutSeconds === "number" && Number.isFinite(params.runTimeoutSeconds)
            ? Math.max(0, Math.floor(params.runTimeoutSeconds))
            : undefined;
        if (explicit !== undefined) {
          return explicit;
        }
        const legacy =
          typeof params.timeoutSeconds === "number" && Number.isFinite(params.timeoutSeconds)
            ? Math.max(0, Math.floor(params.timeoutSeconds))
            : undefined;
        return legacy ?? 0;
      })();
      let modelWarning: string | undefined;
      let modelApplied = false;

      const cfg = loadConfig();
      const { mainKey, alias } = resolveMainSessionAlias(cfg);
      const requesterSessionKey = opts?.agentSessionKey;
      if (typeof requesterSessionKey === "string" && isSubagentSessionKey(requesterSessionKey)) {
        return jsonResult({
          status: "forbidden",
          error: "sessions_spawn is not allowed from sub-agent sessions",
        });
      }
      const requesterInternalKey = requesterSessionKey
        ? resolveInternalSessionKey({
            key: requesterSessionKey,
            alias,
            mainKey,
          })
        : alias;
      const requesterDisplayKey = resolveDisplaySessionKey({
        key: requesterInternalKey,
        alias,
        mainKey,
      });

      const requesterAgentId = normalizeAgentId(
        opts?.requesterAgentIdOverride ?? parseAgentSessionKey(requesterInternalKey)?.agentId,
      );
      const targetAgentId = requestedAgentId
        ? normalizeAgentId(requestedAgentId)
        : requesterAgentId;
      if (targetAgentId !== requesterAgentId) {
        const allowAgents = resolveAgentConfig(cfg, requesterAgentId)?.subagents?.allowAgents ?? [];
        const allowAny = allowAgents.some((value) => value.trim() === "*");
        const normalizedTargetId = targetAgentId.toLowerCase();
        const allowSet = new Set(
          allowAgents
            .filter((value) => value.trim() && value.trim() !== "*")
            .map((value) => normalizeAgentId(value).toLowerCase()),
        );
        if (!allowAny && !allowSet.has(normalizedTargetId)) {
          const allowedText = allowAny
            ? "*"
            : allowSet.size > 0
              ? Array.from(allowSet).join(", ")
              : "none";
          return jsonResult({
            status: "forbidden",
            error: `agentId is not allowed for sessions_spawn (allowed: ${allowedText})`,
          });
        }
      }
      const childSessionKey = `agent:${targetAgentId}:subagent:${crypto.randomUUID()}`;
      const spawnedByKey = requesterInternalKey;
      const requesterAgentConfig = resolveAgentConfig(cfg, requesterAgentId);
      const targetAgentConfig = resolveAgentConfig(cfg, targetAgentId);
      const resolvedKnowledgeProfile = resolveSubagentKnowledgeProfile({
        explicitAllowedCollections: params.allowedCollections,
        explicitProfile: requestedProfile,
        requesterAgentConfig,
        targetAgentId,
        targetAgentConfig,
        defaultsSubagents: cfg.agents?.defaults?.subagents,
      });
      if (resolvedKnowledgeProfile.error) {
        return jsonResult({
          status: "error",
          error: resolvedKnowledgeProfile.error,
        });
      }
      const allowedCollections = resolvedKnowledgeProfile.allowedCollections;
      const resolvedProfile = resolvedKnowledgeProfile.profile;
      const runtimeAttachmentPolicy = resolvedKnowledgeProfile.runtimeAttachmentPolicy;
      const memoryCapabilityTier = resolveMemoryCapabilityTier({
        actorType: "subagent",
        runtimeAttachmentPolicy,
      });
      const resolvedModel =
        normalizeModelSelection(modelOverride) ??
        normalizeModelSelection(targetAgentConfig?.subagents?.model) ??
        normalizeModelSelection(cfg.agents?.defaults?.subagents?.model);

      const resolvedThinkingDefaultRaw =
        readStringParam(targetAgentConfig?.subagents ?? {}, "thinking") ??
        readStringParam(cfg.agents?.defaults?.subagents ?? {}, "thinking");

      let thinkingOverride: string | undefined;
      const thinkingCandidateRaw = thinkingOverrideRaw || resolvedThinkingDefaultRaw;
      if (thinkingCandidateRaw) {
        const normalized = normalizeThinkLevel(thinkingCandidateRaw);
        if (!normalized) {
          const { provider, model } = splitModelRef(resolvedModel);
          const hint = formatThinkingLevels(provider, model);
          return jsonResult({
            status: "error",
            error: `Invalid thinking level "${thinkingCandidateRaw}". Use one of: ${hint}.`,
          });
        }
        thinkingOverride = normalized;
      }
      if (resolvedModel) {
        try {
          await callGateway({
            method: "sessions.patch",
            params: { key: childSessionKey, model: resolvedModel },
            timeoutMs: 10_000,
          });
          modelApplied = true;
        } catch (err) {
          const messageText =
            err instanceof Error ? err.message : typeof err === "string" ? err : "error";
          const recoverable =
            messageText.includes("invalid model") || messageText.includes("model not allowed");
          if (!recoverable) {
            return jsonResult({
              status: "error",
              error: messageText,
              childSessionKey,
            });
          }
          modelWarning = messageText;
        }
      }
      const childSystemPrompt = buildSubagentSystemPrompt({
        requesterSessionKey,
        requesterOrigin,
        childSessionKey,
        label: label || undefined,
        task,
        profile: resolvedProfile,
        allowedCollections,
        runtimeAttachmentPolicy,
      });

      const childIdem = crypto.randomUUID();
      let childRunId: string = childIdem;
      try {
        const response = await callGateway<{ runId: string }>({
          method: "agent",
          params: {
            message: task,
            sessionKey: childSessionKey,
            channel: requesterOrigin?.channel,
            idempotencyKey: childIdem,
            deliver: false,
            lane: AGENT_LANE_SUBAGENT,
            extraSystemPrompt: childSystemPrompt,
            thinking: thinkingOverride,
            timeout: runTimeoutSeconds > 0 ? runTimeoutSeconds : undefined,
            label: label || undefined,
            spawnedBy: spawnedByKey,
            groupId: opts?.agentGroupId ?? undefined,
            groupChannel: opts?.agentGroupChannel ?? undefined,
            groupSpace: opts?.agentGroupSpace ?? undefined,
          },
          timeoutMs: 10_000,
        });
        if (typeof response?.runId === "string" && response.runId) {
          childRunId = response.runId;
        }
      } catch (err) {
        const messageText =
          err instanceof Error ? err.message : typeof err === "string" ? err : "error";
        return jsonResult({
          status: "error",
          error: messageText,
          childSessionKey,
          runId: childRunId,
        });
      }

      registerSubagentRun({
        runId: childRunId,
        childSessionKey,
        requesterSessionKey: requesterInternalKey,
        requesterOrigin,
        requesterDisplayKey,
        task,
        cleanup,
        label: label || undefined,
        profile: resolvedProfile,
        runtimeAttachmentPolicy,
        allowedCollections,
        runTimeoutSeconds,
      });

      return jsonResult({
        status: "accepted",
        childSessionKey,
        runId: childRunId,
        profile: resolvedProfile,
        runtimeAttachmentPolicy,
        memoryCapabilityTier,
        allowedCollections,
        modelApplied: resolvedModel ? modelApplied : undefined,
        warning: modelWarning,
      });
    },
  };
}
