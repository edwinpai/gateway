/**
 * Auth Types Index
 *
 * Re-exports all authentication-related types from the modular type definitions.
 * This module serves as the primary import point for auth types.
 */

import type { VerifiableCertificate as _VerifiableCertificate } from "../types/certificates.js";
import type { FullVerificationResult as _FullVerificationResult } from "../types/errors.js";
import type { BSVIdentity as _BSVIdentity } from "../types/identity.js";
// =============================================================================
// Internal Imports (for use in this file's interfaces)
// =============================================================================
import type { PublicKey as _PublicKey, Signature as _Signature } from "../types/primitives.js";
import type { WalletInterface as _WalletInterface } from "../types/wallet.js";

// =============================================================================
// Primitive Types
// =============================================================================
export type {
  HexString,
  Base64String,
  PublicKey,
  Signature,
  Hash256,
} from "../types/primitives.js";

export { isHexString, isCompressedPublicKey, isDERSignature } from "../types/primitives.js";

// =============================================================================
// Key Derivation Types (BRC-42/43)
// =============================================================================
export type {
  SecurityLevel,
  ProtocolID,
  Counterparty,
  KeyDerivationParams,
  DerivedKey,
  BRC42KeyTree,
  KeyLinkageProof,
  KeyTreeManager,
} from "../types/keys.js";

export { protocolIDToString, stringToProtocolID, keyPath } from "../types/keys.js";

// =============================================================================
// Signature Types (BRC-3)
// =============================================================================
export type {
  SignaturePayload,
  SignatureRequest,
  SignatureResponse,
  VerifySignatureRequest,
  VerifySignatureResponse,
  SignedMessage,
} from "../types/signatures.js";

export { parseDERSignature } from "../types/signatures.js";

// =============================================================================
// Certificate Types (BRC-52/107/108)
// =============================================================================
export type {
  Certificate,
  MasterCertificate,
  VerifiableCertificate,
  CertificateFieldValue,
  CertificateFields,
  CertificateDisclosureRequest,
  CertificateDisclosure,
} from "../types/certificates.js";

export {
  getCertificateSigningData,
  isCertificateExpired,
  isMasterCertificate,
} from "../types/certificates.js";

// =============================================================================
// Identity Types (BRC-103)
// =============================================================================
export type {
  IdentityKey,
  BSVIdentity,
  IdentityVerifier,
  IdentityVerificationOptions,
  IdentityVerificationResult,
  IdentityErrorCode,
  AuthenticatedRequest,
  SignedRequest,
  VerifiedRequest,
} from "../types/identity.js";

export { canonicalizeRequest } from "../types/identity.js";

// =============================================================================
// Wallet Types (BRC-56/100)
// =============================================================================
export type {
  WalletResult,
  WalletErrorCode,
  WalletInterface,
  DiscoveryResult,
  WalletConnectionStatus,
  WalletCapabilities,
  EventedWalletInterface,
} from "../types/wallet.js";

// =============================================================================
// Error Types
// =============================================================================
export type {
  VerificationErrorCode,
  SignatureVerificationErrorCode,
  RequestVerificationErrorCode,
  CertificateVerificationErrorCode,
  BaseVerificationResult,
  SignatureVerificationResult,
  RequestVerificationResult,
  CertificateVerificationResult,
  FullVerificationResult,
} from "../types/errors.js";

export {
  VerificationError,
  SignatureError,
  RequestError,
  CertificateError,
  IdentityError,
  successResult,
  failureResult,
  isSuccessResult,
  hasErrorCode,
  errorCodeToHttpStatus,
} from "../types/errors.js";

// =============================================================================
// Legacy Compatibility - VerificationResult alias
// =============================================================================

/**
 * @deprecated Use FullVerificationResult or specific result types instead
 */
export type VerificationResult = _FullVerificationResult;

// =============================================================================
// Middleware Types (kept here as auth-specific)
// =============================================================================

/**
 * Configuration options for BRC-103 authentication middleware.
 *
 * This middleware verifies requests using cryptographic signatures following
 * the BRC-103 peer-to-peer authentication specification.
 *
 * ## Middleware Configuration Options
 *
 * ### Required Options
 *
 * | Option | Type | Description |
 * |--------|------|-------------|
 * | `wallet` | `WalletInterface` | BRC-100 compatible wallet for cryptographic operations |
 *
 * ### Certificate Requirements
 *
 * | Option | Type | Default | Description |
 * |--------|------|---------|-------------|
 * | `requiredCertificates` | `string[]` | `[]` | Certificate types required for access (e.g., `['identity.master']`) |
 * | `requiredFields` | `string[]` | `[]` | Certificate fields that must be revealed |
 * | `trustedCertifiers` | `PublicKey[]` | `[]` | Identity keys of trusted certificate issuers |
 *
 * ### Timing Configuration
 *
 * | Option | Type | Default | Description |
 * |--------|------|---------|-------------|
 * | `maxTimestampAge` | `number` | `30000` | Maximum age of request timestamp in milliseconds |
 *
 * ### Replay Protection
 *
 * | Option | Type | Default | Description |
 * |--------|------|---------|-------------|
 * | `enableReplayProtection` | `boolean` | `true` | Track nonces to prevent replay attacks |
 * | `nonceStore` | `NonceStore` | `InMemoryNonceStore` | Custom nonce storage implementation |
 *
 * ### Path Configuration
 *
 * | Option | Type | Default | Description |
 * |--------|------|---------|-------------|
 * | `skipPaths` | `string[]` | `[]` | Paths to skip authentication (e.g., `['/health', '/public']`) |
 *
 * ### Callbacks
 *
 * | Option | Type | Description |
 * |--------|------|-------------|
 * | `onError` | `(error, req) => void` | Called when verification fails |
 * | `onSuccess` | `(identity, req) => void` | Called on successful verification |
 *
 * @example Basic configuration
 * ```typescript
 * const middleware = createAuthMiddleware({
 *   wallet: myWallet,
 *   maxTimestampAge: 30000,
 *   enableReplayProtection: true,
 * });
 * ```
 *
 * @example With certificates
 * ```typescript
 * const middleware = createAuthMiddleware({
 *   wallet: myWallet,
 *   requiredCertificates: ['identity.master'],
 *   trustedCertifiers: ['02abc...', '03def...'],
 *   skipPaths: ['/health', '/public'],
 *   onError: (result, req) => {
 *     console.error('Auth failed:', result.error);
 *   },
 * });
 * ```
 *
 * @see BRC-103 - Peer-to-peer Authentication
 * @see BRC-100 - Wallet Interface Specification
 */
export interface AuthMiddlewareOptions {
  /**
   * Wallet interface for cryptographic operations.
   * Must implement BRC-100 wallet interface specification.
   *
   * @example
   * ```typescript
   * import { ProtoWallet } from '@bsv/sdk';
   * const wallet = new ProtoWallet();
   * ```
   */
  wallet: _WalletInterface;

  /**
   * Required certificate types for access.
   * Requests must include valid certificates of these types.
   *
   * Common types:
   * - `'identity.master'` - BRC-107 master certificate
   * - `'kyc.basic'` - Basic KYC verification
   * - `'organization.member'` - Organization membership
   *
   * @default []
   * @see BRC-107 - Master Certificate Types
   */
  requiredCertificates?: string[];

  /**
   * Required certificate fields that must be revealed.
   * Only applicable when `requiredCertificates` is set.
   *
   * @default []
   */
  requiredFields?: string[];

  /**
   * Maximum age of request timestamp in milliseconds.
   * Requests with timestamps older than this will be rejected.
   *
   * @default 30000 (30 seconds)
   */
  maxTimestampAge?: number;

  /**
   * Enable nonce tracking for replay attack prevention.
   * When enabled, each nonce can only be used once within the timestamp window.
   *
   * @default true
   */
  enableReplayProtection?: boolean;

  /**
   * Custom nonce storage implementation.
   * Use for distributed systems (Redis, database) instead of in-memory.
   *
   * @default InMemoryNonceStore with 60s cleanup interval
   *
   * @example Redis nonce store
   * ```typescript
   * const redisNonceStore: NonceStore = {
   *   has: (nonce) => redis.exists(`nonce:${nonce}`),
   *   add: (nonce, expiresAt) => redis.setex(`nonce:${nonce}`, ttl, '1'),
   *   cleanup: () => Promise.resolve(), // Redis handles TTL
   * };
   * ```
   */
  nonceStore?: NonceStore;

  /**
   * Trusted certifiers (identity public keys).
   * Only certificates from these certifiers will be accepted.
   * If empty, all certificate signatures are verified but no trust check.
   *
   * @default []
   */
  trustedCertifiers?: _PublicKey[];

  /**
   * Paths to skip authentication.
   * Requests to these paths will bypass verification.
   *
   * Uses prefix matching - `/health` matches `/health`, `/health/check`, etc.
   *
   * @default []
   *
   * @example
   * ```typescript
   * skipPaths: ['/health', '/public', '/api/v1/docs']
   * ```
   */
  skipPaths?: string[];

  /**
   * Custom error handler called when verification fails.
   * Use for logging, metrics, or custom error responses.
   *
   * @param error - Verification result with error details
   * @param req - The incoming request object
   *
   * @example
   * ```typescript
   * onError: (error, req) => {
   *   logger.warn('Auth failed', {
   *     error: error.errorCode,
   *     path: req.url,
   *   });
   *   metrics.increment('auth.failures');
   * }
   * ```
   */
  onError?: (error: _FullVerificationResult, req: unknown) => void;

  /**
   * Custom success handler called after successful verification.
   * Use for logging, metrics, or attaching additional context.
   *
   * @param identity - The verified BSV identity
   * @param req - The incoming request object
   *
   * @example
   * ```typescript
   * onSuccess: (identity, req) => {
   *   logger.info('Authenticated', { identityKey: identity.identityKey });
   *   metrics.increment('auth.success');
   * }
   * ```
   */
  onSuccess?: (identity: _BSVIdentity, req: unknown) => void;
}

/**
 * Nonce store interface for replay attack prevention
 */
export interface NonceStore {
  /** Check if nonce has been seen */
  has(nonce: string): Promise<boolean>;

  /** Add nonce to store */
  add(nonce: string, expiresAt: number): Promise<void>;

  /** Clean up expired nonces */
  cleanup(): Promise<void>;
}

// =============================================================================
// Auth Request/Response Types (kept here as auth-specific)
// =============================================================================

/**
 * Authentication request for peer-to-peer communication
 */
export interface AuthRequest {
  /** Random nonce for preventing replay attacks */
  nonce: string;

  /** Timestamp of request */
  timestamp: number;

  /** Requested certificate types for verification */
  requestedCertificates?: string[];

  /** Requested fields to reveal from certificates */
  requestedFields?: string[];
}

/**
 * Authentication response proving identity
 */
export interface AuthResponse {
  /** Responder's identity public key */
  identityKey: _PublicKey;

  /** Signature over the auth request (proves key ownership) */
  signature: _Signature;

  /** Optional certificates as requested */
  certificates?: _VerifiableCertificate[];

  /** Timestamp of response */
  timestamp: number;
}
