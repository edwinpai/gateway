import path from "node:path";
import { resolveCanonicalConfigPath } from "../config/paths.js";
import { VERSION } from "../version.js";
import {
  GATEWAY_SERVICE_KIND,
  GATEWAY_SERVICE_MARKER,
  resolveGatewayLaunchAgentLabel,
  resolveGatewaySystemdServiceName,
  NODE_SERVICE_KIND,
  NODE_SERVICE_MARKER,
  NODE_WINDOWS_TASK_SCRIPT_NAME,
  resolveNodeLaunchAgentLabel,
  resolveNodeSystemdServiceName,
  resolveNodeWindowsTaskName,
} from "./constants.js";
import { resolveGatewayStateDir } from "./paths.js";

export type MinimalServicePathOptions = {
  platform?: NodeJS.Platform;
  extraDirs?: string[];
  home?: string;
  env?: Record<string, string | undefined>;
};

type BuildServicePathOptions = MinimalServicePathOptions & {
  env?: Record<string, string | undefined>;
};

function resolveSystemPathDirs(platform: NodeJS.Platform): string[] {
  if (platform === "darwin") {
    return ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  }
  if (platform === "linux") {
    return ["/usr/local/bin", "/usr/bin", "/bin"];
  }
  return [];
}

/**
 * Resolve common user bin directories for Unix-like platforms.
 * These are paths where npm global installs, Bun, pnpm, Shad, Cargo,
 * and node version managers commonly place binaries.
 */
export function resolveUnixUserBinDirs(
  home: string | undefined,
  env: Record<string, string | undefined> | undefined,
  platform: NodeJS.Platform,
): string[] {
  if (!home || platform === "win32") {
    return [];
  }

  const dirs: string[] = [];

  const add = (dir: string | undefined) => {
    if (dir) {
      dirs.push(dir);
    }
  };
  const appendSubdir = (base: string | undefined, subdir: string) => {
    if (!base) {
      return undefined;
    }
    return base.endsWith(`/${subdir}`) ? base : path.posix.join(base, subdir);
  };

  // Env-configured bin roots (override defaults when present).
  add(env?.PNPM_HOME);
  add(appendSubdir(env?.NPM_CONFIG_PREFIX, "bin"));
  add(appendSubdir(env?.BUN_INSTALL, "bin"));
  add(appendSubdir(env?.VOLTA_HOME, "bin"));
  add(appendSubdir(env?.ASDF_DATA_DIR, "shims"));
  add(appendSubdir(env?.NVM_DIR, "current/bin"));
  add(appendSubdir(env?.FNM_DIR, "current/bin"));
  add(appendSubdir(env?.CARGO_HOME, "bin"));

  // Common cross-platform user bin directories.
  dirs.push(`${home}/.local/bin`);
  dirs.push(`${home}/bin`);
  dirs.push(`${home}/.bun/bin`);
  dirs.push(`${home}/.cargo/bin`);
  dirs.push(`${home}/.volta/bin`);
  dirs.push(`${home}/.asdf/shims`);
  dirs.push(`${home}/.nvm/current/bin`);
  dirs.push(`${home}/.fnm/current/bin`);
  dirs.push(`${home}/.shad/bin`);

  if (platform === "linux") {
    dirs.push(`${home}/.npm-global/bin`);
    dirs.push(`${home}/.local/share/pnpm`);
  }

  if (platform === "darwin") {
    dirs.push(`${home}/Library/pnpm`);
  }

  return dirs;
}

export function getMinimalServicePathParts(options: MinimalServicePathOptions = {}): string[] {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return [];
  }

  const parts: string[] = [];
  const extraDirs = options.extraDirs ?? [];
  const systemDirs = resolveSystemPathDirs(platform);
  const unixUserDirs = resolveUnixUserBinDirs(options.home, options.env, platform);

  const add = (dir: string) => {
    if (!dir) {
      return;
    }
    if (!parts.includes(dir)) {
      parts.push(dir);
    }
  };

  for (const dir of extraDirs) {
    add(dir);
  }
  // User dirs first so user-installed binaries take precedence.
  for (const dir of unixUserDirs) {
    add(dir);
  }
  for (const dir of systemDirs) {
    add(dir);
  }

  return parts;
}

export function getMinimalServicePathPartsFromEnv(options: BuildServicePathOptions = {}): string[] {
  const env = options.env ?? process.env;
  return getMinimalServicePathParts({
    ...options,
    home: options.home ?? env.HOME,
    env,
  });
}

export function buildMinimalServicePath(options: BuildServicePathOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return env.PATH ?? "";
  }

  return getMinimalServicePathPartsFromEnv({ ...options, env }).join(path.posix.delimiter);
}

export function buildServiceEnvironment(params: {
  env: Record<string, string | undefined>;
  port: number;
  token?: string;
  launchdLabel?: string;
}): Record<string, string | undefined> {
  const { env, port, token, launchdLabel } = params;
  const profile = env.EDWINPAI_PROFILE;
  const resolvedLaunchdLabel =
    launchdLabel ||
    (process.platform === "darwin" ? resolveGatewayLaunchAgentLabel(profile) : undefined);
  const systemdUnit = `${resolveGatewaySystemdServiceName(profile)}.service`;
  const stateDir = env.EDWINPAI_STATE_DIR?.trim() || resolveGatewayStateDir(env);
  const configPath =
    env.EDWINPAI_CONFIG_PATH?.trim() ||
    resolveCanonicalConfigPath({
      ...env,
      EDWINPAI_STATE_DIR: stateDir,
    } as NodeJS.ProcessEnv);
  const shadCollectionPath = env.SHAD_COLLECTION_PATH?.trim() || path.join(stateDir, "workspace");
  return {
    HOME: env.HOME,
    PATH: buildMinimalServicePath({ env }),
    SHAD_COLLECTION_PATH: shadCollectionPath,
    EDWINPAI_PROFILE: profile,
    EDWINPAI_STATE_DIR: stateDir,
    EDWINPAI_CONFIG_PATH: configPath,
    EDWINPAI_GATEWAY_PORT: String(port),
    EDWINPAI_GATEWAY_TOKEN: token,
    EDWINPAI_LAUNCHD_LABEL: resolvedLaunchdLabel,
    EDWINPAI_SYSTEMD_UNIT: systemdUnit,
    EDWINPAI_SERVICE_MARKER: GATEWAY_SERVICE_MARKER,
    EDWINPAI_SERVICE_KIND: GATEWAY_SERVICE_KIND,
    EDWINPAI_SERVICE_VERSION: VERSION,
  };
}

export function buildNodeServiceEnvironment(params: {
  env: Record<string, string | undefined>;
}): Record<string, string | undefined> {
  const { env } = params;
  const stateDir = env.EDWINPAI_STATE_DIR?.trim() || resolveGatewayStateDir(env);
  const configPath =
    env.EDWINPAI_CONFIG_PATH?.trim() ||
    resolveCanonicalConfigPath({
      ...env,
      EDWINPAI_STATE_DIR: stateDir,
    } as NodeJS.ProcessEnv);
  const shadCollectionPath = env.SHAD_COLLECTION_PATH?.trim() || path.join(stateDir, "workspace");
  return {
    HOME: env.HOME,
    PATH: buildMinimalServicePath({ env }),
    SHAD_COLLECTION_PATH: shadCollectionPath,
    EDWINPAI_STATE_DIR: stateDir,
    EDWINPAI_CONFIG_PATH: configPath,
    EDWINPAI_LAUNCHD_LABEL: resolveNodeLaunchAgentLabel(),
    EDWINPAI_SYSTEMD_UNIT: resolveNodeSystemdServiceName(),
    EDWINPAI_WINDOWS_TASK_NAME: resolveNodeWindowsTaskName(),
    EDWINPAI_TASK_SCRIPT_NAME: NODE_WINDOWS_TASK_SCRIPT_NAME,
    EDWINPAI_LOG_PREFIX: "node",
    EDWINPAI_SERVICE_MARKER: NODE_SERVICE_MARKER,
    EDWINPAI_SERVICE_KIND: NODE_SERVICE_KIND,
    EDWINPAI_SERVICE_VERSION: VERSION,
  };
}
