import path from "node:path";
import type { EdwinPAIConfig } from "../config/config.js";
import { inspectKnowledgeDisciplineProfiles } from "../agents/knowledge-discipline-profiles.js";
import { resolveStateDir } from "../config/paths.js";
import { normalizeRuntimeAttachmentPolicy } from "../memory/public-policy.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { note } from "../terminal/note.js";
import { shortenHomePath } from "../utils.js";

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

function normalizeProfileMap(value: unknown): Record<
  string,
  {
    selectedCollections?: string[];
    runtimeAttachmentPolicy?: string;
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
      runtimeAttachmentPolicy?: string;
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
    const rawPolicy =
      typeof runtimeAttachmentPolicyRaw === "string" && runtimeAttachmentPolicyRaw.trim()
        ? runtimeAttachmentPolicyRaw.trim()
        : undefined;
    const runtimeAttachmentPolicy = normalizeRuntimeAttachmentPolicy(rawPolicy);
    out[id] = {
      selectedCollections,
      runtimeAttachmentPolicy,
      invalidRuntimeAttachmentPolicy: rawPolicy && !runtimeAttachmentPolicy ? rawPolicy : undefined,
    };
  }
  return out;
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

export function collectKnowledgeDoctorWarnings(cfg: EdwinPAIConfig): string[] {
  const stateDir = resolveStateDir(process.env);
  const inspection = inspectKnowledgeDisciplineProfiles(stateDir);
  const warnings: string[] = inspection.issues.map(
    (issue) => `- ${issue} (${shortenHomePath(path.resolve(inspection.path))})`,
  );

  const defaultProfiles = normalizeProfileMap(cfg.agents?.defaults?.subagents?.profiles);
  const disciplineProfiles = inspection.profiles;
  const mergedProfiles = { ...disciplineProfiles, ...defaultProfiles };

  const checkBinding = (scopeLabel: string, agentId: string, profileId: string) => {
    const resolved = mergedProfiles[profileId];
    if (!resolved) {
      warnings.push(
        `- ${scopeLabel} profileBindings.${agentId} -> "${profileId}" does not exist in subagent profiles or knowledge disciplines`,
      );
      return;
    }
    if (!resolved.selectedCollections || resolved.selectedCollections.length === 0) {
      warnings.push(
        `- ${scopeLabel} profileBindings.${agentId} -> "${profileId}" resolves to a profile without selectedCollections`,
      );
    }
    if (resolved.invalidRuntimeAttachmentPolicy) {
      warnings.push(
        `- ${scopeLabel} profileBindings.${agentId} -> "${profileId}" resolves to invalid runtimeAttachmentPolicy "${resolved.invalidRuntimeAttachmentPolicy}"`,
      );
    }
  };

  for (const [agentId, profileId] of Object.entries(
    normalizeProfileBindingsMap(cfg.agents?.defaults?.subagents?.profileBindings),
  )) {
    checkBinding("agents.defaults.subagents", agentId, profileId);
  }

  for (const entry of cfg.agents?.list ?? []) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const scopeAgentId = normalizeAgentId((entry as { id?: unknown }).id);
    if (!scopeAgentId) {
      continue;
    }
    const scopeLabel = `agents.list[${scopeAgentId}].subagents`;
    const localProfiles = normalizeProfileMap(
      (entry as { subagents?: { profiles?: unknown } }).subagents?.profiles,
    );
    const scopedProfiles = { ...mergedProfiles, ...localProfiles };
    for (const [targetAgentId, profileId] of Object.entries(
      normalizeProfileBindingsMap(
        (entry as { subagents?: { profileBindings?: unknown } }).subagents?.profileBindings,
      ),
    )) {
      const resolved = scopedProfiles[profileId];
      if (!resolved) {
        warnings.push(
          `- ${scopeLabel} profileBindings.${targetAgentId} -> "${profileId}" does not exist in subagent profiles or knowledge disciplines`,
        );
        continue;
      }
      if (!resolved.selectedCollections || resolved.selectedCollections.length === 0) {
        warnings.push(
          `- ${scopeLabel} profileBindings.${targetAgentId} -> "${profileId}" resolves to a profile without selectedCollections`,
        );
      }
      if (resolved.invalidRuntimeAttachmentPolicy) {
        warnings.push(
          `- ${scopeLabel} profileBindings.${targetAgentId} -> "${profileId}" resolves to invalid runtimeAttachmentPolicy "${resolved.invalidRuntimeAttachmentPolicy}"`,
        );
      }
    }
  }

  return warnings;
}

export function noteKnowledgeWarnings(cfg: EdwinPAIConfig) {
  const warnings = collectKnowledgeDoctorWarnings(cfg);
  if (warnings.length > 0) {
    note(warnings.join("\n"), "Knowledge");
  }
}
