/**
 * BRC-103 Identity Extraction and Verification
 *
 * Extracts and verifies cryptographic identity from HTTP request headers
 * following the BRC-103 peer-to-peer authentication specification.
 *
 * @see https://github.com/bitcoin-sv/BRCs/blob/master/peer-to-peer/0103.md
 * @see https://github.com/bitcoin-sv/BRCs/blob/master/peer-to-peer/0104.md
 */

import type { IncomingMessage } from "node:http";
import type { IdentityCore } from "../../packages/identity-core/src/types.js";
import type {
  PublicKey,
  BSVIdentity,
  SignedRequest,
  VerifiableCertificate,
  AuthErrorCode,
} from "../types/index.js";
import { createNodeIdentityCoreBinding } from "../../packages/identity-core/src/node-binding.js";
import { AuthError } from "../types/index.js";
import { verifySignedRequest, type VerificationOptions } from "./verification.js";

const identityVerificationCore = createNodeIdentityCoreBinding({
  async getPublicKey(): Promise<string> {
    throw new Error("Identity verification transport does not expose getPublicKey()");
  },
  async signHttpRequest(): Promise<never> {
    throw new Error("Identity verification transport does not expose signHttpRequest()");
  },
  async verifyRequest(input, options) {
    const result = verifySignedRequest(input as SignedRequest, options as VerificationOptions);
    return {
      ...result,
      verifiedCertificates: result.verifiedCertificates,
    };
  },
});

/**
 * HTTP headers used for BRC-103/104 authentication
 */
export const IDENTITY_HEADERS = {
  /** Requester's identity public key (compressed, 33 bytes hex) */
  IDENTITY_KEY: "x-bsv-identity-key",
  /** Request signature (DER-encoded, hex) */
  SIGNATURE: "x-bsv-signature",
  /** Request timestamp (Unix ms) */
  TIMESTAMP: "x-bsv-timestamp",
  /** Request nonce (for replay protection) */
  NONCE: "x-bsv-nonce",
  /** Certificates (base64-encoded JSON array) */
  CERTIFICATES: "x-bsv-certificates",
} as const;

/**
 * Result of identity extraction from request headers
 */
export interface IdentityExtractionResult {
  /** Whether extraction succeeded */
  success: boolean;
  /** Extracted signed request (if successful) */
  signedRequest?: SignedRequest;
  /** Error if extraction failed */
  error?: AuthError;
  /** Which headers were missing (if any) */
  missingHeaders?: string[];
}

/**
 * Result of identity verification
 */
export interface IdentityContext {
  /** The verified identity */
  identity: BSVIdentity;
  /** The identity public key */
  identityKey: PublicKey;
  /** Verified certificates (if any) */
  certificates?: VerifiableCertificate[];
  /** When the identity was verified */
  verifiedAt: number;
  /** The original signed request */
  signedRequest: SignedRequest;
}

/**
 * Options for identity extraction and verification
 */
export interface IdentityVerificationOptions extends VerificationOptions {
  /** Whether to allow requests without auth headers (default: false) */
  allowUnauthenticated?: boolean;
  /** Custom header names (overrides defaults) */
  headers?: Partial<typeof IDENTITY_HEADERS>;
  /** Identity-core verifier used for signed request checks */
  identityCore?: Pick<IdentityCore, "verifyRequest">;
}

/**
 * Extract signed request data from HTTP request headers
 *
 * @param req - Incoming HTTP request
 * @param body - Request body (if any, should be parsed by earlier middleware)
 * @param customHeaders - Optional custom header names
 * @returns Extraction result with signed request or error
 */
export function extractIdentityFromHeaders(
  req: IncomingMessage,
  body?: string | object,
  customHeaders?: Partial<typeof IDENTITY_HEADERS>,
): IdentityExtractionResult {
  const headers = { ...IDENTITY_HEADERS, ...customHeaders };
  const reqHeaders = req.headers;

  // Extract header values (case-insensitive)
  const identityKey = reqHeaders[headers.IDENTITY_KEY.toLowerCase()] as string | undefined;
  const signature = reqHeaders[headers.SIGNATURE.toLowerCase()] as string | undefined;
  const timestampStr = reqHeaders[headers.TIMESTAMP.toLowerCase()] as string | undefined;
  const nonce = reqHeaders[headers.NONCE.toLowerCase()] as string | undefined;
  const certificatesStr = reqHeaders[headers.CERTIFICATES.toLowerCase()] as string | undefined;

  // Check for missing required headers
  const missingHeaders: string[] = [];
  if (!identityKey) {
    missingHeaders.push(headers.IDENTITY_KEY);
  }
  if (!signature) {
    missingHeaders.push(headers.SIGNATURE);
  }
  if (!timestampStr) {
    missingHeaders.push(headers.TIMESTAMP);
  }
  if (!nonce) {
    missingHeaders.push(headers.NONCE);
  }

  if (missingHeaders.length > 0) {
    return {
      success: false,
      error: new AuthError(
        "UNAUTHENTICATED",
        `Missing authentication headers: ${missingHeaders.join(", ")}`,
        401,
        { missingHeaders },
      ),
      missingHeaders,
    };
  }

  // Parse timestamp
  const timestamp = parseInt(timestampStr!, 10);
  if (isNaN(timestamp)) {
    return {
      success: false,
      error: new AuthError(
        "INVALID_FORMAT",
        "Invalid timestamp format: must be Unix milliseconds",
        400,
      ),
    };
  }

  // Parse certificates if provided
  let certificates: VerifiableCertificate[] | undefined;
  if (certificatesStr) {
    try {
      const decoded = Buffer.from(certificatesStr, "base64").toString("utf-8");
      certificates = JSON.parse(decoded) as VerifiableCertificate[];
    } catch {
      return {
        success: false,
        error: new AuthError(
          "INVALID_FORMAT",
          "Invalid certificates format: must be base64-encoded JSON array",
          400,
        ),
      };
    }
  }

  // Parse URL to get path
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  const signedRequest: SignedRequest = {
    method: req.method ?? "GET",
    path: url.pathname + url.search,
    body,
    timestamp,
    nonce: nonce!,
    identityKey: identityKey!,
    signature: signature!,
    certificates,
  };

  return {
    success: true,
    signedRequest,
  };
}

/**
 * Verify identity from a signed request
 *
 * @param signedRequest - The signed request to verify
 * @param options - Verification options
 * @returns Identity context if valid, throws AuthError otherwise
 */
export async function verifyIdentity(
  signedRequest: SignedRequest,
  options: IdentityVerificationOptions = {},
): Promise<IdentityContext> {
  const identityCore = options.identityCore ?? identityVerificationCore;
  const result = await identityCore.verifyRequest(signedRequest, options);

  if (!result.valid) {
    throw new AuthError(
      (result.errorCode as AuthErrorCode) ?? "INVALID_SIGNATURE",
      result.error ?? "Identity verification failed",
      401,
      { errorCode: result.errorCode },
    );
  }

  return {
    identity: result.identity as BSVIdentity,
    identityKey: signedRequest.identityKey,
    certificates: result.verifiedCertificates as VerifiableCertificate[] | undefined,
    verifiedAt: result.verifiedAt,
    signedRequest,
  };
}

/**
 * Extract and verify identity from HTTP request in one step
 *
 * @param req - Incoming HTTP request
 * @param body - Request body
 * @param options - Verification options
 * @returns Identity context if valid
 * @throws AuthError if extraction or verification fails
 */
export async function extractAndVerifyIdentity(
  req: IncomingMessage,
  body: string | object | undefined,
  options: IdentityVerificationOptions = {},
): Promise<IdentityContext | null> {
  const extraction = extractIdentityFromHeaders(req, body, options.headers);

  if (!extraction.success) {
    if (options.allowUnauthenticated) {
      return null;
    }
    throw extraction.error!;
  }

  return await verifyIdentity(extraction.signedRequest!, options);
}

/**
 * Type guard to check if a value is an IdentityContext
 */
export function isIdentityContext(value: unknown): value is IdentityContext {
  return (
    typeof value === "object" &&
    value !== null &&
    "identity" in value &&
    "identityKey" in value &&
    "verifiedAt" in value &&
    "signedRequest" in value
  );
}
