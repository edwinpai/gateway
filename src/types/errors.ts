/**
 * BSV Authentication Error Types
 *
 * Error types and result structures for verification operations.
 * Provides standardized error handling across the authentication system.
 */

import type { VerifiableCertificate } from "./certificates.js";
import type { BSVIdentity } from "./identity.js";
import type { PublicKey } from "./primitives.js";

// =============================================================================
// Verification Error Codes
// =============================================================================

/**
 * Error codes for signature verification failures
 */
export type SignatureVerificationErrorCode =
  | "INVALID_SIGNATURE" // Signature does not match data/key
  | "MALFORMED_SIGNATURE" // Signature format is invalid
  | "INVALID_PUBLIC_KEY" // Public key format is invalid
  | "KEY_MISMATCH" // Signature was made by different key
  | "HASH_MISMATCH" // Data hash doesn't match signed hash
  | "VERIFICATION_FAILED"; // Generic verification failure

/**
 * Error codes for request verification failures
 */
export type RequestVerificationErrorCode =
  | "INVALID_SIGNATURE" // Request signature invalid
  | "EXPIRED" // Request timestamp too old
  | "FUTURE_TIMESTAMP" // Request timestamp in future
  | "REPLAY" // Nonce has been seen before
  | "INVALID_NONCE" // Nonce format invalid
  | "MISSING_HEADER" // Required header missing
  | "INVALID_FORMAT"; // Request format invalid

/**
 * Error codes for certificate verification failures
 */
export type CertificateVerificationErrorCode =
  | "INVALID_CERTIFICATE" // Certificate structure invalid
  | "INVALID_SIGNATURE" // Certifier signature invalid
  | "EXPIRED_CERTIFICATE" // Certificate has expired
  | "REVOKED_CERTIFICATE" // Certificate has been revoked
  | "UNTRUSTED_CERTIFIER" // Certifier not in trust list
  | "MISSING_REQUIRED_FIELD" // Required field not revealed
  | "INVALID_PROOF" // Key linkage proof invalid
  | "SUBJECT_MISMATCH"; // Certificate subject doesn't match requester

/**
 * Error codes for identity verification failures
 */
export type IdentityVerificationErrorCode =
  | "INVALID_IDENTITY_KEY" // Identity key format invalid
  | "IDENTITY_NOT_FOUND" // Identity could not be resolved
  | "UNTRUSTED_IDENTITY" // Identity not in trust list
  | "MISSING_CERTIFICATE" // Required certificate not provided
  | "IDENTITY_MISMATCH"; // Identity doesn't match expected

/**
 * Combined verification error code type
 */
export type VerificationErrorCode =
  | SignatureVerificationErrorCode
  | RequestVerificationErrorCode
  | CertificateVerificationErrorCode
  | IdentityVerificationErrorCode
  | "UNKNOWN"; // Unknown/unexpected error

// =============================================================================
// Verification Result Types
// =============================================================================

/**
 * Base verification result structure
 */
export interface BaseVerificationResult {
  /** Whether verification succeeded */
  valid: boolean;

  /** Error message (if invalid) */
  error?: string;

  /** Error code for programmatic handling */
  errorCode?: VerificationErrorCode;

  /** Timestamp of verification */
  verifiedAt: number;

  /** Additional error details (for debugging) */
  errorDetails?: Record<string, unknown>;
}

/**
 * Result of signature verification
 */
export interface SignatureVerificationResult extends BaseVerificationResult {
  errorCode?: SignatureVerificationErrorCode | "UNKNOWN";

  /** The public key that was verified against */
  publicKey?: PublicKey;
}

/**
 * Result of request verification
 */
export interface RequestVerificationResult extends BaseVerificationResult {
  errorCode?: RequestVerificationErrorCode | "UNKNOWN";

  /** Verified identity (if valid) */
  identity?: BSVIdentity;

  /** Verified certificates (if presented and valid) */
  verifiedCertificates?: VerifiableCertificate[];
}

/**
 * Result of certificate verification
 */
export interface CertificateVerificationResult extends BaseVerificationResult {
  errorCode?: CertificateVerificationErrorCode | "UNKNOWN";

  /** The verified certificate */
  certificate?: VerifiableCertificate;

  /** Revealed field values */
  revealedFields?: Record<string, unknown>;
}

/**
 * Result of identity verification
 */
export interface IdentityVerificationResult extends BaseVerificationResult {
  errorCode?: IdentityVerificationErrorCode | "UNKNOWN";

  /** The verified identity */
  identity?: BSVIdentity;

  /** Verified certificates */
  certificates?: VerifiableCertificate[];
}

/**
 * Combined verification result (for full request + identity + certificate verification)
 */
export interface FullVerificationResult extends BaseVerificationResult {
  /** Verified identity */
  identity?: BSVIdentity;

  /** Verified certificates */
  verifiedCertificates?: VerifiableCertificate[];

  /** Sub-results for detailed error tracking */
  subResults?: {
    signature?: SignatureVerificationResult;
    request?: RequestVerificationResult;
    certificates?: CertificateVerificationResult[];
    identity?: IdentityVerificationResult;
  };
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Base verification error class
 */
export class VerificationError extends Error {
  readonly code: VerificationErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: VerificationErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "VerificationError";
    this.code = code;
    this.details = details;
  }

  toResult(): BaseVerificationResult {
    return {
      valid: false,
      error: this.message,
      errorCode: this.code,
      errorDetails: this.details,
      verifiedAt: Date.now(),
    };
  }
}

/**
 * Signature verification error
 */
export class SignatureError extends VerificationError {
  constructor(
    code: SignatureVerificationErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(code, message, details);
    this.name = "SignatureError";
  }
}

/**
 * Request verification error
 */
export class RequestError extends VerificationError {
  constructor(
    code: RequestVerificationErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(code, message, details);
    this.name = "RequestError";
  }
}

/**
 * Certificate verification error
 */
export class CertificateError extends VerificationError {
  constructor(
    code: CertificateVerificationErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(code, message, details);
    this.name = "CertificateError";
  }
}

/**
 * Identity verification error
 */
export class IdentityError extends VerificationError {
  constructor(
    code: IdentityVerificationErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(code, message, details);
    this.name = "IdentityError";
  }
}

// =============================================================================
// Auth Middleware Error Types
// =============================================================================

/**
 * Error codes specific to authentication middleware
 * Extends verification codes with middleware-specific scenarios
 */
export type AuthErrorCode =
  | VerificationErrorCode
  | "UNAUTHENTICATED" // No auth headers provided
  | "NOT_OWNER" // Request not from owner (ownerOnly mode)
  | "OWNER_CONFIG_MISSING" // ownerOnly enabled but no owner config
  | "AUTHORIZATION_DENIED"; // Custom authorize callback returned false

/**
 * Authentication error for middleware
 * Includes HTTP status code for response generation
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: AuthErrorCode,
    message: string,
    httpStatus?: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.httpStatus = httpStatus ?? authErrorCodeToHttpStatus(code);
    this.details = details;
  }

  /**
   * Convert to JSON for HTTP response body
   */
  toJSON(): { error: string; code: AuthErrorCode; details?: Record<string, unknown> } {
    return {
      error: this.message,
      code: this.code,
      ...(this.details && { details: this.details }),
    };
  }
}

/**
 * Map auth error code to HTTP status code
 */
export function authErrorCodeToHttpStatus(code: AuthErrorCode): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401; // Unauthorized - no credentials provided

    case "NOT_OWNER":
    case "AUTHORIZATION_DENIED":
    case "UNTRUSTED_CERTIFIER":
    case "UNTRUSTED_IDENTITY":
      return 403; // Forbidden - valid auth but not permitted

    case "OWNER_CONFIG_MISSING":
      return 500; // Server misconfiguration

    default:
      // Fall back to general error code mapping
      return errorCodeToHttpStatus(code as VerificationErrorCode);
  }
}

// =============================================================================
// Error Utilities
// =============================================================================

/**
 * Create a successful verification result
 */
export function successResult<T extends BaseVerificationResult>(
  extras?: Partial<Omit<T, "valid" | "verifiedAt">>,
): T {
  return {
    valid: true,
    verifiedAt: Date.now(),
    ...extras,
  } as T;
}

/**
 * Create a failed verification result
 */
export function failureResult<T extends BaseVerificationResult>(
  error: string,
  errorCode: VerificationErrorCode = "UNKNOWN",
  extras?: Partial<Omit<T, "valid" | "verifiedAt" | "error" | "errorCode">>,
): T {
  return {
    valid: false,
    error,
    errorCode,
    verifiedAt: Date.now(),
    ...extras,
  } as T;
}

/**
 * Check if a result indicates success
 */
export function isSuccessResult(result: BaseVerificationResult): boolean {
  return result.valid;
}

/**
 * Check if a result indicates a specific error
 */
export function hasErrorCode(result: BaseVerificationResult, code: VerificationErrorCode): boolean {
  return result.errorCode === code;
}

/**
 * Map error code to HTTP status code
 */
export function errorCodeToHttpStatus(code: VerificationErrorCode): number {
  switch (code) {
    case "INVALID_SIGNATURE":
    case "MALFORMED_SIGNATURE":
    case "INVALID_PUBLIC_KEY":
    case "INVALID_NONCE":
    case "INVALID_FORMAT":
    case "INVALID_CERTIFICATE":
    case "MISSING_HEADER":
    case "MISSING_REQUIRED_FIELD":
      return 400; // Bad Request

    case "KEY_MISMATCH":
    case "INVALID_PROOF":
    case "SUBJECT_MISMATCH":
    case "VERIFICATION_FAILED":
    case "HASH_MISMATCH":
      return 401; // Unauthorized

    case "UNTRUSTED_CERTIFIER":
    case "UNTRUSTED_IDENTITY":
      return 403; // Forbidden

    case "IDENTITY_NOT_FOUND":
    case "IDENTITY_MISMATCH":
      return 404; // Not Found

    case "EXPIRED":
    case "EXPIRED_CERTIFICATE":
    case "REVOKED_CERTIFICATE":
    case "FUTURE_TIMESTAMP":
      return 410; // Gone (expired/revoked)

    case "REPLAY":
      return 409; // Conflict (nonce already used)

    case "MISSING_CERTIFICATE":
    case "INVALID_IDENTITY_KEY":
      return 422; // Unprocessable Entity

    case "UNKNOWN":
    default:
      return 500; // Internal Server Error
  }
}
