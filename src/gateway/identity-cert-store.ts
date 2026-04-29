import fs from "node:fs";
import path from "node:path";
import type { Certificate } from "../types/certificates.js";
import { CONFIG_DIR } from "../utils.js";

export type StoredIdentityCert = {
  certificate: Certificate;
  certHash: string;
  updatedAt: number;
};

const IDENTITY_CERTS_PATH = path.join(CONFIG_DIR, "identity-certs.json");

export function loadIdentityCerts(): Record<string, StoredIdentityCert> {
  try {
    if (!fs.existsSync(IDENTITY_CERTS_PATH)) {
      return {};
    }
    const raw = fs.readFileSync(IDENTITY_CERTS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, StoredIdentityCert>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

export function saveIdentityCert(identityKey: string, entry: StoredIdentityCert): void {
  const existing = loadIdentityCerts();
  existing[identityKey] = entry;
  const dir = path.dirname(IDENTITY_CERTS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(IDENTITY_CERTS_PATH, JSON.stringify(existing, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export function getIdentityCert(identityKey: string): StoredIdentityCert | null {
  const entries = loadIdentityCerts();
  return entries[identityKey] ?? null;
}
