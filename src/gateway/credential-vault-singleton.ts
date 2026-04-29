/**
 * Credential Vault Singleton
 *
 * Provides a process-level reference to the CredentialVaultClient so that
 * credential resolution code (model-auth, channel tokens, tool API keys)
 * can request credentials from the desktop vault without threading the
 * client through every call site.
 *
 * The gateway sets this once on startup; non-gateway processes (CLI, tests)
 * simply never call `setVaultClient`, so `getCredentialFromVault` returns
 * null — existing env/config resolution still works.
 */

import type { CredentialVaultClient } from "./credential-vault-client.js";

let _vaultClient: CredentialVaultClient | null = null;

/** Called once by the gateway on startup. */
export function setVaultClient(client: CredentialVaultClient): void {
  _vaultClient = client;
}

/** Returns the vault client, or null if not in a gateway process. */
export function getVaultClient(): CredentialVaultClient | null {
  return _vaultClient;
}

/**
 * Try to fetch a credential from the desktop vault (async).
 *
 * Returns the credential string if the vault client is available and the
 * desktop grants the request. Returns null if:
 *   - No vault client (non-gateway process)
 *   - Desktop is offline / not connected
 *   - Request was denied or timed out
 *
 * This is designed to slot into existing resolution chains as a
 * try-first-before-env fallback.
 */
export async function getCredentialFromVault(params: {
  credentialId: string;
  name: string;
  purpose: string;
  requester?: string;
  leaseDurationMs?: number;
}): Promise<string | null> {
  if (!_vaultClient) return null;

  try {
    return await _vaultClient.getCredential({
      credentialId: params.credentialId,
      name: params.name,
      purpose: params.purpose,
      requester: params.requester,
      leaseDurationMs: params.leaseDurationMs,
    });
  } catch {
    return null;
  }
}

/**
 * Synchronous cache-only vault lookup.
 *
 * For use in sync resolution chains (channel token resolvers, etc.)
 * where the credential was previously granted and cached.
 * Does NOT request from desktop — only checks in-memory cache.
 */
export function getCredentialFromVaultSync(credentialId: string): string | null {
  if (!_vaultClient) return null;
  return _vaultClient.getCachedCredential(credentialId);
}
