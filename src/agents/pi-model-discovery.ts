import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import type { AuthProfileCredential, AuthProfileStore } from "./auth-profiles.js";
import { ensureAuthProfileStore } from "./auth-profiles.js";

export { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

function pickPiCompatibleProfileId(store: AuthProfileStore, provider: string): string | undefined {
  const providerProfiles = Object.entries(store.profiles)
    .filter(([, credential]) => credential.provider === provider)
    .map(([profileId]) => profileId);
  if (providerProfiles.length === 0) {
    return undefined;
  }

  const preferred = store.order?.[provider]?.find((profileId) =>
    providerProfiles.includes(profileId),
  );
  if (preferred) {
    return preferred;
  }

  const defaultProfileId = `${provider}:default`;
  if (providerProfiles.includes(defaultProfileId)) {
    return defaultProfileId;
  }

  return providerProfiles.toSorted((a, b) => a.localeCompare(b))[0];
}

function buildPiApiKeyFromCredential(credential: AuthProfileCredential): string | null {
  if (credential.type === "api_key") {
    const key = credential.key?.trim();
    return key || null;
  }

  if (credential.type === "token") {
    const token = credential.token?.trim();
    if (
      !token ||
      (typeof credential.expires === "number" &&
        Number.isFinite(credential.expires) &&
        credential.expires > 0 &&
        Date.now() >= credential.expires)
    ) {
      return null;
    }
    return token;
  }

  const access = credential.access?.trim();
  if (!access || Date.now() >= credential.expires) {
    return null;
  }

  if (credential.provider === "google-gemini-cli" || credential.provider === "google-antigravity") {
    return JSON.stringify({
      token: access,
      projectId: credential.projectId,
    });
  }

  return access;
}

function toPiAuthCredential(credential: AuthProfileCredential): Record<string, unknown> | null {
  const key = buildPiApiKeyFromCredential(credential);
  if (!key) {
    return null;
  }
  return {
    type: "api_key",
    key,
  };
}

function materializePiAuthJson(agentDir: string): string {
  const authPath = path.join(agentDir, "auth.json");
  const store = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
  const providers = new Set(
    Object.values(store.profiles)
      .map((credential) => credential.provider?.trim())
      .filter((provider): provider is string => Boolean(provider)),
  );

  const piAuth: Record<string, Record<string, unknown>> = {};
  for (const provider of providers) {
    const profileId = pickPiCompatibleProfileId(store, provider);
    if (!profileId) {
      continue;
    }
    const credential = store.profiles[profileId];
    if (!credential) {
      continue;
    }
    const piCredential = toPiAuthCredential(credential);
    if (!piCredential) {
      continue;
    }
    piAuth[provider] = piCredential;
  }

  fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(authPath, `${JSON.stringify(piAuth, null, 2)}\n`, { mode: 0o600 });
  return authPath;
}

// Compatibility helpers for pi-coding-agent 0.50+ (discover* helpers removed).
export function discoverAuthStorage(agentDir: string): AuthStorage {
  return new AuthStorage(materializePiAuthJson(agentDir));
}

export function discoverModels(authStorage: AuthStorage, agentDir: string): ModelRegistry {
  return new ModelRegistry(authStorage, path.join(agentDir, "models.json"));
}
