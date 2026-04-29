import path from "node:path";
import type { ResolvedQmdCollection } from "./backend-config.js";
import { isSubagentSessionKey } from "../routing/session-key.js";

export type MemoryActorType = "main" | "subagent" | "other";

export type MemoryRuntimeAttachmentPolicy = "mounted-only" | "attach-on-demand";

export type MemoryCapabilityTier = "search-and-read" | "search-only";

export type MemoryAccessScope = {
  agentId: string;
  actorType: MemoryActorType;
  sessionKey?: string;
  allowedCollections?: string[];
  runtimeAttachmentPolicy?: MemoryRuntimeAttachmentPolicy;
};

export function resolveMemoryActorType(sessionKey?: string): MemoryActorType {
  if (!sessionKey) {
    return "other";
  }
  return isSubagentSessionKey(sessionKey) ? "subagent" : "main";
}

export function normalizeAllowedCollections(values?: string[]): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }
  const normalized = Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
        .filter(Boolean),
    ),
  );
  return normalized.length > 0 ? normalized : undefined;
}

export function isCollectionAllowed(collection: string, allowedCollections?: string[]): boolean {
  if (!allowedCollections || allowedCollections.length === 0) {
    return true;
  }
  return allowedCollections.includes(collection.trim().toLowerCase());
}

export function normalizeRuntimeAttachmentPolicy(
  value?: string,
): MemoryRuntimeAttachmentPolicy | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "mounted-only" || normalized === "attach-on-demand") {
    return normalized;
  }
  return undefined;
}

export function resolveMemoryCapabilityTier(
  accessScope?: Pick<MemoryAccessScope, "actorType" | "runtimeAttachmentPolicy">,
): MemoryCapabilityTier {
  if (accessScope?.actorType === "subagent") {
    const policy = normalizeRuntimeAttachmentPolicy(accessScope.runtimeAttachmentPolicy);
    if (policy === "attach-on-demand") {
      return "search-only";
    }
  }
  return "search-and-read";
}

export function isDirectMemoryReadAllowed(accessScope?: MemoryAccessScope): boolean {
  return resolveMemoryCapabilityTier(accessScope) === "search-and-read";
}

export function resolveCollectionsForRelPath(params: {
  relPath: string;
  workspaceDir: string;
  collections?: ResolvedQmdCollection[];
}): string[] | undefined {
  const relPath = params.relPath?.trim();
  if (!relPath) {
    return undefined;
  }

  const explicitQmdCollection = extractQmdCollectionFromRelPath(relPath);
  if (explicitQmdCollection) {
    return [explicitQmdCollection];
  }

  const collections = params.collections ?? [];
  if (collections.length === 0) {
    return undefined;
  }

  const absPath = path.isAbsolute(relPath)
    ? path.resolve(relPath)
    : path.resolve(params.workspaceDir, relPath);

  const matches = collections
    .filter((collection) => matchesCollection(absPath, collection))
    .map((collection) => collection.name.trim().toLowerCase())
    .filter(Boolean);

  return matches.length > 0 ? Array.from(new Set(matches)) : undefined;
}

export function isMemoryPathAllowed(params: {
  relPath: string;
  workspaceDir: string;
  collections?: ResolvedQmdCollection[];
  allowedCollections?: string[];
}): boolean {
  const allowedCollections = normalizeAllowedCollections(params.allowedCollections);
  if (!allowedCollections || allowedCollections.length === 0) {
    return true;
  }

  const matchedCollections = resolveCollectionsForRelPath(params);
  if (!matchedCollections || matchedCollections.length === 0) {
    return false;
  }

  return matchedCollections.some((collection) =>
    isCollectionAllowed(collection, allowedCollections),
  );
}

function extractQmdCollectionFromRelPath(relPath: string): string | undefined {
  if (!relPath.startsWith("qmd/")) {
    return undefined;
  }
  const [, collection] = relPath.split("/");
  return collection?.trim().toLowerCase() || undefined;
}

function matchesCollection(absPath: string, collection: ResolvedQmdCollection): boolean {
  const root = path.resolve(collection.path);
  if (!isWithinRoot(root, absPath)) {
    return false;
  }
  const relativeToRoot = path.relative(root, absPath).replace(/\\/g, "/");
  const globTarget = relativeToRoot || path.basename(absPath);
  return path.matchesGlob(globTarget, collection.pattern);
}

function isWithinRoot(root: string, candidate: string): boolean {
  if (candidate === root) {
    return true;
  }
  const normalizedRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  const normalizedCandidate = candidate.endsWith(path.sep) ? candidate : `${candidate}${path.sep}`;
  return normalizedCandidate.startsWith(normalizedRoot);
}
