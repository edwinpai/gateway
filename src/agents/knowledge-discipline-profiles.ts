import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import {
  normalizeRuntimeAttachmentPolicy,
  type MemoryRuntimeAttachmentPolicy,
} from "../memory/public-policy.js";

export type KnowledgeDisciplineProfileRecord = {
  selectedCollections?: string[];
  runtimeAttachmentPolicy?: MemoryRuntimeAttachmentPolicy;
  invalidRuntimeAttachmentPolicy?: string;
};

export type KnowledgeDisciplineProfilesInspection = {
  path: string;
  profiles: Record<string, KnowledgeDisciplineProfileRecord>;
  issues: string[];
};

type DisciplinesFile = {
  disciplines?: unknown;
};

type DisciplineRecord = {
  id?: unknown;
  selectedCollections?: unknown;
  runtimeAttachmentPolicy?: unknown;
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
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
        .filter(Boolean),
    ),
  );
  return normalized.length > 0 ? normalized : undefined;
}

export function resolveKnowledgeDisciplinesPath(
  stateDir: string = resolveStateDir(process.env),
): string {
  return path.join(stateDir, "knowledge", "disciplines.json");
}

export function inspectKnowledgeDisciplineProfiles(
  stateDir: string = resolveStateDir(process.env),
): KnowledgeDisciplineProfilesInspection {
  const disciplinesPath = resolveKnowledgeDisciplinesPath(stateDir);
  const out: KnowledgeDisciplineProfilesInspection = {
    path: disciplinesPath,
    profiles: {},
    issues: [],
  };
  try {
    if (!fs.existsSync(disciplinesPath)) {
      return out;
    }
    const raw = fs.readFileSync(disciplinesPath, "utf8");
    const parsed = JSON.parse(raw) as DisciplinesFile;
    if (!Array.isArray(parsed.disciplines)) {
      out.issues.push('knowledge/disciplines.json is missing a top-level "disciplines" array');
      return out;
    }
    for (const [index, entry] of parsed.disciplines.entries()) {
      if (!entry || typeof entry !== "object") {
        out.issues.push(`knowledge/disciplines.json entry #${index + 1} is not an object`);
        continue;
      }
      const record = entry as DisciplineRecord;
      const id = normalizeProfileId(record.id);
      if (!id) {
        out.issues.push(
          `knowledge/disciplines.json entry #${index + 1} is missing a valid string id`,
        );
        continue;
      }
      const runtimeAttachmentPolicyRaw =
        typeof record.runtimeAttachmentPolicy === "string" && record.runtimeAttachmentPolicy.trim()
          ? record.runtimeAttachmentPolicy.trim()
          : undefined;
      const runtimeAttachmentPolicy = normalizeRuntimeAttachmentPolicy(runtimeAttachmentPolicyRaw);
      const selectedCollections = normalizeCollections(record.selectedCollections);
      out.profiles[id] = {
        selectedCollections,
        runtimeAttachmentPolicy,
        invalidRuntimeAttachmentPolicy:
          runtimeAttachmentPolicyRaw && !runtimeAttachmentPolicy
            ? runtimeAttachmentPolicyRaw
            : undefined,
      };
      if (!selectedCollections || selectedCollections.length === 0) {
        out.issues.push(
          `knowledge discipline profile "${id}" must define selectedCollections to be usable for sessions_spawn`,
        );
      }
      if (runtimeAttachmentPolicyRaw && !runtimeAttachmentPolicy) {
        out.issues.push(
          `knowledge discipline profile "${id}" has invalid runtimeAttachmentPolicy "${runtimeAttachmentPolicyRaw}"`,
        );
      }
    }
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    out.issues.push(`knowledge/disciplines.json could not be read: ${message}`);
    return out;
  }
}

export function loadKnowledgeDisciplineProfiles(
  stateDir: string = resolveStateDir(process.env),
): Record<string, KnowledgeDisciplineProfileRecord> {
  return inspectKnowledgeDisciplineProfiles(stateDir).profiles;
}

export function formatKnowledgeDisciplineDoctorHint(
  stateDir: string = resolveStateDir(process.env),
): string {
  const disciplinesPath = resolveKnowledgeDisciplinesPath(stateDir);
  return `Check ${disciplinesPath} and run "edwinpai doctor".`;
}
