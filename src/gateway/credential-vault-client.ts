/**
 * Credential Vault Client
 *
 * Requests credentials from edwinpai-desktop via the exec approval system.
 * The gateway holds no credentials at rest — all secrets live in the
 * desktop's encrypted vault, gated by BSV-signed approval.
 *
 * Flow:
 *   1. Gateway needs a credential (e.g., ANTHROPIC_API_KEY)
 *   2. Check in-memory cache → return if valid lease
 *   3. Broadcast "credential.requested" to connected desktop clients
 *   4. Desktop shows approval UI (or auto-approves from policy)
 *   5. Desktop responds via "credential.resolve" with the secret
 *   6. Gateway caches in memory with TTL, uses credential
 *   7. On lease expiry, credential is evicted from memory
 */

import { CredentialCache } from "./credential-cache.js";

export type CredentialAskMode = "always" | "first-time" | "auto-grant" | "deny";

export interface CredentialRequest {
  /** Unique credential identifier (e.g., "anthropic-api-key", "stripe-secret-key") */
  credentialId: string;
  /** Human-readable name for approval UI */
  name: string;
  /** Why the credential is needed (shown in approval prompt) */
  purpose: string;
  /** Requested lease duration in ms (default 300_000 = 5 min) */
  leaseDurationMs?: number;
  /** Which component is requesting (e.g., "agent", "channel:telegram", "tool:web-search") */
  requester?: string;
}

export interface CredentialResponse {
  requestId: string;
  decision: "granted" | "denied";
  /** The secret value (only present when granted) */
  credential?: string;
  /** Lease duration in ms (may differ from requested) */
  leaseMs?: number;
  /** Who approved (BSV public key or display name) */
  grantedBy?: string;
}

export interface PendingCredentialRequest {
  id: string;
  request: CredentialRequest;
  createdAtMs: number;
  expiresAtMs: number;
  resolve: (response: CredentialResponse | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface CredentialVaultDeps {
  /** Broadcast a WebSocket event to all connected clients */
  broadcast: (event: string, payload: unknown) => void;
  /** Optional logger */
  log?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

const DEFAULT_LEASE_MS = 300_000; // 5 minutes
const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes (matches exec approval)

let requestCounter = 0;

export class CredentialVaultClient {
  private cache: CredentialCache;
  private pending = new Map<string, PendingCredentialRequest>();
  private deps: CredentialVaultDeps;

  constructor(deps: CredentialVaultDeps) {
    this.deps = deps;
    this.cache = new CredentialCache();
  }

  /**
   * Get a credential. Checks cache first, then requests from desktop.
   * Returns the credential value, or null if denied/timed out.
   */
  async getCredential(request: CredentialRequest): Promise<string | null> {
    // 1. Check cache
    const cached = this.cache.get(request.credentialId);
    if (cached) {
      this.deps.log?.info("credential cache hit", { credentialId: request.credentialId });
      return cached;
    }

    // 2. Request from desktop
    this.deps.log?.info("requesting credential from desktop", {
      credentialId: request.credentialId,
      purpose: request.purpose,
    });

    const response = await this.requestFromDesktop(request);
    if (!response || response.decision !== "granted" || !response.credential) {
      this.deps.log?.warn("credential request denied or timed out", {
        credentialId: request.credentialId,
        decision: response?.decision ?? "timeout",
      });
      return null;
    }

    // 3. Cache the credential
    const leaseMs = response.leaseMs ?? request.leaseDurationMs ?? DEFAULT_LEASE_MS;
    this.cache.set(
      request.credentialId,
      response.credential,
      leaseMs,
      response.grantedBy ?? "unknown",
    );

    this.deps.log?.info("credential granted and cached", {
      credentialId: request.credentialId,
      leaseMs,
      grantedBy: response.grantedBy,
    });

    return response.credential;
  }

  /**
   * Resolve a pending credential request (called by server method handler
   * when desktop responds).
   */
  resolve(requestId: string, response: CredentialResponse): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    pending.resolve(response);
    return true;
  }

  /** Get a snapshot of a pending request (for validation). */
  getPending(requestId: string): PendingCredentialRequest | null {
    return this.pending.get(requestId) ?? null;
  }

  /** Synchronous cache-only lookup (no desktop request). */
  getCachedCredential(credentialId: string): string | null {
    return this.cache.get(credentialId);
  }

  /** Evict a credential from cache (e.g., on rotation or revocation). */
  evict(credentialId: string): void {
    this.cache.evict(credentialId);
  }

  /** Clear all cached credentials. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Get cache diagnostics. */
  getCacheStatus(): { size: number; ids: string[] } {
    return { size: this.cache.size, ids: this.cache.listIds() };
  }

  /** Get cache metadata for a specific credential. */
  getCacheMeta(credentialId: string) {
    return this.cache.getMeta(credentialId);
  }

  private requestFromDesktop(request: CredentialRequest): Promise<CredentialResponse | null> {
    return new Promise((resolve) => {
      const id = `cred-${Date.now()}-${++requestCounter}`;
      const timeoutMs = DEFAULT_TIMEOUT_MS;
      const now = Date.now();

      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(null);
      }, timeoutMs);
      if (typeof timer === "object" && "unref" in timer) timer.unref();

      const pendingEntry: PendingCredentialRequest = {
        id,
        request,
        createdAtMs: now,
        expiresAtMs: now + timeoutMs,
        resolve,
        timer,
      };

      this.pending.set(id, pendingEntry);

      // Broadcast to all connected clients (desktop, CLI, etc.)
      this.deps.broadcast("credential.requested", {
        id,
        credentialId: request.credentialId,
        name: request.name,
        purpose: request.purpose,
        requester: request.requester,
        leaseDurationMs: request.leaseDurationMs ?? DEFAULT_LEASE_MS,
        createdAtMs: now,
        expiresAtMs: now + timeoutMs,
      });
    });
  }
}
