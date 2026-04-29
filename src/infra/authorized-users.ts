import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/config.js";

export type AuthorizedUsersSnapshot = {
  users?: Record<string, { pubkey?: string } | undefined>;
};

export function resolveAuthorizedUsersPath(stateDir?: string): string {
  const resolvedStateDir = stateDir ?? resolveStateDir(process.env);
  return path.join(resolvedStateDir, "authorized_users.json");
}

export function loadAuthorizedKeysFromUsers(stateDir?: string): string[] {
  const usersPath = resolveAuthorizedUsersPath(stateDir);
  if (!fs.existsSync(usersPath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(usersPath, "utf-8");
    const parsed = JSON.parse(raw) as AuthorizedUsersSnapshot;
    const users = parsed?.users ?? {};
    const keys = new Set<string>();
    for (const [key, value] of Object.entries(users)) {
      if (typeof key === "string" && key.length > 0) {
        keys.add(key);
      }
      if (value?.pubkey && typeof value.pubkey === "string") {
        keys.add(value.pubkey);
      }
    }
    return Array.from(keys);
  } catch {
    return [];
  }
}
