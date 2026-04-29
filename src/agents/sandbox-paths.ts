import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Sensitive path prefixes that should be blocked even when Docker sandbox is not configured.
 * This is a defense-in-depth measure against prompt injection → file read attacks.
 * SECURITY: EDWIN-2026-003
 */
const BLOCKED_PATH_PREFIXES = [
  "/.ssh",
  "/.gnupg",
  "/.aws",
  "/.config/gcloud",
  "/.kube",
  "/.docker",
  "/.npmrc",
  "/.pypirc",
  "/.netrc",
  "/.git-credentials",
  "/.config/gh",
  "/.config/hub",
];

const BLOCKED_ABSOLUTE_PATHS = ["/etc/shadow", "/etc/gshadow", "/etc/master.passwd"];

/**
 * Assert that a path doesn't target sensitive system/user directories.
 * Used as a lightweight "soft sandbox" when Docker sandbox is not configured.
 * Does NOT restrict workspace access — only blocks known-dangerous paths.
 * SECURITY: EDWIN-2026-003
 */
export function assertNotSensitivePath(filePath: string): void {
  const resolved = path.resolve(expandPath(filePath));
  const home = os.homedir();

  // Block absolute sensitive paths
  for (const blocked of BLOCKED_ABSOLUTE_PATHS) {
    if (resolved === blocked) {
      throw new Error(`Access denied: ${filePath} is a sensitive system file`);
    }
  }

  // Block sensitive home directory paths
  if (resolved.startsWith(home)) {
    const relative = resolved.slice(home.length);
    for (const prefix of BLOCKED_PATH_PREFIXES) {
      if (relative === prefix || relative.startsWith(prefix + "/")) {
        throw new Error(
          `Access denied: ${filePath} is in a sensitive directory (${prefix.slice(1)})`,
        );
      }
    }
  }
}

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

function normalizeUnicodeSpaces(str: string): string {
  return str.replace(UNICODE_SPACES, " ");
}

function expandPath(filePath: string): string {
  const normalized = normalizeUnicodeSpaces(filePath);
  if (normalized === "~") {
    return os.homedir();
  }
  if (normalized.startsWith("~/")) {
    return os.homedir() + normalized.slice(1);
  }
  return normalized;
}

function resolveToCwd(filePath: string, cwd: string): string {
  const expanded = expandPath(filePath);
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  return path.resolve(cwd, expanded);
}

export function resolveSandboxPath(params: { filePath: string; cwd: string; root: string }): {
  resolved: string;
  relative: string;
} {
  const resolved = resolveToCwd(params.filePath, params.cwd);
  const rootResolved = path.resolve(params.root);
  const relative = path.relative(rootResolved, resolved);
  if (!relative || relative === "") {
    return { resolved, relative: "" };
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes sandbox root (${shortPath(rootResolved)}): ${params.filePath}`);
  }
  return { resolved, relative };
}

export async function assertSandboxPath(params: { filePath: string; cwd: string; root: string }) {
  const resolved = resolveSandboxPath(params);
  await assertNoSymlink(resolved.relative, path.resolve(params.root));
  return resolved;
}

async function assertNoSymlink(relative: string, root: string) {
  if (!relative) {
    return;
  }
  const parts = relative.split(path.sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`Symlink not allowed in sandbox path: ${current}`);
      }
    } catch (err) {
      const anyErr = err as { code?: string };
      if (anyErr.code === "ENOENT") {
        return;
      }
      throw err;
    }
  }
}

function shortPath(value: string) {
  if (value.startsWith(os.homedir())) {
    return `~${value.slice(os.homedir().length)}`;
  }
  return value;
}
