/**
 * BSV Authentication Middleware Types
 *
 * Types for Express/HTTP middleware implementing BRC-103 authentication.
 * Provides configuration options and callback types for request verification.
 *
 * @see BRC-103: Peer-to-peer Authentication
 * @see BRC-100: Wallet Interface (for cryptographic operations)
 */

import type { VerifiableCertificate } from "./certificates.js";
import type { RequestVerificationResult } from "./errors.js";
import type { BSVIdentity, SignedRequest, VerifiedRequest } from "./identity.js";
import type { PublicKey } from "./primitives.js";
import type { WalletInterface } from "./wallet.js";

// =============================================================================
// Nonce Store Interface
// =============================================================================

/**
 * Nonce store interface for replay attack prevention
 * Implementations can use in-memory, Redis, or other storage backends
 */
export interface NonceStore {
  /**
   * Check if nonce has been seen before
   * @param nonce - The nonce to check
   * @returns true if nonce exists (replay attack)
   */
  has(nonce: string): Promise<boolean>;

  /**
   * Add nonce to store with expiration
   * @param nonce - The nonce to store
   * @param expiresAt - Unix timestamp (ms) when nonce should expire
   */
  add(nonce: string, expiresAt: number): Promise<void>;

  /**
   * Clean up expired nonces
   * Should be called periodically to prevent memory leaks
   */
  cleanup(): Promise<void>;

  /**
   * Optional: Get current nonce count (for monitoring)
   */
  size?(): Promise<number>;
}

/**
 * In-memory nonce store options
 */
export interface InMemoryNonceStoreOptions {
  /** Maximum number of nonces to store (default: 10000) */
  maxSize?: number;

  /** Cleanup interval in milliseconds (default: 60000) */
  cleanupInterval?: number;
}

// =============================================================================
// Verification Callbacks
// =============================================================================

/**
 * Callback invoked when verification fails
 * Use for logging, metrics, or custom error responses
 */
export type VerificationErrorCallback = (
  error: RequestVerificationResult,
  request: unknown,
  response: unknown,
) => void | Promise<void>;

/**
 * Callback invoked on successful verification
 * Use for logging, metrics, or attaching identity to request context
 */
export type VerificationSuccessCallback = (
  identity: BSVIdentity,
  request: unknown,
  verifiedCertificates?: VerifiableCertificate[],
) => void | Promise<void>;

/**
 * Custom authorization check callback
 * Return false to reject the request even if signature is valid
 */
export type AuthorizationCallback = (
  identity: BSVIdentity,
  request: SignedRequest,
  certificates?: VerifiableCertificate[],
) => boolean | Promise<boolean>;

/**
 * Identity resolver callback
 * Custom logic to resolve/enhance identity from public key
 */
export type IdentityResolverCallback = (
  identityKey: PublicKey,
) => BSVIdentity | null | Promise<BSVIdentity | null>;

// =============================================================================
// Owner Configuration
// =============================================================================

/**
 * Configuration for determining the owner/server identity public key
 * Used for ownerOnly mode to restrict access to the server owner
 *
 * @see BRC-103 - Server identity verification
 */
export interface OwnerConfig {
  /**
   * Static owner public key (compressed, 33 bytes hex)
   * Use this when the owner key is known at configuration time
   */
  ownerPublicKey?: PublicKey;

  /**
   * Async function to retrieve the owner public key
   * Use this for dynamic owner resolution (e.g., from wallet)
   */
  getOwnerPublicKey?: () => Promise<PublicKey>;

  /**
   * Whether to cache the resolved owner key (default: true)
   * Only applies when using getOwnerPublicKey
   */
  cacheOwnerKey?: boolean;
}

// =============================================================================
// Middleware Options
// =============================================================================

/**
 * Configuration options for BSV authentication middleware
 * Based on BRC-103 mutual authentication specification
 */
export interface AuthMiddlewareOptions {
  /** Wallet interface for cryptographic operations */
  wallet: WalletInterface;

  // --- Authentication Mode Flags ---

  /**
   * Allow requests without valid BRC-103 authentication (default: false)
   * When true, unauthenticated requests pass through with req.bsvAuth = undefined
   * When false, unauthenticated requests receive 401 Unauthorized
   *
   * @see auth-express-middleware allowUnauthenticated option
   */
  allowUnauthenticated?: boolean;

  /**
   * Restrict access to the server owner only (default: false)
   * When true, only requests from the owner's identity key are allowed
   * Requires ownerConfig to be set
   */
  ownerOnly?: boolean;

  /**
   * Owner configuration for ownerOnly mode
   * Specifies how to determine the server owner's identity key
   */
  ownerConfig?: OwnerConfig;

  // --- Certificate Requirements ---

  /** Required certificate types for access */
  requiredCertificates?: string[];

  /** Required certificate fields to reveal */
  requiredFields?: string[];

  /** Trusted certifiers (identity public keys) */
  trustedCertifiers?: PublicKey[];

  // --- Timing Configuration ---

  /** Maximum age of request timestamp in milliseconds (default: 30000) */
  maxTimestampAge?: number;

  /** Allow future timestamps by this many milliseconds (default: 5000) */
  maxFutureTimestamp?: number;

  // --- Replay Protection ---

  /** Enable nonce tracking for replay protection (default: true) */
  enableReplayProtection?: boolean;

  /** Custom nonce storage implementation (default: in-memory) */
  nonceStore?: NonceStore;

  /** Nonce expiration time in milliseconds (default: maxTimestampAge * 2) */
  nonceExpiration?: number;

  // --- Path Configuration ---

  /** Skip verification for certain paths (e.g., health checks, public endpoints) */
  skipPaths?: string[];

  /** Skip verification based on custom logic */
  skipVerification?: (request: unknown) => boolean | Promise<boolean>;

  // --- Callbacks ---

  /** Custom error handler */
  onError?: VerificationErrorCallback;

  /** Custom success handler */
  onSuccess?: VerificationSuccessCallback;

  /** Custom authorization check (after signature verification) */
  authorize?: AuthorizationCallback;

  /** Custom identity resolver */
  resolveIdentity?: IdentityResolverCallback;

  // --- Request Parsing ---

  /** Header name for identity key (default: 'x-bsv-identity-key') */
  identityKeyHeader?: string;

  /** Header name for signature (default: 'x-bsv-signature') */
  signatureHeader?: string;

  /** Header name for timestamp (default: 'x-bsv-timestamp') */
  timestampHeader?: string;

  /** Header name for nonce (default: 'x-bsv-nonce') */
  nonceHeader?: string;

  /** Header name for certificates (default: 'x-bsv-certificates') */
  certificatesHeader?: string;

  // --- Error Responses ---

  /** Include error details in response (default: false in production) */
  includeErrorDetails?: boolean;

  /** Custom error response formatter */
  formatErrorResponse?: (result: RequestVerificationResult) => unknown;
}

/**
 * Minimal middleware options (wallet only required)
 */
export type MinimalAuthMiddlewareOptions = Pick<AuthMiddlewareOptions, "wallet"> &
  Partial<AuthMiddlewareOptions>;

// =============================================================================
// Middleware Result Types
// =============================================================================

/**
 * Extended request object with verified identity attached
 * Used by middleware to pass identity to route handlers
 */
export interface AuthenticatedRequestContext {
  /** The verified BSV identity */
  identity: BSVIdentity;

  /** The original signed request data */
  signedRequest: VerifiedRequest;

  /** Verified certificates (if any were presented) */
  certificates?: VerifiableCertificate[];

  /** Timestamp when verification occurred */
  verifiedAt: number;
}

/**
 * Express-compatible request with BSV auth context
 */
export interface BSVAuthenticatedRequest extends Record<string, unknown> {
  /** BSV authentication context (set by middleware) */
  bsvAuth?: AuthenticatedRequestContext;
}

// =============================================================================
// Middleware Factory Types
// =============================================================================

/**
 * Express-compatible middleware function signature
 */
export type ExpressMiddleware<TReq = unknown, TRes = unknown> = (
  req: TReq,
  res: TRes,
  next: (error?: unknown) => void,
) => void | Promise<void>;

/**
 * Factory function for creating auth middleware
 */
export type AuthMiddlewareFactory = (options: AuthMiddlewareOptions) => ExpressMiddleware;

// =============================================================================
// Request Extraction Types
// =============================================================================

/**
 * Extracted authentication data from HTTP request
 */
export interface ExtractedAuthData {
  /** Identity public key */
  identityKey: PublicKey;

  /** Request signature */
  signature: string;

  /** Request timestamp (Unix ms) */
  timestamp: number;

  /** Nonce for replay protection */
  nonce: string;

  /** Certificates (if provided) */
  certificates?: VerifiableCertificate[];

  /** HTTP method */
  method: string;

  /** Request path */
  path: string;

  /** Request body (if any) */
  body?: string | object;
}

/**
 * Result of extracting auth data from request
 */
export interface AuthDataExtractionResult {
  /** Whether extraction succeeded */
  success: boolean;

  /** Extracted data (if successful) */
  data?: ExtractedAuthData;

  /** Error message (if failed) */
  error?: string;

  /** Missing headers (if applicable) */
  missingHeaders?: string[];
}
