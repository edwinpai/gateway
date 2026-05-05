import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import type { EdwinPAIConfig } from "../config/config.js";
import { resolveConfigDir } from "../utils.js";
import { resolveLaunchAgentPlistPath } from "./launchd.js";
import {
  isSystemNodePath,
  isVersionManagedNodePath,
  resolveSystemNodePath,
} from "./runtime-paths.js";
import { getMinimalServicePathPartsFromEnv } from "./service-env.js";
import { resolveSystemdUserUnitPath } from "./systemd.js";

export type GatewayServiceCommand = {
  programArguments: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
  sourcePath?: string;
} | null;

export type ServiceConfigIssue = {
  code: string;
  message: string;
  detail?: string;
  level?: "recommended" | "aggressive";
};

export type ServiceConfigAudit = {
  ok: boolean;
  issues: ServiceConfigIssue[];
};

export const SERVICE_AUDIT_CODES = {
  gatewayCommandMissing: "gateway-command-missing",
  gatewayEmbeddingServiceSafeMissing: "gateway-embedding-service-safe-missing",
  gatewayEntrypointMismatch: "gateway-entrypoint-mismatch",
  gatewayPathMissing: "gateway-path-missing",
  gatewayPathMissingDirs: "gateway-path-missing-dirs",
  gatewayPathNonMinimal: "gateway-path-nonminimal",
  gatewayWrapperSourceCheckout: "gateway-wrapper-source-checkout",
  gatewayRuntimeBun: "gateway-runtime-bun",
  gatewayRuntimeNodeVersionManager: "gateway-runtime-node-version-manager",
  gatewayRuntimeNodeSystemMissing: "gateway-runtime-node-system-missing",
  launchdKeepAlive: "launchd-keep-alive",
  launchdRunAtLoad: "launchd-run-at-load",
  systemdAfterNetworkOnline: "systemd-after-network-online",
  systemdRestartSec: "systemd-restart-sec",
  systemdWantsNetworkOnline: "systemd-wants-network-online",
} as const;

export function needsNodeRuntimeMigration(issues: ServiceConfigIssue[]): boolean {
  return issues.some(
    (issue) =>
      issue.code === SERVICE_AUDIT_CODES.gatewayRuntimeBun ||
      issue.code === SERVICE_AUDIT_CODES.gatewayRuntimeNodeVersionManager,
  );
}

function hasGatewaySubcommand(programArguments?: string[]): boolean {
  return Boolean(programArguments?.some((arg) => arg === "gateway"));
}

function parseSystemdUnit(content: string): {
  after: Set<string>;
  wants: Set<string>;
  restartSec?: string;
} {
  const after = new Set<string>();
  const wants = new Set<string>();
  let restartSec: string | undefined;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith("#") || line.startsWith(";")) {
      continue;
    }
    if (line.startsWith("[")) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!value) {
      continue;
    }
    if (key === "After") {
      for (const entry of value.split(/\s+/)) {
        if (entry) {
          after.add(entry);
        }
      }
    } else if (key === "Wants") {
      for (const entry of value.split(/\s+/)) {
        if (entry) {
          wants.add(entry);
        }
      }
    } else if (key === "RestartSec") {
      restartSec = value;
    }
  }

  return { after, wants, restartSec };
}

function isRestartSecPreferred(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return false;
  }
  return Math.abs(parsed - 5) < 0.01;
}

async function auditSystemdUnit(
  env: Record<string, string | undefined>,
  issues: ServiceConfigIssue[],
) {
  const unitPath = resolveSystemdUserUnitPath(env);
  let content = "";
  try {
    content = await fs.readFile(unitPath, "utf8");
  } catch {
    return;
  }

  const parsed = parseSystemdUnit(content);
  if (!parsed.after.has("network-online.target")) {
    issues.push({
      code: SERVICE_AUDIT_CODES.systemdAfterNetworkOnline,
      message: "Missing systemd After=network-online.target",
      detail: unitPath,
      level: "recommended",
    });
  }
  if (!parsed.wants.has("network-online.target")) {
    issues.push({
      code: SERVICE_AUDIT_CODES.systemdWantsNetworkOnline,
      message: "Missing systemd Wants=network-online.target",
      detail: unitPath,
      level: "recommended",
    });
  }
  if (!isRestartSecPreferred(parsed.restartSec)) {
    issues.push({
      code: SERVICE_AUDIT_CODES.systemdRestartSec,
      message: "RestartSec does not match the recommended 5s",
      detail: unitPath,
      level: "recommended",
    });
  }
}

async function auditLaunchdPlist(
  env: Record<string, string | undefined>,
  issues: ServiceConfigIssue[],
) {
  const plistPath = resolveLaunchAgentPlistPath(env);
  let content = "";
  try {
    content = await fs.readFile(plistPath, "utf8");
  } catch {
    return;
  }

  const hasRunAtLoad = /<key>RunAtLoad<\/key>\s*<true\s*\/>/i.test(content);
  const hasKeepAlive = /<key>KeepAlive<\/key>\s*<true\s*\/>/i.test(content);
  if (!hasRunAtLoad) {
    issues.push({
      code: SERVICE_AUDIT_CODES.launchdRunAtLoad,
      message: "LaunchAgent is missing RunAtLoad=true",
      detail: plistPath,
      level: "recommended",
    });
  }
  if (!hasKeepAlive) {
    issues.push({
      code: SERVICE_AUDIT_CODES.launchdKeepAlive,
      message: "LaunchAgent is missing KeepAlive=true",
      detail: plistPath,
      level: "recommended",
    });
  }
}

async function readServiceWrapper(programArguments: string[] | undefined): Promise<string | null> {
  const wrapperPath = programArguments?.[0];
  if (!wrapperPath || !path.isAbsolute(wrapperPath)) {
    return null;
  }
  try {
    const stat = await fs.stat(wrapperPath);
    if (!stat.isFile() || stat.size > 64_000) {
      return null;
    }
    return await fs.readFile(wrapperPath, "utf8");
  } catch {
    return null;
  }
}

function wrapperLaunchesEdwinpaiGateway(content: string): boolean {
  return /edwinpai(?:["']|\s).*\bgateway\b/i.test(content);
}

function wrapperLaunchesSourceCheckout(content: string): boolean {
  return /[/\]dist[/\][^\s"']*index\.(?:js|mjs|cjs)\b/i.test(content);
}

async function auditGatewayCommand(
  programArguments: string[] | undefined,
  issues: ServiceConfigIssue[],
) {
  if (!programArguments || programArguments.length === 0) {
    return;
  }
  if (hasGatewaySubcommand(programArguments)) {
    return;
  }

  const wrapper = await readServiceWrapper(programArguments);
  if (wrapper) {
    if (wrapperLaunchesSourceCheckout(wrapper)) {
      issues.push({
        code: SERVICE_AUDIT_CODES.gatewayWrapperSourceCheckout,
        message:
          "Service wrapper launches a source checkout/dist path instead of the installed edwinpai CLI",
        detail: programArguments[0],
        level: "aggressive",
      });
      return;
    }
    if (wrapperLaunchesEdwinpaiGateway(wrapper)) {
      return;
    }
  }

  issues.push({
    code: SERVICE_AUDIT_CODES.gatewayCommandMissing,
    message: "Service command does not include the gateway subcommand",
    level: "aggressive",
  });
}

function isNodeRuntime(execPath: string): boolean {
  const base = path.basename(execPath).toLowerCase();
  return base === "node" || base === "node.exe";
}

function isBunRuntime(execPath: string): boolean {
  const base = path.basename(execPath).toLowerCase();
  return base === "bun" || base === "bun.exe";
}

function getPathModule(platform: NodeJS.Platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function normalizePathEntry(entry: string, platform: NodeJS.Platform): string {
  const pathModule = getPathModule(platform);
  const normalized = pathModule.normalize(entry).replaceAll("\\", "/");
  if (platform === "win32") {
    return normalized.toLowerCase();
  }
  return normalized;
}

function auditGatewayServicePath(
  command: GatewayServiceCommand,
  issues: ServiceConfigIssue[],
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
) {
  if (platform === "win32") {
    return;
  }
  const servicePath = command?.environment?.PATH;
  if (!servicePath) {
    issues.push({
      code: SERVICE_AUDIT_CODES.gatewayPathMissing,
      message: "Gateway service PATH is not set; the daemon should use a minimal PATH.",
      level: "recommended",
    });
    return;
  }

  const expected = getMinimalServicePathPartsFromEnv({ platform, env });
  const parts = servicePath
    .split(getPathModule(platform).delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const normalizedParts = new Set(parts.map((entry) => normalizePathEntry(entry, platform)));
  const normalizedExpected = new Set(expected.map((entry) => normalizePathEntry(entry, platform)));
  const missing = expected.filter((entry) => {
    const normalized = normalizePathEntry(entry, platform);
    return !normalizedParts.has(normalized);
  });
  if (missing.length > 0) {
    issues.push({
      code: SERVICE_AUDIT_CODES.gatewayPathMissingDirs,
      message: `Gateway service PATH missing required dirs: ${missing.join(", ")}`,
      level: "recommended",
    });
  }

  const nonMinimal = parts.filter((entry) => {
    const normalized = normalizePathEntry(entry, platform);
    if (normalizedExpected.has(normalized)) {
      return false;
    }
    return (
      normalized.includes("/.nvm/") ||
      normalized.includes("/.fnm/") ||
      normalized.includes("/.volta/") ||
      normalized.includes("/.asdf/") ||
      normalized.includes("/.n/") ||
      normalized.includes("/.nodenv/") ||
      normalized.includes("/.nodebrew/") ||
      normalized.includes("/nvs/") ||
      normalized.includes("/.local/share/pnpm/") ||
      normalized.includes("/pnpm/") ||
      normalized.endsWith("/pnpm")
    );
  });
  if (nonMinimal.length > 0) {
    issues.push({
      code: SERVICE_AUDIT_CODES.gatewayPathNonMinimal,
      message:
        "Gateway service PATH includes version managers or package managers; recommend a minimal PATH.",
      detail: nonMinimal.join(", "),
      level: "recommended",
    });
  }
}

async function auditGatewayRuntime(
  env: Record<string, string | undefined>,
  command: GatewayServiceCommand,
  issues: ServiceConfigIssue[],
  platform: NodeJS.Platform,
) {
  const execPath = command?.programArguments?.[0];
  if (!execPath) {
    return;
  }

  if (isBunRuntime(execPath)) {
    issues.push({
      code: SERVICE_AUDIT_CODES.gatewayRuntimeBun,
      message: "Gateway service uses Bun; Bun is incompatible with WhatsApp + Telegram channels.",
      detail: execPath,
      level: "recommended",
    });
    return;
  }

  if (!isNodeRuntime(execPath)) {
    return;
  }

  if (isVersionManagedNodePath(execPath, platform)) {
    issues.push({
      code: SERVICE_AUDIT_CODES.gatewayRuntimeNodeVersionManager,
      message: "Gateway service uses Node from a version manager; it can break after upgrades.",
      detail: execPath,
      level: "recommended",
    });
    if (!isSystemNodePath(execPath, env, platform)) {
      const systemNode = await resolveSystemNodePath(env, platform);
      if (!systemNode) {
        issues.push({
          code: SERVICE_AUDIT_CODES.gatewayRuntimeNodeSystemMissing,
          message:
            "System Node 22+ not found; install it before migrating away from version managers.",
          level: "recommended",
        });
      }
    }
  }
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveEffectiveServiceEnv(params: {
  env: Record<string, string | undefined>;
  command: GatewayServiceCommand;
}): Record<string, string | undefined> {
  return {
    HOME: params.command?.environment?.HOME ?? params.env.HOME,
    EDWINPAI_STATE_DIR:
      params.command?.environment?.EDWINPAI_STATE_DIR ?? params.env.EDWINPAI_STATE_DIR,
    EDWINPAI_CONFIG_PATH:
      params.command?.environment?.EDWINPAI_CONFIG_PATH ?? params.env.EDWINPAI_CONFIG_PATH,
    PATH: params.command?.environment?.PATH ?? params.env.PATH,
    ...(params.command?.environment ?? undefined),
  };
}

function hasConfigManagedEmbeddingKey(cfg: EdwinPAIConfig | undefined): boolean {
  return Boolean(
    hasNonEmptyString(cfg?.memory?.qmd?.embeddingApiKey) ||
    hasNonEmptyString(cfg?.env?.OPENAI_API_KEY) ||
    hasNonEmptyString(cfg?.env?.vars?.OPENAI_API_KEY),
  );
}

async function hasSharedEnvEmbeddingKey(
  env: Record<string, string | undefined>,
): Promise<{ present: boolean; envPath: string }> {
  const envPath = path.join(resolveConfigDir(env as NodeJS.ProcessEnv), ".env");
  try {
    const raw = await fs.readFile(envPath, "utf8");
    const parsed = dotenv.parse(raw);
    return {
      present: hasNonEmptyString(parsed.OPENAI_API_KEY),
      envPath,
    };
  } catch {
    return { present: false, envPath };
  }
}

async function auditGatewayEmbeddingServiceEnv(params: {
  env: Record<string, string | undefined>;
  command: GatewayServiceCommand;
  config?: EdwinPAIConfig;
  issues: ServiceConfigIssue[];
}) {
  const shellKey = params.env.OPENAI_API_KEY?.trim();
  if (!shellKey) {
    return;
  }

  const backend = params.config?.memory?.backend ?? "qmd";
  if (backend !== "qmd") {
    return;
  }

  const serviceEnv = resolveEffectiveServiceEnv(params);
  if (hasNonEmptyString(serviceEnv.OPENAI_API_KEY)) {
    return;
  }
  if (hasConfigManagedEmbeddingKey(params.config)) {
    return;
  }

  const sharedEnv = await hasSharedEnvEmbeddingKey(serviceEnv);
  if (sharedEnv.present) {
    return;
  }

  params.issues.push({
    code: SERVICE_AUDIT_CODES.gatewayEmbeddingServiceSafeMissing,
    message:
      "OPENAI_API_KEY is only visible in the current shell; qmd embeddings may fail under the gateway service.",
    detail: `Save OPENAI_API_KEY to ${sharedEnv.envPath} or set memory.qmd.embeddingApiKey / env.vars.OPENAI_API_KEY in config.`,
    level: "recommended",
  });
}

export async function auditGatewayServiceConfig(params: {
  env: Record<string, string | undefined>;
  command: GatewayServiceCommand;
  config?: EdwinPAIConfig;
  platform?: NodeJS.Platform;
}): Promise<ServiceConfigAudit> {
  const issues: ServiceConfigIssue[] = [];
  const platform = params.platform ?? process.platform;

  await auditGatewayCommand(params.command?.programArguments, issues);
  auditGatewayServicePath(params.command, issues, params.env, platform);
  await auditGatewayRuntime(params.env, params.command, issues, platform);
  await auditGatewayEmbeddingServiceEnv({
    env: params.env,
    command: params.command,
    config: params.config,
    issues,
  });

  if (platform === "linux") {
    await auditSystemdUnit(params.env, issues);
  } else if (platform === "darwin") {
    await auditLaunchdPlist(params.env, issues);
  }

  return { ok: issues.length === 0, issues };
}
