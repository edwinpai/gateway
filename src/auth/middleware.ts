/**
 * BSV Authentication Middleware
 *
 * Express-compatible middleware for authenticating requests using BRC-103
 * peer-to-peer mutual authentication via BRC-104 HTTP transport.
 *
 * @see https://github.com/bitcoin-sv/BRCs/blob/master/peer-to-peer/0103.md
 * @see https://github.com/bitcoin-sv/BRCs/blob/master/peer-to-peer/0104.md
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { OwnerConfig, AuthenticatedRequestContext } from "../types/middleware.js";
import type {
  AuthMiddlewareOptions,
  NonceStore,
  BSVIdentity,
  VerificationResult,
  PublicKey,
  VerificationErrorCode,
} from "./types.js";
import { AuthError } from "../types/index.js";
import {
  extractIdentityFromHeaders,
  verifyIdentity,
  type IdentityContext,
  IDENTITY_HEADERS,
} from "./identity.js";
import { createOwnerCheck, publicKeysEqual } from "./owner.js";
import { generateNonce } from "./verification.js";

/**
 * Extended request with BSV identity
 */
export interface AuthenticatedRequest extends IncomingMessage {
  /** Verified BSV identity of the requester */
  bsvIdentity?: BSVIdentity;

  /** Full verification result */
  bsvVerification?: VerificationResult;

  /** Identity context (new unified format) */
  bsvAuth?: AuthenticatedRequestContext;

  /** Parsed body (added by body-parser middleware) */
  body?: string | object;
}

/**
 * Options for the composed identity + owner middleware
 */
export interface OwnerAuthMiddlewareOptions extends AuthMiddlewareOptions {
  /** Require that the authenticated identity is the owner */
  ownerOnly?: boolean;

  /** Owner configuration (required if ownerOnly is true) */
  ownerConfig?: OwnerConfig;
}

/**
 * HTTP headers used for BSV authentication
 */
export const AUTH_HEADERS = {
  /** Requester's identity public key */
  IDENTITY_KEY: "x-bsv-identity-key",

  /** Request signature */
  SIGNATURE: "x-bsv-signature",

  /** Request timestamp (Unix ms) */
  TIMESTAMP: "x-bsv-timestamp",

  /** Request nonce */
  NONCE: "x-bsv-nonce",

  /** Certificates (base64 JSON array) */
  CERTIFICATES: "x-bsv-certificates",
} as const;

/**
 * In-memory nonce store with automatic cleanup
 */
export class InMemoryNonceStore implements NonceStore {
  private nonces = new Map<string, number>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(cleanupIntervalMs = 60000) {
    this.cleanupInterval = setInterval(() => this.cleanup(), cleanupIntervalMs);
  }

  async has(nonce: string): Promise<boolean> {
    return this.nonces.has(nonce);
  }

  async add(nonce: string, expiresAt: number): Promise<void> {
    this.nonces.set(nonce, expiresAt);
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    for (const [nonce, expiresAt] of this.nonces) {
      if (expiresAt < now) {
        this.nonces.delete(nonce);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.nonces.clear();
  }
}

function authErrorToVerificationResult(error: AuthError): VerificationResult {
  return {
    valid: false,
    error: error.message,
    errorCode: error.code as unknown as VerificationErrorCode,
    verifiedAt: Date.now(),
  };
}

/**
 * Create BSV authentication middleware
 *
 * @param options - Middleware configuration
 * @returns Express-compatible middleware function
 */
export function createAuthMiddleware(
  options: AuthMiddlewareOptions,
): (
  req: AuthenticatedRequest,
  res: ServerResponse,
  next: (err?: Error) => void,
) => void | Promise<void> {
  const {
    maxTimestampAge = 30000,
    enableReplayProtection = true,
    nonceStore = new InMemoryNonceStore(),
    trustedCertifiers = [],
    skipPaths = [],
    onError,
    onSuccess,
  } = options;

  return async (req: AuthenticatedRequest, res: ServerResponse, next: (err?: Error) => void) => {
    // Skip authentication for configured paths
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (skipPaths.some((path) => url.pathname.startsWith(path))) {
      return next();
    }

    // Extract signed request from headers
    // Note: Body should be parsed by earlier middleware if needed
    const extraction = extractIdentityFromHeaders(req, req.body);

    if (!extraction.success) {
      const result: VerificationResult = {
        valid: false,
        error: "Missing authentication headers",
        errorCode: "INVALID_SIGNATURE",
        verifiedAt: Date.now(),
      };

      if (onError) {
        onError(result, req);
      }

      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: result.error, code: result.errorCode }));
      return;
    }

    const signedRequest = extraction.signedRequest!;

    // Check for replay attacks
    if (enableReplayProtection) {
      const nonceExists = await nonceStore.has(signedRequest.nonce);
      if (nonceExists) {
        const result: VerificationResult = {
          valid: false,
          error: "Nonce already used (replay attack detected)",
          errorCode: "REPLAY",
          verifiedAt: Date.now(),
        };

        if (onError) {
          onError(result, req);
        }

        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: result.error, code: result.errorCode }));
        return;
      }
    }

    // Verify the signed request through the shared identity-core seam
    let identityContext: IdentityContext;
    try {
      identityContext = await verifyIdentity(signedRequest, {
        maxTimestampAge,
        verifyCertificates: options.requiredCertificates
          ? options.requiredCertificates.length > 0
          : false,
        trustedCertifiers,
        requiredCertificateTypes: options.requiredCertificates,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        const result = authErrorToVerificationResult(err);
        if (onError) {
          onError(result, req);
        }

        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: result.error, code: result.errorCode }));
        return;
      }

      throw err;
    }

    const verification: VerificationResult = {
      valid: true,
      identity: identityContext.identity,
      verifiedCertificates: identityContext.certificates,
      verifiedAt: identityContext.verifiedAt,
    };

    // Store nonce to prevent replay
    if (enableReplayProtection) {
      const nonceExpiry = signedRequest.timestamp + maxTimestampAge * 2;
      await nonceStore.add(signedRequest.nonce, nonceExpiry);
    }

    // Attach identity to request
    req.bsvIdentity = verification.identity;
    req.bsvVerification = verification;

    if (onSuccess && verification.identity) {
      onSuccess(verification.identity, req);
    }

    next();
  };
}

/**
 * Create headers for an authenticated request
 *
 * @param identityKey - Signer's public key
 * @param signature - Request signature
 * @param timestamp - Request timestamp
 * @param nonce - Request nonce
 * @returns Headers object to merge with request
 */
export function createAuthHeaders(
  identityKey: PublicKey,
  signature: string,
  timestamp: number,
  nonce: string,
): Record<string, string> {
  return {
    [AUTH_HEADERS.IDENTITY_KEY]: identityKey,
    [AUTH_HEADERS.SIGNATURE]: signature,
    [AUTH_HEADERS.TIMESTAMP]: timestamp.toString(),
    [AUTH_HEADERS.NONCE]: nonce,
  };
}

/**
 * Utility to sign and send an authenticated request
 */
export interface RequestSigner {
  sign(
    method: string,
    path: string,
    body?: string | object,
  ): Promise<{
    headers: Record<string, string>;
    timestamp: number;
    nonce: string;
  }>;
}

/**
 * Create a request signer using a wallet
 */
export function createRequestSigner(wallet: AuthMiddlewareOptions["wallet"]): RequestSigner {
  return {
    async sign(method: string, path: string, body?: string | object) {
      const timestamp = Date.now();
      const nonce = generateNonce();

      // Get identity key
      const keyResult = await wallet.getPublicKey();
      if (!keyResult.success || !keyResult.result) {
        throw new Error("Failed to get public key from wallet");
      }
      const identityKey = keyResult.result.publicKey;

      // Canonicalize request
      const bodyHash = body ? (typeof body === "string" ? body : JSON.stringify(body)) : "";
      const canonical = `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;

      // Sign with wallet
      const signResult = await wallet.createSignature({
        data: canonical,
        protocolID: [2, "auth"],
        keyID: "request",
        description: `Authenticate ${method} ${path}`,
      });

      if (!signResult.success || !signResult.result) {
        throw new Error("Failed to sign request");
      }

      return {
        headers: createAuthHeaders(identityKey, signResult.result.signature, timestamp, nonce),
        timestamp,
        nonce,
      };
    },
  };
}

/**
 * Middleware that only allows specific identity keys
 */
export function requireIdentities(
  allowedIdentities: PublicKey[],
): (req: AuthenticatedRequest, res: ServerResponse, next: (err?: Error) => void) => void {
  const allowedSet = new Set(allowedIdentities);

  return (req, res, next) => {
    if (!req.bsvIdentity) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Authentication required" }));
      return;
    }

    if (!allowedSet.has(req.bsvIdentity.identityKey)) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Identity not authorized" }));
      return;
    }

    next();
  };
}

/**
 * Middleware that requires specific certificate types
 */
export function requireCertificates(
  requiredTypes: string[],
): (req: AuthenticatedRequest, res: ServerResponse, next: (err?: Error) => void) => void {
  return (req, res, next) => {
    if (!req.bsvVerification?.verifiedCertificates) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Certificate verification required" }));
      return;
    }

    const presentTypes = new Set(
      req.bsvVerification.verifiedCertificates.map((vc) => vc.certificate.type),
    );

    for (const requiredType of requiredTypes) {
      if (!presentTypes.has(requiredType)) {
        res.statusCode = 403;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            error: `Missing required certificate: ${requiredType}`,
          }),
        );
        return;
      }
    }

    next();
  };
}

// =============================================================================
// Composed Identity + Owner Middleware
// =============================================================================

/**
 * Create middleware that composes identity verification with optional owner check.
 *
 * This middleware:
 * 1. Extracts BRC-103 identity from request headers
 * 2. Verifies the signature and identity
 * 3. Optionally checks if the identity matches the configured owner
 * 4. Attaches IdentityContext to request.bsvAuth
 * 5. Rejects non-owner with 403 if ownerOnly is enabled
 *
 * @param options - Middleware configuration
 * @returns Express-compatible middleware function
 *
 * @example Basic identity verification
 * ```typescript
 * const authMiddleware = createOwnerAuthMiddleware({
 *   wallet: myWallet,
 * });
 * app.use('/api', authMiddleware);
 * ```
 *
 * @example Owner-only access
 * ```typescript
 * const ownerMiddleware = createOwnerAuthMiddleware({
 *   wallet: myWallet,
 *   ownerOnly: true,
 *   ownerConfig: {
 *     ownerPublicKey: '02abc...',
 *   },
 * });
 * app.use('/admin', ownerMiddleware);
 * ```
 */
export function createOwnerAuthMiddleware(
  options: OwnerAuthMiddlewareOptions,
): (
  req: AuthenticatedRequest,
  res: ServerResponse,
  next: (err?: Error) => void,
) => void | Promise<void> {
  const {
    maxTimestampAge = 30000,
    enableReplayProtection = true,
    nonceStore = new InMemoryNonceStore(),
    trustedCertifiers = [],
    skipPaths = [],
    ownerOnly = false,
    ownerConfig,
    onError,
    onSuccess,
  } = options;

  // Validate owner config if ownerOnly is enabled
  if (ownerOnly && !ownerConfig) {
    throw new Error("ownerConfig is required when ownerOnly is true");
  }

  // Pre-create owner check function if needed
  const ownerCheck = ownerOnly && ownerConfig ? createOwnerCheck(ownerConfig) : null;

  return async (req: AuthenticatedRequest, res: ServerResponse, next: (err?: Error) => void) => {
    try {
      // Skip authentication for configured paths
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (skipPaths.some((path) => url.pathname.startsWith(path))) {
        return next();
      }

      // Step 1: Extract identity from headers
      const extraction = extractIdentityFromHeaders(req, req.body);

      if (!extraction.success) {
        const error = extraction.error!;
        if (onError) {
          onError(
            {
              valid: false,
              error: error.message,
              errorCode: error.code as unknown as VerificationErrorCode,
              verifiedAt: Date.now(),
            },
            req,
          );
        }
        res.statusCode = error.httpStatus;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(error.toJSON()));
        return;
      }

      const signedRequest = extraction.signedRequest!;

      // Step 2: Check for replay attacks
      if (enableReplayProtection) {
        const nonceExists = await nonceStore.has(signedRequest.nonce);
        if (nonceExists) {
          const authError = new AuthError(
            "REPLAY",
            "Nonce already used (replay attack detected)",
            401,
          );
          if (onError) {
            onError(
              {
                valid: false,
                error: authError.message,
                errorCode: "REPLAY",
                verifiedAt: Date.now(),
              },
              req,
            );
          }
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(authError.toJSON()));
          return;
        }
      }

      // Step 3: Verify identity
      let identityContext: IdentityContext;
      try {
        identityContext = await verifyIdentity(signedRequest, {
          maxTimestampAge,
          verifyCertificates: options.requiredCertificates
            ? options.requiredCertificates.length > 0
            : false,
          trustedCertifiers,
          requiredCertificateTypes: options.requiredCertificates,
        });
      } catch (err) {
        if (err instanceof AuthError) {
          if (onError) {
            onError(
              {
                valid: false,
                error: err.message,
                errorCode: err.code as unknown as VerificationErrorCode,
                verifiedAt: Date.now(),
              },
              req,
            );
          }
          res.statusCode = err.httpStatus;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(err.toJSON()));
          return;
        }
        throw err;
      }

      // Step 4: Owner check (if enabled)
      if (ownerCheck) {
        try {
          await ownerCheck(identityContext);
        } catch (err) {
          if (err instanceof AuthError) {
            if (onError) {
              onError(
                {
                  valid: false,
                  error: err.message,
                  errorCode: err.code as unknown as VerificationErrorCode,
                  verifiedAt: Date.now(),
                },
                req,
              );
            }
            res.statusCode = err.httpStatus;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(err.toJSON()));
            return;
          }
          throw err;
        }
      }

      // Step 5: Store nonce to prevent replay
      if (enableReplayProtection) {
        const nonceExpiry = signedRequest.timestamp + maxTimestampAge * 2;
        await nonceStore.add(signedRequest.nonce, nonceExpiry);
      }

      // Step 6: Attach identity context to request
      req.bsvAuth = {
        identity: identityContext.identity,
        signedRequest: {
          ...signedRequest,
          verifiedIdentity: identityContext.identity,
          verifiedAt: identityContext.verifiedAt,
          verifiedCertificates: identityContext.certificates,
        },
        certificates: identityContext.certificates,
        verifiedAt: identityContext.verifiedAt,
      };

      // Also populate legacy fields for backwards compatibility
      req.bsvIdentity = identityContext.identity;
      req.bsvVerification = {
        valid: true,
        identity: identityContext.identity,
        verifiedCertificates: identityContext.certificates,
        verifiedAt: identityContext.verifiedAt,
      };

      if (onSuccess) {
        onSuccess(identityContext.identity, req);
      }

      next();
    } catch (err) {
      // Unexpected error
      const error = err instanceof Error ? err : new Error(String(err));
      if (onError) {
        onError(
          {
            valid: false,
            error: error.message,
            errorCode: "UNKNOWN",
            verifiedAt: Date.now(),
          },
          req,
        );
      }
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Internal server error", code: "UNKNOWN" }));
    }
  };
}

/**
 * Middleware that requires the request to be from the configured owner.
 * Use after createAuthMiddleware or createOwnerAuthMiddleware.
 *
 * @param ownerConfig - Owner configuration
 * @returns Express-compatible middleware function
 *
 * @example
 * ```typescript
 * app.use('/api', createAuthMiddleware({ wallet }));
 * app.use('/admin', requireOwner({ ownerPublicKey: '02abc...' }));
 * ```
 */
export function requireOwner(
  ownerConfig: OwnerConfig,
): (
  req: AuthenticatedRequest,
  res: ServerResponse,
  next: (err?: Error) => void,
) => void | Promise<void> {
  const ownerCheck = createOwnerCheck(ownerConfig);

  return async (req, res, next) => {
    // Check for identity context
    const identityContext = req.bsvAuth;
    if (!identityContext) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Authentication required", code: "UNAUTHENTICATED" }));
      return;
    }

    try {
      // Create a minimal identity context for the owner check
      await ownerCheck({
        identity: identityContext.identity,
        identityKey: identityContext.identity.identityKey,
        certificates: identityContext.certificates,
        verifiedAt: identityContext.verifiedAt,
        signedRequest: identityContext.signedRequest,
      });
      next();
    } catch (err) {
      if (err instanceof AuthError) {
        res.statusCode = err.httpStatus;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(err.toJSON()));
        return;
      }
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Internal server error", code: "UNKNOWN" }));
    }
  };
}

// Re-export identity types for convenience
export { type IdentityContext, IDENTITY_HEADERS } from "./identity.js";
export { publicKeysEqual, type OwnerVerificationResult } from "./owner.js";
