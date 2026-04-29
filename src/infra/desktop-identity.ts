import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/config.js";

export function resolveIdentityKeyPath(stateDir?: string): string {
  const resolvedStateDir = stateDir ?? resolveStateDir(process.env);
  return path.join(resolvedStateDir, "identity-key");
}

export function loadDesktopIdentityKey(stateDir?: string): string | null {
  const keyPath = resolveIdentityKeyPath(stateDir);
  if (!fs.existsSync(keyPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(keyPath, "utf-8").trim();
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      return raw.toLowerCase();
    }
    return null;
  } catch {
    return null;
  }
}
