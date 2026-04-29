import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IdentityCore } from "./types.js";

export const NATIVE_PATH_ENV = "EDWINPAI_IDENTITY_CORE_NATIVE_PATH";
const COMPANION_SCOPE = "@edwinpai";
const COMPANION_NAME_PREFIX = "identity-core";

const COMPANION_PACKAGE_SUFFIX_BY_RUNTIME_TRIPLE = {
  "darwin-arm64": "darwin-arm64",
  "darwin-x64": "darwin-x64",
  "linux-arm64": "linux-arm64-gnu",
  "linux-x64": "linux-x64-gnu",
  "win32-x64": "win32-x64-msvc",
} as const satisfies Record<string, string>;

export interface LoadNativeIdentityCoreOptions {
  envPath?: string | undefined;
  bundledPath?: string | undefined;
  stagedPath?: string | undefined;
  companionPath?: string | undefined;
  companionPackageName?: string | undefined;
  platform?: NodeJS.Platform | undefined;
  arch?: string | undefined;
  requireFn?: (path: string) => unknown;
  resolveFn?: (specifier: string) => string;
}

/**
 * Best-effort native artifact resolver for callers that want to prefer a
 * protected native implementation when one is bundled, but safely fall back to
 * JS/TS adapters when it is not available yet.
 *
 * Resolution order is:
 * 1. `EDWINPAI_IDENTITY_CORE_NATIVE_PATH` / `envPath`
 * 2. bundled `native/<triple>/identity-core.node`
 * 3. staged `native-staging/<triple>/identity-core.node`
 * 4. installed runtime-triple companion package entrypoint
 *
 * This helper never throws. It returns `null` for missing files, invalid export
 * shapes, or load failures.
 */
export function loadNativeIdentityCore(
  options: LoadNativeIdentityCoreOptions = {},
): IdentityCore | null {
  const candidate = resolveCandidatePath(options);
  if (!candidate) {
    return null;
  }

  if (!verifyArtifactIntegrity(candidate)) {
    return null;
  }

  const requireFn = options.requireFn ?? defaultRequire;
  let imported: unknown;
  try {
    imported = requireFn(candidate);
  } catch {
    return null;
  }

  return extractIdentityCore(imported);
}

export function getIdentityCoreNativeRuntimeTriple(
  platform: NodeJS.Platform,
  arch: string,
): string | null {
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";
  if (platform === "win32" && arch === "x64") return "win32-x64";
  return null;
}

export function getIdentityCoreCompanionPackageName(runtimeTriple: string): string | null {
  const packageSuffix =
    COMPANION_PACKAGE_SUFFIX_BY_RUNTIME_TRIPLE[
      runtimeTriple as keyof typeof COMPANION_PACKAGE_SUFFIX_BY_RUNTIME_TRIPLE
    ];
  if (!packageSuffix) {
    return null;
  }
  return `${COMPANION_SCOPE}/${COMPANION_NAME_PREFIX}-${packageSuffix}`;
}

/**
 * If a sibling `identity-core-artifact.json` manifest is present, the
 * candidate file's SHA-256 must match the manifest's recorded value
 * (when the manifest's `file` field names the same artifact). Any
 * mismatch, malformed manifest, or read failure returns `false` so the
 * loader refuses to load a potentially-tampered protected artifact.
 *
 * Without a manifest the loader stays permissive: env-pointed paths,
 * test fixtures, and future installed companion packages without a sidecar
 * continue to load as before.
 */
function verifyArtifactIntegrity(candidatePath: string): boolean {
  const manifestPath = join(dirname(candidatePath), "identity-core-artifact.json");
  if (!existsSync(manifestPath)) {
    return true;
  }

  let manifest: { file?: unknown; sha256?: unknown };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return false;
  }

  const expectedSha = typeof manifest.sha256 === "string" ? manifest.sha256 : null;
  const manifestFile = typeof manifest.file === "string" ? manifest.file : null;
  if (!expectedSha) {
    return false;
  }
  if (manifestFile && manifestFile !== basename(candidatePath)) {
    return true;
  }

  let actualSha: string;
  try {
    actualSha = createHash("sha256").update(readFileSync(candidatePath)).digest("hex");
  } catch {
    return false;
  }

  return actualSha === expectedSha;
}

function resolveCandidatePath(options: LoadNativeIdentityCoreOptions): string | null {
  const envPath = options.envPath !== undefined ? options.envPath : process.env[NATIVE_PATH_ENV];
  if (envPath && envPath.trim().length > 0 && existsSync(envPath)) {
    return envPath;
  }

  const bundled = defaultBundledArtifactPath(options);
  if (bundled && existsSync(bundled)) {
    return bundled;
  }

  const staged = defaultStagedArtifactPath(options);
  if (staged && existsSync(staged)) {
    return staged;
  }

  const companion = defaultInstalledCompanionArtifactPath(options);
  if (companion && existsSync(companion)) {
    return companion;
  }

  return null;
}

function defaultBundledArtifactPath(options: LoadNativeIdentityCoreOptions): string | null {
  if (options.bundledPath !== undefined) {
    return options.bundledPath;
  }

  const triple = getIdentityCoreNativeRuntimeTriple(
    options.platform ?? process.platform,
    options.arch ?? process.arch,
  );
  if (!triple) {
    return null;
  }

  let here: string;
  try {
    here = dirname(fileURLToPath(import.meta.url));
  } catch {
    return null;
  }

  return join(here, "..", "native", triple, "identity-core.node");
}

function defaultStagedArtifactPath(options: LoadNativeIdentityCoreOptions): string | null {
  if (options.stagedPath !== undefined) {
    return options.stagedPath;
  }

  const triple = getIdentityCoreNativeRuntimeTriple(
    options.platform ?? process.platform,
    options.arch ?? process.arch,
  );
  if (!triple) {
    return null;
  }

  let here: string;
  try {
    here = dirname(fileURLToPath(import.meta.url));
  } catch {
    return null;
  }

  return join(here, "..", "native-staging", triple, "identity-core.node");
}

function defaultInstalledCompanionArtifactPath(
  options: LoadNativeIdentityCoreOptions,
): string | null {
  if (options.companionPath && options.companionPath.trim().length > 0) {
    return options.companionPath;
  }

  const runtimeTriple = getIdentityCoreNativeRuntimeTriple(
    options.platform ?? process.platform,
    options.arch ?? process.arch,
  );
  if (!runtimeTriple) {
    return null;
  }

  const packageName =
    options.companionPackageName ?? getIdentityCoreCompanionPackageName(runtimeTriple);
  if (!packageName) {
    return null;
  }

  const resolveFn = options.resolveFn ?? defaultResolve;
  try {
    return resolveFn(packageName);
  } catch {
    return null;
  }
}

function defaultRequire(path: string): unknown {
  const require = createRequire(import.meta.url);
  return require(path);
}

function defaultResolve(specifier: string): string {
  const require = createRequire(import.meta.url);
  return require.resolve(specifier);
}

function extractIdentityCore(moduleValue: unknown): IdentityCore | null {
  if (isIdentityCore(moduleValue)) {
    return moduleValue;
  }

  const asObject = moduleValue as
    | {
        default?: unknown;
        identityCore?: unknown;
        createIdentityCore?: unknown;
        createIdentityCoreNative?: unknown;
      }
    | undefined;
  if (!asObject) {
    return null;
  }

  if (isIdentityCore(asObject.default)) return asObject.default;
  if (isIdentityCore(asObject.identityCore)) return asObject.identityCore;

  const factory =
    typeof asObject.createIdentityCoreNative === "function"
      ? asObject.createIdentityCoreNative
      : typeof asObject.createIdentityCore === "function"
        ? asObject.createIdentityCore
        : undefined;
  if (factory) {
    let constructed: unknown;
    try {
      constructed = factory();
    } catch {
      return null;
    }
    return isIdentityCore(constructed) ? constructed : null;
  }

  return null;
}

function isIdentityCore(value: unknown): value is IdentityCore {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as IdentityCore).getIdentity === "function" &&
    typeof (value as IdentityCore).getPublicKey === "function" &&
    typeof (value as IdentityCore).signHttpRequest === "function"
  );
}
