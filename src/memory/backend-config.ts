import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EdwinPAIConfig } from "../config/config.js";
import type { SessionSendPolicyConfig } from "../config/types.base.js";
import type {
  MemoryBackend,
  MemoryCitationsMode,
  MemoryQmdConfig,
  MemoryQmdIndexPath,
  MemoryQmdConsolidateConfig,
} from "../config/types.memory.js";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { parseDurationMs } from "../cli/parse-duration.js";
import { resolveUserPath } from "../utils.js";
import { splitShellArgs } from "../utils/shell-argv.js";

export type ResolvedMemoryBackendConfig = {
  backend: MemoryBackend;
  citations: MemoryCitationsMode;
  qmd?: ResolvedQmdConfig;
};

export type ResolvedQmdCollection = {
  name: string;
  path: string;
  pattern: string;
  kind: "memory" | "custom" | "sessions";
};

export type ResolvedQmdUpdateConfig = {
  intervalMs: number;
  debounceMs: number;
  onBoot: boolean;
  embedIntervalMs: number;
  embedMinIntervalMs: number;
  embedMaxIntervalMs: number;
  embedTokenThreshold: number;
};

export type ResolvedQmdConsolidateConfig = {
  intervalMs: number;
  debounceMs: number;
  onBoot: boolean;
};

export type ResolvedQmdLimitsConfig = {
  maxResults: number;
  maxSnippetChars: number;
  maxInjectedChars: number;
  timeoutMs: number;
};

export type ResolvedQmdSessionConfig = {
  enabled: boolean;
  exportDir?: string;
  retentionDays?: number;
};

export type ResolvedQmdConfig = {
  command: string;
  collections: ResolvedQmdCollection[];
  sessions: ResolvedQmdSessionConfig;
  update: ResolvedQmdUpdateConfig;
  consolidate: ResolvedQmdConsolidateConfig;
  limits: ResolvedQmdLimitsConfig;
  includeDefaultMemory: boolean;
  embeddingApiKey?: string;
  scope?: SessionSendPolicyConfig;
};

const DEFAULT_BACKEND: MemoryBackend = "qmd";
const DEFAULT_CITATIONS: MemoryCitationsMode = "auto";
const DEFAULT_QMD_INTERVAL = "5m";
const DEFAULT_QMD_DEBOUNCE_MS = 15_000;
const DEFAULT_QMD_TIMEOUT_MS = 4_000;
const DEFAULT_QMD_EMBED_INTERVAL = "60m";
const DEFAULT_QMD_EMBED_MIN_INTERVAL_MS = 2 * 60_000; // 2 minutes
const DEFAULT_QMD_EMBED_MAX_INTERVAL_MS = 30 * 60_000; // 30 minutes
const DEFAULT_QMD_EMBED_TOKEN_THRESHOLD = 5_000;
const DEFAULT_QMD_CONSOLIDATE_INTERVAL = "0"; // disabled by default
const DEFAULT_QMD_LIMITS: ResolvedQmdLimitsConfig = {
  maxResults: 6,
  maxSnippetChars: 700,
  maxInjectedChars: 4_000,
  timeoutMs: DEFAULT_QMD_TIMEOUT_MS,
};
const DEFAULT_QMD_SCOPE: SessionSendPolicyConfig = {
  default: "deny",
  rules: [
    {
      action: "allow",
      match: { chatType: "direct" },
    },
  ],
};

function sanitizeName(input: string): string {
  const lower = input.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const trimmed = lower.replace(/^-+|-+$/g, "");
  return trimmed || "collection";
}

function ensureUniqueName(base: string, existing: Set<string>): string {
  let name = sanitizeName(base);
  if (!existing.has(name)) {
    existing.add(name);
    return name;
  }
  let suffix = 2;
  while (existing.has(`${name}-${suffix}`)) {
    suffix += 1;
  }
  const unique = `${name}-${suffix}`;
  existing.add(unique);
  return unique;
}

function resolvePath(raw: string, workspaceDir: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("path required");
  }
  if (trimmed.startsWith("~") || path.isAbsolute(trimmed)) {
    return path.normalize(resolveUserPath(trimmed));
  }
  return path.normalize(path.resolve(workspaceDir, trimmed));
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveExecutablePath(
  binary: string,
  opts?: { pathEnv?: string; homeDir?: string },
): string {
  if (!binary || binary.includes(path.sep)) {
    return binary;
  }

  const homeDir = opts?.homeDir ?? os.homedir();
  const searchPath = opts?.pathEnv ?? process.env.PATH ?? "";
  const pathEntries = searchPath
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const fallbackDirs = [
    path.join(homeDir, ".local", "bin"),
    path.join(homeDir, ".local", "share", "pnpm"),
    path.join(homeDir, ".bun", "bin"),
    path.join(homeDir, ".yarn", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
  const candidates = [...new Set([...pathEntries, ...fallbackDirs])];
  for (const dir of candidates) {
    const candidate = path.join(dir, binary);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return binary;
}

export function resolveQmdCommand(
  rawCommand: string,
  opts?: { pathEnv?: string; homeDir?: string },
): string {
  const parsedCommand = splitShellArgs(rawCommand);
  const command = parsedCommand?.[0] || rawCommand.split(/\s+/)[0] || "qmd";
  return resolveExecutablePath(command, opts);
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function resolveQmdEmbeddingApiKey(cfg: EdwinPAIConfig): string | undefined {
  const shadContextConfig = cfg.plugins?.entries?.["shad-context"]?.config;
  const shadContextEmbeddingApiKey =
    shadContextConfig && typeof shadContextConfig.embeddingApiKey === "string"
      ? shadContextConfig.embeddingApiKey
      : undefined;
  const envOpenAiApiKey =
    typeof cfg.env?.OPENAI_API_KEY === "string" ? cfg.env.OPENAI_API_KEY : undefined;
  return firstNonEmptyString(
    cfg.memory?.qmd?.embeddingApiKey,
    shadContextEmbeddingApiKey,
    cfg.env?.vars?.OPENAI_API_KEY,
    envOpenAiApiKey,
    process.env.OPENAI_API_KEY,
  );
}

function resolveIntervalMs(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) {
    return parseDurationMs(DEFAULT_QMD_INTERVAL, { defaultUnit: "m" });
  }
  try {
    return parseDurationMs(value, { defaultUnit: "m" });
  } catch {
    return parseDurationMs(DEFAULT_QMD_INTERVAL, { defaultUnit: "m" });
  }
}

function resolveEmbedIntervalMs(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) {
    return parseDurationMs(DEFAULT_QMD_EMBED_INTERVAL, { defaultUnit: "m" });
  }
  try {
    return parseDurationMs(value, { defaultUnit: "m" });
  } catch {
    return parseDurationMs(DEFAULT_QMD_EMBED_INTERVAL, { defaultUnit: "m" });
  }
}

function resolveConsolidateConfig(
  raw: MemoryQmdConsolidateConfig | undefined,
): ResolvedQmdConsolidateConfig {
  const value = raw?.interval?.trim();
  let intervalMs = 0;
  if (value) {
    try {
      intervalMs = parseDurationMs(value, { defaultUnit: "m" });
    } catch {
      intervalMs = parseDurationMs(DEFAULT_QMD_CONSOLIDATE_INTERVAL, { defaultUnit: "m" });
    }
  }
  return {
    intervalMs,
    debounceMs: resolveDebounceMs(raw?.debounceMs),
    onBoot: raw?.onBoot === true,
  };
}

function resolveDebounceMs(raw: number | undefined): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw);
  }
  return DEFAULT_QMD_DEBOUNCE_MS;
}

function resolveLimits(raw?: MemoryQmdConfig["limits"]): ResolvedQmdLimitsConfig {
  const parsed: ResolvedQmdLimitsConfig = { ...DEFAULT_QMD_LIMITS };
  if (raw?.maxResults && raw.maxResults > 0) {
    parsed.maxResults = Math.floor(raw.maxResults);
  }
  if (raw?.maxSnippetChars && raw.maxSnippetChars > 0) {
    parsed.maxSnippetChars = Math.floor(raw.maxSnippetChars);
  }
  if (raw?.maxInjectedChars && raw.maxInjectedChars > 0) {
    parsed.maxInjectedChars = Math.floor(raw.maxInjectedChars);
  }
  if (raw?.timeoutMs && raw.timeoutMs > 0) {
    parsed.timeoutMs = Math.floor(raw.timeoutMs);
  }
  return parsed;
}

function resolveSessionConfig(
  cfg: MemoryQmdConfig["sessions"],
  workspaceDir: string,
): ResolvedQmdSessionConfig {
  const enabled = Boolean(cfg?.enabled);
  const exportDirRaw = cfg?.exportDir?.trim();
  const exportDir = exportDirRaw ? resolvePath(exportDirRaw, workspaceDir) : undefined;
  const retentionDays =
    cfg?.retentionDays && cfg.retentionDays > 0 ? Math.floor(cfg.retentionDays) : undefined;
  return {
    enabled,
    exportDir,
    retentionDays,
  };
}

function resolveCustomPaths(
  rawPaths: MemoryQmdIndexPath[] | undefined,
  workspaceDir: string,
  existing: Set<string>,
): ResolvedQmdCollection[] {
  if (!rawPaths?.length) {
    return [];
  }
  const collections: ResolvedQmdCollection[] = [];
  rawPaths.forEach((entry, index) => {
    const trimmedPath = entry?.path?.trim();
    if (!trimmedPath) {
      return;
    }
    let resolved: string;
    try {
      resolved = resolvePath(trimmedPath, workspaceDir);
    } catch {
      return;
    }
    const pattern = entry.pattern?.trim() || "**/*.md";
    const baseName = entry.name?.trim() || `custom-${index + 1}`;
    const name = ensureUniqueName(baseName, existing);
    collections.push({
      name,
      path: resolved,
      pattern,
      kind: "custom",
    });
  });
  return collections;
}

function resolveDefaultCollections(
  include: boolean,
  workspaceDir: string,
  existing: Set<string>,
): ResolvedQmdCollection[] {
  if (!include) {
    return [];
  }
  const entries: Array<{ path: string; pattern: string; base: string }> = [
    { path: workspaceDir, pattern: "MEMORY.md", base: "memory-root" },
    { path: workspaceDir, pattern: "memory.md", base: "memory-alt" },
    { path: path.join(workspaceDir, "memory"), pattern: "**/*.md", base: "memory-dir" },
  ];
  return entries.map((entry) => ({
    name: ensureUniqueName(entry.base, existing),
    path: entry.path,
    pattern: entry.pattern,
    kind: "memory",
  }));
}

export function resolveMemoryCollections(params: {
  cfg: EdwinPAIConfig;
  agentId: string;
}): ResolvedQmdCollection[] {
  const workspaceDir = resolveAgentWorkspaceDir(params.cfg, params.agentId);
  const qmdCfg = params.cfg.memory?.qmd;
  const includeDefaultMemory = qmdCfg?.includeDefaultMemory !== false;
  const nameSet = new Set<string>();
  return [
    ...resolveDefaultCollections(includeDefaultMemory, workspaceDir, nameSet),
    ...resolveCustomPaths(qmdCfg?.paths, workspaceDir, nameSet),
  ];
}

export function resolveMemoryBackendConfig(params: {
  cfg: EdwinPAIConfig;
  agentId: string;
}): ResolvedMemoryBackendConfig {
  const backend = params.cfg.memory?.backend ?? DEFAULT_BACKEND;
  const citations = params.cfg.memory?.citations ?? DEFAULT_CITATIONS;
  if (backend !== "qmd") {
    return { backend: "builtin", citations };
  }

  const workspaceDir = resolveAgentWorkspaceDir(params.cfg, params.agentId);
  const qmdCfg = params.cfg.memory?.qmd;
  const includeDefaultMemory = qmdCfg?.includeDefaultMemory !== false;
  const collections = resolveMemoryCollections(params);

  const rawCommand = qmdCfg?.command?.trim() || "qmd";
  const command = resolveQmdCommand(rawCommand);
  const resolved: ResolvedQmdConfig = {
    command,
    collections,
    includeDefaultMemory,
    embeddingApiKey: resolveQmdEmbeddingApiKey(params.cfg),
    sessions: resolveSessionConfig(qmdCfg?.sessions, workspaceDir),
    update: {
      intervalMs: resolveIntervalMs(qmdCfg?.update?.interval),
      debounceMs: resolveDebounceMs(qmdCfg?.update?.debounceMs),
      onBoot: qmdCfg?.update?.onBoot !== false,
      embedIntervalMs: resolveEmbedIntervalMs(qmdCfg?.update?.embedInterval),
      embedMinIntervalMs: qmdCfg?.update?.embedMinIntervalMs ?? DEFAULT_QMD_EMBED_MIN_INTERVAL_MS,
      embedMaxIntervalMs: qmdCfg?.update?.embedMaxIntervalMs ?? DEFAULT_QMD_EMBED_MAX_INTERVAL_MS,
      embedTokenThreshold: qmdCfg?.update?.embedTokenThreshold ?? DEFAULT_QMD_EMBED_TOKEN_THRESHOLD,
    },
    consolidate: resolveConsolidateConfig(qmdCfg?.consolidate),
    limits: resolveLimits(qmdCfg?.limits),
    scope: qmdCfg?.scope ?? DEFAULT_QMD_SCOPE,
  };

  return {
    backend: "qmd",
    citations,
    qmd: resolved,
  };
}
