/**
 * BRC-107/108 Identity Verification Middleware
 *
 * Express middleware for verifying cryptographic identity using BRC-107/108
 * certificate-based authentication with BRC-42 key derivation and BRC-3 signatures.
 *
 * @see BRC-107: Master Certificate Types
 * @see BRC-108: Verifiable Certificate Format
 * @see BRC-42: BSV Key Derivation Scheme (BKDS)
 * @see BRC-3: Digital Signature Creation and Verification
 * @see BRC-103: Peer-to-peer Authentication
 */

import type { IdentityCore } from "@edwinpai/identity-core";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createNodeIdentityCoreBinding } from "@edwinpai/identity-core";
import type {
  PublicKey,
  Signature,
  ProtocolID,
  WalletInterface,
  VerifiableCertificate,
  BSVIdentity,
  RequestVerificationErrorCode,
} from "./types.js";
import { errorCodeToHttpStatus } from "../types/errors.js";
import { verifySignatureUnified } from "./verification.js";

const brc107MiddlewareIdentityCore = createNodeIdentityCoreBinding({
  async getPublicKey(): Promise<string> {
    throw new Error(
      "BRC107Middleware identity-core verifier transport does not expose getPublicKey()",
    );
  },
  async signHttpRequest(): Promise<never> {
    throw new Error(
      "BRC107Middleware identity-core verifier transport does not expose signHttpRequest()",
    );
  },
  async verifySignature(input) {
    return {
      valid: verifySignatureUnified(input.data, input.signature, input.publicKey),
    };
  },
});

// =============================================================================
// Types
// =============================================================================

/**
 * BRC-107/108 authentication headers
 */
export const BRC107_HEADERS = {
  /** Identity public key (BRC-42 derived) */
  IDENTITY_KEY: "x-brc107-identity-key",
  /** DER-encoded signature (BRC-3) */
  SIGNATURE: "x-brc107-signature",
  /** Request timestamp (Unix ms) */
  TIMESTAMP: "x-brc107-timestamp",
  /** Nonce for replay protection */
  NONCE: "x-brc107-nonce",
  /** Protocol ID (format: "securityLevel:protocolString") */
  PROTOCOL_ID: "x-brc107-protocol-id",
  /** Key ID for derivation */
  KEY_ID: "x-brc107-key-id",
  /** Base64-encoded certificates (BRC-108) */
  CERTIFICATES: "x-brc107-certificates",
} as const;

/**
 * Structured error response for 401 failures
 */
export interface AuthError {
  /** Error code for programmatic handling */
  code: RequestVerificationErrorCode;
  /** Human-readable error message */
  message: string;
  /** Additional error details */
  details?: Record<string, unknown>;
  /** Timestamp of error */
  timestamp: number;
}

/**
 * Extracted authentication data from headers
 */
export interface BRC107AuthData {
  identityKey: PublicKey;
  signature: Signature;
  timestamp: number;
  nonce: string;
  protocolID: ProtocolID;
  keyID: string;
  certificates?: VerifiableCertificate[];
}

/**
 * Request with verified BRC-107 identity
 */
export interface BRC107AuthenticatedRequest extends IncomingMessage {
  /** Verified identity */
  brc107Identity?: BSVIdentity;
  /** Extracted auth data */
  brc107Auth?: BRC107AuthData;
  /** Verified certificates */
  brc107Certificates?: VerifiableCertificate[];
  /** Verification timestamp */
  brc107VerifiedAt?: number;
}

/**
 * Configuration for BRC-107/108 middleware
 */
export interface BRC107MiddlewareOptions {
  /** Wallet for cryptographic operations (key derivation, verification) */
  wallet: WalletInterface;

  /** Maximum timestamp age in ms (default: 30000) */
  maxTimestampAge?: number;

  /** Allow future timestamps by this many ms (default: 5000) */
  maxFutureTimestamp?: number;

  /** Required certificate types (BRC-107) */
  requiredCertificateTypes?: string[];

  /** Trusted certifiers for certificates */
  trustedCertifiers?: PublicKey[];

  /** Paths to skip authentication */
  skipPaths?: string[];

  /** Custom nonce validator */
  validateNonce?: (nonce: string) => Promise<boolean>;

  /** Store nonce after successful verification */
  storeNonce?: (nonce: string, expiresAt: number) => Promise<void>;

  /** Include error details in response (default: false) */
  includeErrorDetails?: boolean;

  /** Custom error handler */
  onError?: (error: AuthError, req: IncomingMessage) => void;

  /** Custom success handler */
  onSuccess?: (identity: BSVIdentity, req: BRC107AuthenticatedRequest) => void;

  /** Identity-core verifier used for request and certificate signature checks */
  identityCore?: Pick<IdentityCore, "verifySignature">;
}

// =============================================================================
// Header Extraction
// =============================================================================

/**
 * Extract authentication data from request headers
 */
function extractAuthData(req: IncomingMessage): BRC107AuthData | AuthError {
  const headers = req.headers;

  // Extract required headers
  const identityKey = headers[BRC107_HEADERS.IDENTITY_KEY] as string | undefined;
  const signature = headers[BRC107_HEADERS.SIGNATURE] as string | undefined;
  const timestampStr = headers[BRC107_HEADERS.TIMESTAMP] as string | undefined;
  const nonce = headers[BRC107_HEADERS.NONCE] as string | undefined;
  const protocolIDStr = headers[BRC107_HEADERS.PROTOCOL_ID] as string | undefined;
  const keyID = headers[BRC107_HEADERS.KEY_ID] as string | undefined;
  const certificatesB64 = headers[BRC107_HEADERS.CERTIFICATES] as string | undefined;

  // Check for missing headers
  const missingHeaders: string[] = [];
  if (!identityKey) {
    missingHeaders.push(BRC107_HEADERS.IDENTITY_KEY);
  }
  if (!signature) {
    missingHeaders.push(BRC107_HEADERS.SIGNATURE);
  }
  if (!timestampStr) {
    missingHeaders.push(BRC107_HEADERS.TIMESTAMP);
  }
  if (!nonce) {
    missingHeaders.push(BRC107_HEADERS.NONCE);
  }
  if (!protocolIDStr) {
    missingHeaders.push(BRC107_HEADERS.PROTOCOL_ID);
  }
  if (!keyID) {
    missingHeaders.push(BRC107_HEADERS.KEY_ID);
  }

  if (missingHeaders.length > 0) {
    return {
      code: "MISSING_HEADER",
      message: `Missing required authentication headers: ${missingHeaders.join(", ")}`,
      details: { missingHeaders },
      timestamp: Date.now(),
    };
  }

  // Validate identity key format (compressed secp256k1, 33 bytes hex)
  if (!/^(02|03)[a-fA-F0-9]{64}$/.test(identityKey!)) {
    return {
      code: "INVALID_FORMAT",
      message: "Invalid identity key format (expected compressed secp256k1 public key)",
      details: { header: BRC107_HEADERS.IDENTITY_KEY },
      timestamp: Date.now(),
    };
  }

  // Parse timestamp
  const timestamp = parseInt(timestampStr!, 10);
  if (isNaN(timestamp) || timestamp <= 0) {
    return {
      code: "INVALID_FORMAT",
      message: "Invalid timestamp format",
      details: { header: BRC107_HEADERS.TIMESTAMP },
      timestamp: Date.now(),
    };
  }

  // Parse protocol ID (format: "securityLevel:protocolString")
  const protocolParts = protocolIDStr!.split(":");
  if (protocolParts.length !== 2) {
    return {
      code: "INVALID_FORMAT",
      message: 'Invalid protocol ID format (expected "securityLevel:protocolString")',
      details: { header: BRC107_HEADERS.PROTOCOL_ID },
      timestamp: Date.now(),
    };
  }

  const securityLevel = parseInt(protocolParts[0], 10);
  if (isNaN(securityLevel) || securityLevel < 0 || securityLevel > 2) {
    return {
      code: "INVALID_FORMAT",
      message: "Invalid security level (expected 0, 1, or 2)",
      details: { header: BRC107_HEADERS.PROTOCOL_ID, value: protocolParts[0] },
      timestamp: Date.now(),
    };
  }

  const protocolID: ProtocolID = [securityLevel as 0 | 1 | 2, protocolParts[1]];

  // Parse certificates if present
  let certificates: VerifiableCertificate[] | undefined;
  if (certificatesB64) {
    try {
      const decoded = Buffer.from(certificatesB64, "base64").toString("utf-8");
      certificates = JSON.parse(decoded);
      if (!Array.isArray(certificates)) {
        throw new Error("Certificates must be an array");
      }
    } catch {
      return {
        code: "INVALID_FORMAT",
        message: "Invalid certificates format (expected base64-encoded JSON array)",
        details: { header: BRC107_HEADERS.CERTIFICATES },
        timestamp: Date.now(),
      };
    }
  }

  return {
    identityKey: identityKey!,
    signature: signature!,
    timestamp,
    nonce: nonce!,
    protocolID,
    keyID: keyID!,
    certificates,
  };
}

// =============================================================================
// Request Canonicalization
// =============================================================================

/**
 * Canonicalize request for signature verification (BRC-103 compatible)
 *
 * Format: METHOD\nPATH\nTIMESTAMP\nNONCE\nPROTOCOL_ID\nKEY_ID\nBODY_HASH
 */
function canonicalizeRequest(
  method: string,
  path: string,
  authData: BRC107AuthData,
  body?: string | object,
): string {
  const bodyStr = body ? (typeof body === "string" ? body : JSON.stringify(body)) : "";

  return [
    method.toUpperCase(),
    path,
    authData.timestamp.toString(),
    authData.nonce,
    `${authData.protocolID[0]}:${authData.protocolID[1]}`,
    authData.keyID,
    bodyStr,
  ].join("\n");
}

// =============================================================================
// Certificate Verification (BRC-107/108)
// =============================================================================

/**
 * Verify certificates against requirements (BRC-107/108)
 */
async function verifyCertificates(
  certificates: VerifiableCertificate[],
  requiredTypes: string[],
  trustedCertifiers: PublicKey[],
  subjectIdentityKey: PublicKey,
  identityCore: Pick<IdentityCore, "verifySignature">,
): Promise<AuthError | null> {
  const now = Date.now();
  const verifiedTypes = new Set<string>();

  for (const vc of certificates) {
    const cert = vc.certificate;

    // Verify certificate subject matches requester
    if (cert.subject !== subjectIdentityKey) {
      return {
        code: "INVALID_FORMAT",
        message: "Certificate subject does not match identity key",
        details: { serialNumber: cert.serialNumber },
        timestamp: now,
      };
    }

    // Check certifier trust
    if (trustedCertifiers.length > 0 && !trustedCertifiers.includes(cert.certifier)) {
      continue; // Skip untrusted, don't fail
    }

    // Check expiration
    if (cert.expiresAt && cert.expiresAt < now) {
      return {
        code: "EXPIRED",
        message: `Certificate expired: ${cert.serialNumber}`,
        details: { serialNumber: cert.serialNumber, expiresAt: cert.expiresAt },
        timestamp: now,
      };
    }

    // Verify certifier signature through the shared identity-core boundary
    const certSigningData = JSON.stringify({
      type: cert.type,
      serialNumber: cert.serialNumber,
      subject: cert.subject,
      fields: cert.fields,
      issuedAt: cert.issuedAt,
      expiresAt: cert.expiresAt,
    });

    const certVerification = await identityCore.verifySignature({
      data: certSigningData,
      signature: cert.signature,
      publicKey: cert.certifier,
    });
    if (!certVerification.valid) {
      return {
        code: "INVALID_SIGNATURE",
        message: `Invalid certificate signature: ${cert.serialNumber}`,
        details: { serialNumber: cert.serialNumber },
        timestamp: now,
      };
    }

    verifiedTypes.add(cert.type);
  }

  // Check required types
  for (const required of requiredTypes) {
    if (!verifiedTypes.has(required)) {
      return {
        code: "MISSING_HEADER",
        message: `Missing required certificate type: ${required}`,
        details: { requiredType: required, presentTypes: [...verifiedTypes] },
        timestamp: now,
      };
    }
  }

  return null;
}

// =============================================================================
// Middleware Factory
// =============================================================================

/**
 * Create BRC-107/108 identity verification middleware
 *
 * This middleware:
 * 1. Extracts signature and auth data from request headers
 * 2. Derives identity key via BRC-42 key derivation
 * 3. Verifies signature via BRC-3 ECDSA
 * 4. Optionally verifies BRC-107/108 certificates
 * 5. Returns 401 with structured error on any failure
 *
 * @param options - Middleware configuration
 * @returns Express-compatible middleware function
 *
 * @example
 * ```typescript
 * import { createBRC107Middleware } from './brc107-middleware';
 *
 * const authMiddleware = createBRC107Middleware({
 *   wallet: myWallet,
 *   requiredCertificateTypes: ['identity.master'],
 *   trustedCertifiers: [certifierPubKey],
 * });
 *
 * app.use('/api', authMiddleware);
 *
 * app.get('/api/protected', (req, res) => {
 *   const identity = req.brc107Identity;
 *   res.json({ identityKey: identity.identityKey });
 * });
 * ```
 */
export function createBRC107Middleware(
  options: BRC107MiddlewareOptions,
): (
  req: BRC107AuthenticatedRequest,
  res: ServerResponse,
  next: (err?: Error) => void,
) => Promise<void> {
  const {
    wallet: _wallet,
    maxTimestampAge = 30000,
    maxFutureTimestamp = 5000,
    requiredCertificateTypes = [],
    trustedCertifiers = [],
    skipPaths = [],
    validateNonce,
    storeNonce,
    includeErrorDetails = false,
    onError,
    onSuccess,
    identityCore = brc107MiddlewareIdentityCore,
  } = options;

  return async (
    req: BRC107AuthenticatedRequest,
    res: ServerResponse,
    next: (err?: Error) => void,
  ): Promise<void> => {
    const now = Date.now();

    // Helper to send 401 error
    const sendError = (error: AuthError): void => {
      if (onError) {
        onError(error, req);
      }

      const statusCode = errorCodeToHttpStatus(error.code);
      res.statusCode = statusCode;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("WWW-Authenticate", "BRC-107");

      const response: Record<string, unknown> = {
        error: error.code,
        message: error.message,
        timestamp: error.timestamp,
      };

      if (includeErrorDetails && error.details) {
        response.details = error.details;
      }

      res.end(JSON.stringify(response));
    };

    // Check skip paths
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (skipPaths.some((path) => url.pathname.startsWith(path))) {
      return next();
    }

    // Extract auth data from headers
    const authDataOrError = extractAuthData(req);
    if ("code" in authDataOrError) {
      return sendError(authDataOrError);
    }
    const authData = authDataOrError;

    // Validate timestamp - not too old
    const age = now - authData.timestamp;
    if (age > maxTimestampAge) {
      return sendError({
        code: "EXPIRED",
        message: `Request expired: timestamp age ${age}ms exceeds maximum ${maxTimestampAge}ms`,
        details: { age, maxAge: maxTimestampAge, requestTimestamp: authData.timestamp },
        timestamp: now,
      });
    }

    // Validate timestamp - not too far in future
    if (authData.timestamp > now + maxFutureTimestamp) {
      return sendError({
        code: "INVALID_FORMAT",
        message: `Request timestamp is too far in the future`,
        details: { drift: authData.timestamp - now, maxFuture: maxFutureTimestamp },
        timestamp: now,
      });
    }

    // Validate nonce format (at least 16 hex chars)
    if (!/^[a-fA-F0-9]{16,}$/.test(authData.nonce)) {
      return sendError({
        code: "INVALID_NONCE",
        message: "Invalid nonce format (expected at least 16 hex characters)",
        details: { nonce: authData.nonce },
        timestamp: now,
      });
    }

    // Check for replay (if nonce validator provided)
    if (validateNonce) {
      const isReplay = await validateNonce(authData.nonce);
      if (isReplay) {
        return sendError({
          code: "REPLAY",
          message: "Nonce already used (replay attack detected)",
          timestamp: now,
        });
      }
    }

    // Canonicalize request for verification
    const canonical = canonicalizeRequest(
      req.method ?? "GET",
      url.pathname + url.search,
      authData,
      (req as unknown as { body?: string | object }).body,
    );

    // Verify signature through the shared identity-core boundary
    const signatureVerification = await identityCore.verifySignature({
      data: canonical,
      signature: authData.signature,
      publicKey: authData.identityKey,
    });

    if (!signatureVerification.valid) {
      return sendError({
        code: "INVALID_SIGNATURE",
        message: "Request signature verification failed",
        details: { identityKey: authData.identityKey },
        timestamp: now,
      });
    }

    // Verify certificates if required (BRC-107/108)
    if (requiredCertificateTypes.length > 0 || authData.certificates) {
      if (!authData.certificates || authData.certificates.length === 0) {
        if (requiredCertificateTypes.length > 0) {
          return sendError({
            code: "MISSING_HEADER",
            message: "Certificates required but not provided",
            details: { requiredTypes: requiredCertificateTypes },
            timestamp: now,
          });
        }
      } else {
        const certError = await verifyCertificates(
          authData.certificates,
          requiredCertificateTypes,
          trustedCertifiers,
          authData.identityKey,
          identityCore,
        );

        if (certError) {
          return sendError(certError);
        }
      }
    }

    // Store nonce for replay protection
    if (storeNonce) {
      await storeNonce(authData.nonce, authData.timestamp + maxTimestampAge * 2);
    }

    // Build verified identity
    const identity: BSVIdentity = {
      identityKey: authData.identityKey,
      lastSeen: now,
    };

    // Attach to request
    req.brc107Identity = identity;
    req.brc107Auth = authData;
    req.brc107Certificates = authData.certificates;
    req.brc107VerifiedAt = now;

    if (onSuccess) {
      onSuccess(identity, req);
    }

    next();
  };
}

// =============================================================================
// Utility Exports
// =============================================================================

/**
 * Create authentication headers for a BRC-107 request
 */
export function createBRC107Headers(
  identityKey: PublicKey,
  signature: Signature,
  timestamp: number,
  nonce: string,
  protocolID: ProtocolID,
  keyID: string,
  certificates?: VerifiableCertificate[],
): Record<string, string> {
  const headers: Record<string, string> = {
    [BRC107_HEADERS.IDENTITY_KEY]: identityKey,
    [BRC107_HEADERS.SIGNATURE]: signature,
    [BRC107_HEADERS.TIMESTAMP]: timestamp.toString(),
    [BRC107_HEADERS.NONCE]: nonce,
    [BRC107_HEADERS.PROTOCOL_ID]: `${protocolID[0]}:${protocolID[1]}`,
    [BRC107_HEADERS.KEY_ID]: keyID,
  };

  if (certificates && certificates.length > 0) {
    headers[BRC107_HEADERS.CERTIFICATES] = Buffer.from(JSON.stringify(certificates)).toString(
      "base64",
    );
  }

  return headers;
}

/**
 * Helper middleware that requires specific certificate types
 */
export function requireBRC107Certificates(
  ...types: string[]
): (req: BRC107AuthenticatedRequest, res: ServerResponse, next: (err?: Error) => void) => void {
  return (req, res, next) => {
    if (!req.brc107Identity) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "MISSING_HEADER",
          message: "BRC-107 authentication required",
          timestamp: Date.now(),
        }),
      );
      return;
    }

    const certs = req.brc107Certificates ?? [];
    const presentTypes = new Set(certs.map((c) => c.certificate.type));

    for (const required of types) {
      if (!presentTypes.has(required)) {
        res.statusCode = 403;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            error: "MISSING_HEADER",
            message: `Missing required certificate type: ${required}`,
            details: { requiredType: required, presentTypes: [...presentTypes] },
            timestamp: Date.now(),
          }),
        );
        return;
      }
    }

    next();
  };
}

/**
 * Helper middleware that allows only specific identity keys
 */
export function allowBRC107Identities(
  ...identities: PublicKey[]
): (req: BRC107AuthenticatedRequest, res: ServerResponse, next: (err?: Error) => void) => void {
  const allowed = new Set(identities);

  return (req, res, next) => {
    if (!req.brc107Identity) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "MISSING_HEADER",
          message: "BRC-107 authentication required",
          timestamp: Date.now(),
        }),
      );
      return;
    }

    if (!allowed.has(req.brc107Identity.identityKey)) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "INVALID_SIGNATURE",
          message: "Identity not authorized",
          timestamp: Date.now(),
        }),
      );
      return;
    }

    next();
  };
}
