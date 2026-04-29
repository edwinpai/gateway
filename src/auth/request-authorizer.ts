/**
 * Request Authorizer - BRC-103 Request Authorization Middleware
 *
 * Validates signed requests before they reach the AI layer:
 * - Extracts and verifies BRC-103 signatures
 * - Enforces timing constraints
 * - Implements replay protection
 * - Tracks identity timing baselines
 *
 * @see https://github.com/bitcoin-sv/BRCs/blob/master/peer-to-peer/0103.md
 * @see SECURITY-MITIGATIONS-v2.md
 */

import type { IdentityCore } from "@edwinpai/identity-core";
import { createNodeIdentityCoreBinding } from "@edwinpai/identity-core";
import type { SignedPrompt, SignedRequest } from "../types/bsv-auth.js";
import type { TimingMonitor, TimingVerdict } from "./timing-monitor.js";
import { canonicalizeRequest, canonicalizeSignedPrompt } from "../types/bsv-auth.js";
import { verifySignatureUnified, sha256 } from "./verification.js";

/**
 * Default configuration values
 */
const DEFAULT_MAX_TIMESTAMP_AGE_MS = 30000; // 30 seconds
const DEFAULT_NONCE_TTL_MS = 60000; // 1 minute
const DEFAULT_NONCE_CLEANUP_INTERVAL_MS = 30000; // 30 seconds
const DEFAULT_MAX_NONCES = 10000;

const requestAuthorizerIdentityCore = createNodeIdentityCoreBinding({
  async getPublicKey(): Promise<string> {
    throw new Error(
      "RequestAuthorizer identity-core verifier transport does not expose getPublicKey()",
    );
  },
  async signHttpRequest(): Promise<never> {
    throw new Error(
      "RequestAuthorizer identity-core verifier transport does not expose signHttpRequest()",
    );
  },
  async verifySignature(input) {
    return {
      valid: verifySignatureUnified(input.data, input.signature, input.publicKey),
    };
  },
});

/**
 * Authorization result
 */
export interface AuthorizationResult {
  /** Whether the request is authorized */
  authorized: boolean;
  /** Identity public key (if authorized) */
  identity?: string;
  /** Rejection reason (if not authorized) */
  reason?: string;
  /** Measured request latency in milliseconds */
  latencyMs: number;
  /** Anomaly score (0-1, higher = more suspicious) */
  anomalyScore: number;
  /** Timing verdict from the timing monitor */
  timingVerdict?: TimingVerdict;
}

/**
 * Identity metadata for registered identities
 */
export interface IdentityMetadata {
  /** Human-readable name */
  name?: string;
  /** Trust level (0-100) */
  trustLevel?: number;
  /** Registration timestamp */
  registeredAt: number;
  /** Last authorization timestamp */
  lastSeenAt?: number;
  /** Total authorization count */
  authCount: number;
}

/**
 * Signed request structure with auth headers
 */
export interface AuthenticatedRequest {
  /** HTTP method */
  method: string;
  /** Request path */
  path: string;
  /** Request body (optional) */
  body?: string | object;
  /** Auth headers */
  headers: {
    "x-bsv-identity-key": string;
    "x-bsv-signature": string;
    "x-bsv-timestamp": string;
    "x-bsv-nonce": string;
  };
}

/**
 * Nonce entry for replay protection
 */
export interface NonceEntry {
  /** The nonce value */
  nonce: string;
  /** Identity that used this nonce */
  identity: string;
  /** When this nonce was seen */
  timestamp: number;
  /** When this nonce expires */
  expiresAt: number;
}

/**
 * Request Authorizer Configuration
 */
export interface RequestAuthorizerConfig {
  /** Maximum age of request timestamp in milliseconds */
  maxTimestampAgeMs?: number;
  /** Time-to-live for nonces in milliseconds */
  nonceTtlMs?: number;
  /** Cleanup interval for expired nonces */
  nonceCleanupIntervalMs?: number;
  /** Maximum number of nonces to track */
  maxNonces?: number;
  /** Enable timing monitoring */
  enableTimingMonitor?: boolean;
  /** Timing monitor instance (optional, created if not provided) */
  timingMonitor?: TimingMonitor;
  /** Identity-core verifier used for request signature checks */
  identityCore?: Pick<IdentityCore, "verifySignature">;
}

/**
 * Request Authorizer
 *
 * Validates signed requests following BRC-103 specification.
 *
 * @example
 * ```typescript
 * const authorizer = new RequestAuthorizer();
 *
 * // Register known identities
 * authorizer.registerIdentity("03abc...", { name: "Alice" });
 *
 * // Authorize a request
 * const result = await authorizer.authorize({
 *   method: "POST",
 *   path: "/api/agent/run",
 *   body: { prompt: "hello" },
 *   headers: {
 *     "x-bsv-identity-key": "03abc...",
 *     "x-bsv-signature": "304...",
 *     "x-bsv-timestamp": "1707300000000",
 *     "x-bsv-nonce": "550e8400-e29b-41d4-a716-446655440000"
 *   }
 * });
 *
 * if (result.authorized) {
 *   console.log(`Request from ${result.identity} authorized`);
 * }
 * ```
 */
export class RequestAuthorizer {
  private readonly config: Required<Omit<RequestAuthorizerConfig, "identityCore">>;
  private readonly knownIdentities: Map<string, IdentityMetadata> = new Map();
  private readonly usedNonces: Map<string, NonceEntry> = new Map();
  private readonly timingMonitor?: TimingMonitor;
  private readonly identityCore: Pick<IdentityCore, "verifySignature">;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Create a new RequestAuthorizer
   *
   * @param config - Authorizer configuration
   */
  constructor(config: RequestAuthorizerConfig = {}) {
    this.config = {
      maxTimestampAgeMs: config.maxTimestampAgeMs ?? DEFAULT_MAX_TIMESTAMP_AGE_MS,
      nonceTtlMs: config.nonceTtlMs ?? DEFAULT_NONCE_TTL_MS,
      nonceCleanupIntervalMs: config.nonceCleanupIntervalMs ?? DEFAULT_NONCE_CLEANUP_INTERVAL_MS,
      maxNonces: config.maxNonces ?? DEFAULT_MAX_NONCES,
      enableTimingMonitor: config.enableTimingMonitor ?? true,
      timingMonitor: config.timingMonitor as TimingMonitor,
    };

    this.timingMonitor = config.timingMonitor;
    this.identityCore = config.identityCore ?? requestAuthorizerIdentityCore;

    // Start nonce cleanup timer
    this.startCleanupTimer();
  }

  /**
   * Authorize a signed request
   *
   * @param request - The authenticated request to verify
   * @returns Authorization result
   */
  async authorize(request: AuthenticatedRequest): Promise<AuthorizationResult> {
    const startTime = Date.now();

    try {
      // Extract auth headers
      const identityKey = request.headers["x-bsv-identity-key"];
      const signature = request.headers["x-bsv-signature"];
      const timestampStr = request.headers["x-bsv-timestamp"];
      const nonce = request.headers["x-bsv-nonce"];

      // Validate required headers
      if (!identityKey || !signature || !timestampStr || !nonce) {
        return this.rejectResult(startTime, "Missing required auth headers");
      }

      // Validate identity key format (compressed public key)
      if (!/^0[23][0-9a-fA-F]{64}$/.test(identityKey)) {
        return this.rejectResult(startTime, "Invalid identity key format");
      }

      // Validate timestamp format
      const timestamp = parseInt(timestampStr, 10);
      if (isNaN(timestamp)) {
        return this.rejectResult(startTime, "Invalid timestamp format");
      }

      // Check timestamp freshness
      const now = Date.now();
      const age = Math.abs(now - timestamp);
      if (age > this.config.maxTimestampAgeMs) {
        return this.rejectResult(
          startTime,
          `Request expired: timestamp age ${age}ms exceeds maximum ${this.config.maxTimestampAgeMs}ms`,
        );
      }

      // Check for replay (nonce already used)
      if (this.isNonceUsed(nonce, identityKey)) {
        return this.rejectResult(startTime, "Replay detected: nonce already used", 1.0);
      }

      // Build canonical request string for verification
      const signedRequest: SignedRequest = {
        method: request.method,
        path: request.path,
        body: request.body,
        timestamp,
        nonce,
        identityKey,
        signature,
      };

      const canonicalRequest = canonicalizeRequest(signedRequest);

      // Verify signature through the shared identity-core boundary
      const verification = await this.identityCore.verifySignature({
        data: canonicalRequest,
        signature,
        publicKey: identityKey,
      });

      if (!verification.valid) {
        return this.rejectResult(startTime, "Invalid signature", 0.8);
      }

      // Record nonce to prevent replay
      this.recordNonce(nonce, identityKey);

      // Update identity metadata if known
      this.updateIdentityStats(identityKey);

      // Check timing if monitor is available
      let timingVerdict: TimingVerdict | undefined;
      let anomalyScore = 0;

      if (this.timingMonitor) {
        // Check for concurrent actions BEFORE recording (1-to-1 constraint)
        if (!this.timingMonitor.checkConcurrency(identityKey, timestamp)) {
          return this.rejectResult(
            startTime,
            "Concurrent action detected from same identity",
            1.0,
            identityKey,
          );
        }

        // Record after concurrency check passes
        const latencyMs = Date.now() - startTime;
        timingVerdict = this.timingMonitor.recordAction(identityKey, timestamp, latencyMs);
        anomalyScore = timingVerdict.anomalyScore;
      }

      return {
        authorized: true,
        identity: identityKey,
        latencyMs: Date.now() - startTime,
        anomalyScore,
        timingVerdict,
      };
    } catch (error) {
      return this.rejectResult(
        startTime,
        `Authorization error: ${error instanceof Error ? error.message : "Unknown error"}`,
        0.5,
      );
    }
  }

  /**
   * Authorize a signed prompt envelope (identity-first connect)
   */
  async authorizeSignedPrompt(signedPrompt: SignedPrompt): Promise<AuthorizationResult> {
    const startTime = Date.now();

    try {
      const envelope = signedPrompt?.envelope;
      const signature = signedPrompt?.signature;
      const identityKey = envelope?.cert?.subject;
      const timestamp = envelope?.issuedAt;
      const nonce = envelope?.nonce;

      if (!envelope || !signature || !identityKey || typeof timestamp !== "number" || !nonce) {
        return this.rejectResult(startTime, "Missing signed prompt fields");
      }

      if (!/^0[23][0-9a-fA-F]{64}$/.test(identityKey)) {
        return this.rejectResult(startTime, "Invalid identity key format");
      }

      const now = Date.now();
      const age = Math.abs(now - timestamp);
      if (age > this.config.maxTimestampAgeMs) {
        return this.rejectResult(
          startTime,
          `Signed prompt expired: timestamp age ${age}ms exceeds maximum ${this.config.maxTimestampAgeMs}ms`,
        );
      }

      if (this.isNonceUsed(nonce, identityKey)) {
        return this.rejectResult(startTime, "Replay detected: nonce already used", 1.0);
      }

      const canonicalPrompt = canonicalizeSignedPrompt(envelope);
      const verification = await this.identityCore.verifySignature({
        data: canonicalPrompt,
        signature,
        publicKey: identityKey,
      });
      if (!verification.valid) {
        return this.rejectResult(startTime, "Invalid signed prompt signature", 0.8);
      }

      this.recordNonce(nonce, identityKey);
      this.updateIdentityStats(identityKey);

      return {
        authorized: true,
        identity: identityKey,
        latencyMs: Date.now() - startTime,
        anomalyScore: 0,
      };
    } catch (error) {
      return this.rejectResult(
        startTime,
        `Signed prompt authorization error: ${error instanceof Error ? error.message : "Unknown error"}`,
        0.5,
      );
    }
  }

  /**
   * Register a known identity
   *
   * @param publicKey - Identity public key (compressed, hex)
   * @param metadata - Optional metadata for the identity
   */
  registerIdentity(publicKey: string, metadata?: Partial<IdentityMetadata>): void {
    // Validate public key format
    if (!/^0[23][0-9a-fA-F]{64}$/.test(publicKey)) {
      throw new Error("Invalid public key format");
    }

    const existing = this.knownIdentities.get(publicKey);

    this.knownIdentities.set(publicKey, {
      name: metadata?.name ?? existing?.name,
      trustLevel: metadata?.trustLevel ?? existing?.trustLevel ?? 50,
      registeredAt: existing?.registeredAt ?? Date.now(),
      lastSeenAt: existing?.lastSeenAt,
      authCount: existing?.authCount ?? 0,
    });
  }

  /**
   * Check if an identity is registered
   *
   * @param publicKey - Identity public key
   * @returns true if identity is known
   */
  isKnownIdentity(publicKey: string): boolean {
    return this.knownIdentities.has(publicKey);
  }

  /**
   * Get identity metadata
   *
   * @param publicKey - Identity public key
   * @returns Identity metadata or undefined if not registered
   */
  getIdentityMetadata(publicKey: string): IdentityMetadata | undefined {
    return this.knownIdentities.get(publicKey);
  }

  /**
   * Get timing baseline for an identity
   *
   * @param identity - Identity public key
   * @returns Timing profile or undefined if not available
   */
  getTimingBaseline(identity: string): object | undefined {
    if (this.timingMonitor) {
      return this.timingMonitor.getProfile(identity);
    }
    return undefined;
  }

  /**
   * Clean up expired nonces
   */
  cleanupExpiredNonces(): number {
    const now = Date.now();
    let removed = 0;

    for (const [nonce, entry] of this.usedNonces) {
      if (now > entry.expiresAt) {
        this.usedNonces.delete(nonce);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get the number of tracked nonces
   */
  getNonceCount(): number {
    return this.usedNonces.size;
  }

  /**
   * Stop the cleanup timer
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Snapshot active (non-expired) nonces for persistence across restarts.
   * SECURITY (EDWIN-2026-101): Prevents replay window during restart.
   * @returns Array of [key, NonceEntry] pairs that are still valid.
   */
  snapshotNonces(): Array<[string, NonceEntry]> {
    const now = Date.now();
    const active: Array<[string, NonceEntry]> = [];
    for (const [key, entry] of this.usedNonces) {
      if (now <= entry.expiresAt) {
        active.push([key, entry]);
      }
    }
    return active;
  }

  /**
   * Restore nonces from a previous snapshot (loaded from disk).
   * Only restores entries that haven't expired yet.
   * SECURITY (EDWIN-2026-101)
   */
  restoreNonces(entries: Array<[string, NonceEntry]>): number {
    const now = Date.now();
    let restored = 0;
    for (const [key, entry] of entries) {
      if (now <= entry.expiresAt) {
        this.usedNonces.set(key, entry);
        restored++;
      }
    }
    return restored;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private rejectResult(
    startTime: number,
    reason: string,
    anomalyScore: number = 0,
    identity?: string,
    timingVerdict?: TimingVerdict,
  ): AuthorizationResult {
    return {
      authorized: false,
      identity,
      reason,
      latencyMs: Date.now() - startTime,
      anomalyScore,
      timingVerdict,
    };
  }

  private isNonceUsed(nonce: string, identity: string): boolean {
    // SECURITY (EDWIN-2026-102): Scope nonce check per identity.
    // A nonce is only considered "used" if it was used by the SAME identity.
    // This prevents cross-identity nonce collision and DoS via nonce eviction.
    const key = `${identity}:${nonce}`;
    const entry = this.usedNonces.get(key);
    if (!entry) {
      return false;
    }

    // Check if nonce has expired
    if (Date.now() > entry.expiresAt) {
      this.usedNonces.delete(key);
      return false;
    }

    return true;
  }

  private recordNonce(nonce: string, identity: string): void {
    const now = Date.now();
    // SECURITY (EDWIN-2026-102): Key nonces per-identity to prevent cross-identity eviction
    const key = `${identity}:${nonce}`;

    // Enforce max nonces limit — evict expired first, then oldest
    if (this.usedNonces.size >= this.config.maxNonces) {
      // First pass: remove expired nonces
      for (const [k, entry] of this.usedNonces) {
        if (now > entry.expiresAt) {
          this.usedNonces.delete(k);
        }
      }
      // If still over limit, evict oldest from the SAME identity first
      if (this.usedNonces.size >= this.config.maxNonces) {
        const sameIdentityEntries = Array.from(this.usedNonces.entries())
          .filter(([, e]) => e.identity === identity)
          .toSorted((a, b) => a[1].timestamp - b[1].timestamp);
        const toRemove = sameIdentityEntries.slice(
          0,
          Math.max(1, Math.floor(sameIdentityEntries.length * 0.1)),
        );
        for (const [k] of toRemove) {
          this.usedNonces.delete(k);
        }
      }
    }

    this.usedNonces.set(key, {
      nonce,
      identity,
      timestamp: now,
      expiresAt: now + this.config.nonceTtlMs,
    });
  }

  private updateIdentityStats(publicKey: string): void {
    const metadata = this.knownIdentities.get(publicKey);
    if (metadata) {
      metadata.lastSeenAt = Date.now();
      metadata.authCount++;
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredNonces();
    }, this.config.nonceCleanupIntervalMs);

    // Don't prevent process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }
}

/**
 * Create a signed request from a raw request
 *
 * This is a helper for creating test requests.
 *
 * @param method - HTTP method
 * @param path - Request path
 * @param body - Request body
 * @param identityKey - Signer's public key
 * @param signFn - Function to sign the canonical request
 * @returns Authenticated request with headers
 */
export async function createSignedRequest(
  method: string,
  path: string,
  body: string | object | undefined,
  identityKey: string,
  signFn: (messageHash: string) => Promise<string>,
): Promise<AuthenticatedRequest> {
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();

  // Build canonical request
  const signedRequest: SignedRequest = {
    method,
    path,
    body,
    timestamp,
    nonce,
    identityKey,
    signature: "", // Will be replaced
  };

  const canonicalRequest = canonicalizeRequest(signedRequest);
  const messageHash = sha256(canonicalRequest).toString("hex");
  const signature = await signFn(messageHash);

  return {
    method,
    path,
    body,
    headers: {
      "x-bsv-identity-key": identityKey,
      "x-bsv-signature": signature,
      "x-bsv-timestamp": timestamp.toString(),
      "x-bsv-nonce": nonce,
    },
  };
}
