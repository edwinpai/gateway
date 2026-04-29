/**
 * BSV Authentication Integration for Gateway HTTP Pipeline
 *
 * Wraps the BSV auth middleware to work with EdwinPAI's Node.js HTTP handler pattern.
 * Integrates BRC-103 peer-to-peer authentication into the request pipeline.
 *
 * Now uses RequestAuthorizer for:
 * - Timing anomaly detection (1-to-1 constraint)
 * - Better replay protection (nonce TTL + cleanup)
 * - Anomaly scoring on every request
 * - Audit logging
 *
 * @see https://github.com/bitcoin-sv/BRCs/blob/master/peer-to-peer/0103.md
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { GatewayBsvAuthConfig } from "../config/types.gateway.js";
import type { PublicKey } from "../types/primitives.js";
import {
  extractIdentityFromHeaders,
  verifyIdentity,
  type IdentityContext,
} from "../auth/identity.js";
import { InMemoryNonceStore, type AuthenticatedRequest } from "../auth/middleware.js";
import { publicKeysEqual } from "../auth/owner.js";
import {
  RequestAuthorizer,
  type AuthenticatedRequest as AuthorizerRequest,
  type NonceEntry,
} from "../auth/request-authorizer.js";
import { TimingMonitor, type TimingVerdict } from "../auth/timing-monitor.js";
import { AuthError } from "../types/index.js";
import { CONFIG_DIR } from "../utils.js";

/**
 * Resolved BSV auth configuration with environment variable fallbacks
 */
export interface ResolvedBsvAuth {
  enabled: boolean;
  enableEncryption: boolean;
  ownerPublicKey?: PublicKey;
  ownerOnly: boolean;
  allowUnauthenticated: boolean;
  skipPaths: string[];
  maxTimestampAge: number;
  enableReplayProtection: boolean;
  requiredCertificates?: string[];
  trustedCertifiers?: PublicKey[];
}

/**
 * Extended request with BSV identity context
 */
export interface BsvAuthenticatedRequest extends IncomingMessage {
  /** BSV identity context (set after successful verification) */
  bsvAuth?: {
    identity: import("../types/identity.js").BSVIdentity;
    identityKey: PublicKey;
    isOwner: boolean;
    certificates?: import("../types/certificates.js").VerifiableCertificate[];
    verifiedAt: number;
    /** Anomaly score from timing analysis (0-1, higher = more suspicious) */
    anomalyScore?: number;
    /** Timing verdict from the timing monitor */
    timingVerdict?: TimingVerdict;
  };
}

/**
 * Result of BSV auth processing
 */
export type BsvAuthResult =
  | {
      ok: true;
      identity?: IdentityContext;
      isOwner: boolean;
      anomalyScore?: number;
      timingVerdict?: TimingVerdict;
    }
  | { ok: false; status: number; error: string; code: string };

// Shared nonce store for replay protection (legacy fallback)
let sharedNonceStore: InMemoryNonceStore | null = null;

function _getNonceStore(): InMemoryNonceStore {
  if (!sharedNonceStore) {
    sharedNonceStore = new InMemoryNonceStore(60000); // 1 minute cleanup
  }
  return sharedNonceStore;
}

// Shared RequestAuthorizer singleton with TimingMonitor
let sharedRequestAuthorizer: RequestAuthorizer | null = null;

/**
 * Get or create the shared RequestAuthorizer instance
 */
export function getRequestAuthorizer(config?: { maxTimestampAgeMs?: number }): RequestAuthorizer {
  if (!sharedRequestAuthorizer) {
    const timingMonitor = new TimingMonitor();
    sharedRequestAuthorizer = new RequestAuthorizer({
      maxTimestampAgeMs: config?.maxTimestampAgeMs ?? 30000,
      enableTimingMonitor: true,
      timingMonitor,
    });
    // SECURITY (EDWIN-2026-101): Restore nonces from previous session to prevent replay window
    restoreNoncesFromDisk(sharedRequestAuthorizer);
  }
  return sharedRequestAuthorizer;
}

/**
 * Reset the shared RequestAuthorizer (for testing)
 */
export function resetRequestAuthorizer(): void {
  if (sharedRequestAuthorizer) {
    sharedRequestAuthorizer.stop();
    sharedRequestAuthorizer = null;
  }
}

/**
 * Path to nonce snapshot file (persists nonces across restarts)
 * SECURITY: EDWIN-2026-101
 */
const NONCE_SNAPSHOT_PATH = path.join(CONFIG_DIR, "nonce-snapshot.json");

/**
 * Shutdown the RequestAuthorizer cleanly, persisting active nonces to disk.
 * SECURITY (EDWIN-2026-101): Prevents replay window during restart.
 */
export function shutdownRequestAuthorizer(): void {
  if (sharedRequestAuthorizer) {
    // Persist active nonces before shutdown
    try {
      const snapshot = sharedRequestAuthorizer.snapshotNonces();
      if (snapshot.length > 0) {
        const dir = path.dirname(NONCE_SNAPSHOT_PATH);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        }
        fs.writeFileSync(NONCE_SNAPSHOT_PATH, JSON.stringify(snapshot), {
          encoding: "utf-8",
          mode: 0o600,
        });
      }
    } catch {
      // best-effort: nonce persistence is not critical
    }
    sharedRequestAuthorizer.stop();
  }
}

/**
 * Restore nonces from disk snapshot (call after creating the authorizer).
 * SECURITY (EDWIN-2026-101)
 */
function restoreNoncesFromDisk(authorizer: RequestAuthorizer): void {
  try {
    if (!fs.existsSync(NONCE_SNAPSHOT_PATH)) {
      return;
    }
    const raw = fs.readFileSync(NONCE_SNAPSHOT_PATH, "utf-8");
    const entries = JSON.parse(raw) as Array<[string, NonceEntry]>;
    if (Array.isArray(entries)) {
      authorizer.restoreNonces(entries);
    }
    // Delete snapshot after loading — it's a one-time restore
    fs.unlinkSync(NONCE_SNAPSHOT_PATH);
  } catch {
    // best-effort: corrupted snapshot is safely ignored
  }
}

/**
 * Resolve BSV auth configuration from config and environment
 */
export function resolveBsvAuth(params: {
  bsvAuthConfig?: GatewayBsvAuthConfig | null;
  env?: NodeJS.ProcessEnv;
}): ResolvedBsvAuth {
  const config = params.bsvAuthConfig ?? {};
  const env = params.env ?? process.env;

  const ownerPublicKey = config.ownerPublicKey ?? env.BSV_OWNER_PUBLIC_KEY ?? undefined;

  return {
    enabled: config.enabled ?? false,
    enableEncryption: config.enableEncryption ?? false,
    ownerPublicKey: ownerPublicKey,
    ownerOnly: config.ownerOnly ?? false,
    allowUnauthenticated: config.allowUnauthenticated ?? true,
    skipPaths: config.skipPaths ?? ["/health", "/ready"],
    maxTimestampAge: config.maxTimestampAge ?? 30000,
    enableReplayProtection: config.enableReplayProtection ?? true,
    requiredCertificates: config.requiredCertificates,
    trustedCertifiers: config.trustedCertifiers,
  };
}

/**
 * Check if a path should skip BSV authentication
 */
function shouldSkipPath(pathname: string, skipPaths: string[]): boolean {
  return skipPaths.some((skip) => pathname.startsWith(skip));
}

/**
 * Process BSV authentication for a request
 *
 * This function extracts and verifies BSV identity from request headers,
 * checks owner status if configured, and returns the result.
 *
 * Uses RequestAuthorizer for:
 * - Timing anomaly detection (1-to-1 constraint)
 * - Better replay protection (nonce TTL + cleanup)
 * - Anomaly scoring on every request
 *
 * @param req - Incoming HTTP request
 * @param bsvAuth - Resolved BSV auth configuration
 * @param body - Parsed request body (if any)
 * @returns Authentication result
 */
export async function processBsvAuth(
  req: IncomingMessage,
  bsvAuth: ResolvedBsvAuth,
  body?: string | object,
): Promise<BsvAuthResult> {
  // Check if path should skip authentication
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (shouldSkipPath(url.pathname, bsvAuth.skipPaths)) {
    return { ok: true, isOwner: false };
  }

  // Extract identity from headers
  const extraction = extractIdentityFromHeaders(req, body);

  if (!extraction.success) {
    // No auth headers present
    if (bsvAuth.allowUnauthenticated) {
      return { ok: true, isOwner: false };
    }
    const error = extraction.error!;
    return {
      ok: false,
      status: error.httpStatus,
      error: error.message,
      code: error.code,
    };
  }

  const signedRequest = extraction.signedRequest!;

  // Get or create the RequestAuthorizer with timing monitor
  const authorizer = getRequestAuthorizer({ maxTimestampAgeMs: bsvAuth.maxTimestampAge });

  // Build AuthorizerRequest from signedRequest
  const authorizerRequest: AuthorizerRequest = {
    method: signedRequest.method,
    path: signedRequest.path,
    body: signedRequest.body,
    headers: {
      "x-bsv-identity-key": signedRequest.identityKey,
      "x-bsv-signature": signedRequest.signature,
      "x-bsv-timestamp": signedRequest.timestamp.toString(),
      "x-bsv-nonce": signedRequest.nonce,
    },
  };

  // Use RequestAuthorizer for signature verification, replay protection, and timing analysis
  const authResult = await authorizer.authorize(authorizerRequest);

  if (!authResult.authorized) {
    // Map authorizer rejection reasons to appropriate HTTP status codes
    let status = 401;
    let code = "INVALID_SIGNATURE";

    if (authResult.reason?.includes("Replay")) {
      code = "REPLAY";
    } else if (authResult.reason?.includes("expired")) {
      code = "EXPIRED";
    } else if (authResult.reason?.includes("Concurrent")) {
      code = "CONCURRENT_ACTION";
      status = 429; // Too Many Requests
    } else if (authResult.reason?.includes("Missing")) {
      code = "UNAUTHENTICATED";
    }

    return {
      ok: false,
      status,
      error: authResult.reason ?? "Authorization failed",
      code,
    };
  }

  const shouldVerifyCertificates = (bsvAuth.requiredCertificates?.length ?? 0) > 0;

  // RequestAuthorizer already routes request signature verification through identity-core.
  // Only fall back to verifyIdentity when this consumer actually needs certificate checks.
  let identityContext: IdentityContext;
  if (shouldVerifyCertificates) {
    try {
      identityContext = await verifyIdentity(signedRequest, {
        maxTimestampAge: bsvAuth.maxTimestampAge,
        verifyCertificates: true,
        trustedCertifiers: bsvAuth.trustedCertifiers,
        requiredCertificateTypes: bsvAuth.requiredCertificates,
        // Skip signature verification since RequestAuthorizer already did it
        skipSignatureVerification: true,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        return {
          ok: false,
          status: err.httpStatus,
          error: err.message,
          code: err.code,
        };
      }
      return {
        ok: false,
        status: 500,
        error: "Internal verification error",
        code: "UNKNOWN",
      };
    }
  } else {
    const verifiedAt = Date.now();
    identityContext = {
      identity: {
        identityKey: signedRequest.identityKey,
        lastSeen: verifiedAt,
      },
      identityKey: signedRequest.identityKey,
      certificates: signedRequest.certificates,
      verifiedAt,
      signedRequest,
    };
  }

  // Check owner status
  const isOwner = bsvAuth.ownerPublicKey
    ? publicKeysEqual(identityContext.identityKey, bsvAuth.ownerPublicKey)
    : false;

  // Enforce owner-only if configured
  if (bsvAuth.ownerOnly && !isOwner) {
    return {
      ok: false,
      status: 403,
      error: "Owner access required",
      code: "NOT_OWNER",
    };
  }

  return {
    ok: true,
    identity: identityContext,
    isOwner,
    anomalyScore: authResult.anomalyScore,
    timingVerdict: authResult.timingVerdict,
  };
}

/**
 * Apply BSV auth to a request, attaching identity context if verified
 *
 * @param req - Incoming HTTP request (will be mutated to add bsvAuth)
 * @param bsvAuth - Resolved BSV auth configuration
 * @param body - Parsed request body (if any)
 * @returns Error response if auth failed, undefined if auth passed
 */
export async function applyBsvAuth(
  req: BsvAuthenticatedRequest,
  bsvAuth: ResolvedBsvAuth,
  body?: string | object,
): Promise<{ status: number; error: string; code: string } | undefined> {
  if (!bsvAuth.enabled) {
    return undefined;
  }

  const result = await processBsvAuth(req, bsvAuth, body);

  if (!result.ok) {
    return result;
  }

  // Attach identity context to request (including timing analysis)
  if (result.identity) {
    req.bsvAuth = {
      identity: result.identity.identity,
      identityKey: result.identity.identityKey,
      isOwner: result.isOwner,
      certificates: result.identity.certificates,
      verifiedAt: result.identity.verifiedAt,
      anomalyScore: result.anomalyScore,
      timingVerdict: result.timingVerdict,
    };
  }

  return undefined;
}

/**
 * Send JSON error response for failed BSV auth
 */
export function sendBsvAuthError(
  res: ServerResponse,
  error: { status: number; error: string; code: string },
): void {
  res.statusCode = error.status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: error.error, code: error.code }));
}

/**
 * Type guard to check if request has BSV identity
 */
export function hasBsvIdentity(
  req: IncomingMessage,
): req is BsvAuthenticatedRequest & { bsvAuth: NonNullable<BsvAuthenticatedRequest["bsvAuth"]> } {
  return (req as BsvAuthenticatedRequest).bsvAuth !== undefined;
}

/**
 * Type guard to check if request is from owner
 */
export function isOwnerRequest(req: IncomingMessage): boolean {
  const bsvReq = req as BsvAuthenticatedRequest;
  return bsvReq.bsvAuth?.isOwner === true;
}

/**
 * Get identity key from request (or undefined if not authenticated)
 */
export function getRequestIdentityKey(req: IncomingMessage): PublicKey | undefined {
  const bsvReq = req as BsvAuthenticatedRequest;
  return bsvReq.bsvAuth?.identityKey;
}

// Re-export types for convenience
export type { IdentityContext } from "../auth/identity.js";
export type { AuthenticatedRequest } from "../auth/middleware.js";

/**
 * Utility to get BSV auth context from any request
 * Returns undefined if BSV auth is not enabled or request is unauthenticated
 */
export function getBsvAuth(req: IncomingMessage): BsvAuthenticatedRequest["bsvAuth"] | undefined {
  return (req as BsvAuthenticatedRequest).bsvAuth;
}

/**
 * Require BSV auth context, returning error info if not present
 * Useful for handlers that require authenticated requests
 */
export function requireBsvAuth(
  req: IncomingMessage,
):
  | { ok: true; auth: NonNullable<BsvAuthenticatedRequest["bsvAuth"]> }
  | { ok: false; status: 401; error: string; code: string } {
  const auth = getBsvAuth(req);
  if (!auth) {
    return {
      ok: false,
      status: 401,
      error: "BSV authentication required",
      code: "UNAUTHENTICATED",
    };
  }
  return { ok: true, auth };
}

/**
 * Require owner identity, returning error info if not owner
 */
export function requireOwnerAuth(
  req: IncomingMessage,
):
  | { ok: true; auth: NonNullable<BsvAuthenticatedRequest["bsvAuth"]> }
  | { ok: false; status: number; error: string; code: string } {
  const auth = getBsvAuth(req);
  if (!auth) {
    return {
      ok: false,
      status: 401,
      error: "BSV authentication required",
      code: "UNAUTHENTICATED",
    };
  }
  if (!auth.isOwner) {
    return {
      ok: false,
      status: 403,
      error: "Owner access required",
      code: "NOT_OWNER",
    };
  }
  return { ok: true, auth };
}
