/**
 * BSV Identity Types
 *
 * Core identity types for cryptographic authentication based on BRC specifications.
 * Uses secp256k1 elliptic curve with compressed, DER-formatted public keys.
 *
 * @see BRC-42: BSV Key Derivation Scheme (BKDS)
 * @see BRC-100: Wallet Interface Specification
 * @see BRC-103: Peer-to-peer authentication
 */

import type { Certificate, MasterCertificate, VerifiableCertificate } from "./certificates.js";
import type { ProtocolID, Counterparty } from "./keys.js";
import type { PublicKey, Signature } from "./primitives.js";

// =============================================================================
// Identity Key Types
// =============================================================================

/**
 * Identity key derived via BRC-42 BKDS
 * Uses secp256k1 elliptic curve with compressed, DER-formatted public keys
 */
export interface IdentityKey {
  /** Compressed DER-formatted public key (33 bytes, hex-encoded) */
  publicKey: string;

  /** Protocol ID used for derivation */
  protocolID: ProtocolID;

  /** Key ID within the protocol namespace */
  keyID: string;

  /** Counterparty for key derivation context */
  counterparty?: Counterparty;

  /** Whether this is the root identity key */
  isRootKey?: boolean;
}

// =============================================================================
// BSV Identity
// =============================================================================

/**
 * BSV Identity - cryptographic identity based on secp256k1 key pair
 * Represents an entity in the BSV authentication system
 */
export interface BSVIdentity {
  /** Root identity public key (compressed, 33 bytes hex) */
  identityKey: PublicKey;

  /** Human-readable name (from master certificate if available) */
  name?: string;

  /** Icon/avatar URL or base64 data */
  icon?: string;

  /** Master certificate proving identity attributes */
  masterCertificate?: MasterCertificate;

  /** Additional certificates held by this identity */
  certificates?: Certificate[];

  /** Timestamp when identity was first seen */
  firstSeen?: number;

  /** Timestamp of last interaction */
  lastSeen?: number;
}

// =============================================================================
// Identity Verifier Interface
// =============================================================================

/**
 * Interface for verifying cryptographic identities
 */
export interface IdentityVerifier {
  /**
   * Verify a signature against an identity
   * @param data - Data that was signed
   * @param signature - The signature to verify
   * @param identityKey - Public key of the claimed signer
   * @returns Whether the signature is valid
   */
  verifySignature(
    data: string | Uint8Array,
    signature: Signature,
    identityKey: PublicKey,
  ): Promise<boolean>;

  /**
   * Verify a complete identity with optional certificate requirements
   * @param identity - The identity to verify
   * @param options - Verification options
   */
  verifyIdentity(
    identity: BSVIdentity,
    options?: IdentityVerificationOptions,
  ): Promise<IdentityVerificationResult>;

  /**
   * Resolve an identity by public key
   * @param identityKey - The identity key to look up
   */
  resolveIdentity(identityKey: PublicKey): Promise<BSVIdentity | null>;
}

/**
 * Options for identity verification
 */
export interface IdentityVerificationOptions {
  /** Required certificate types */
  requiredCertificates?: string[];

  /** Trusted certifier public keys */
  trustedCertifiers?: PublicKey[];

  /** Whether to verify certificate signatures */
  verifyCertificateSignatures?: boolean;

  /** Check certificate expiration */
  checkExpiration?: boolean;
}

/**
 * Result of identity verification
 */
export interface IdentityVerificationResult {
  /** Whether verification succeeded */
  valid: boolean;

  /** The verified identity (if valid) */
  identity?: BSVIdentity;

  /** Verified certificates */
  verifiedCertificates?: VerifiableCertificate[];

  /** Error message if invalid */
  error?: string;

  /** Error code for programmatic handling */
  errorCode?: IdentityErrorCode;
}

export type IdentityErrorCode =
  | "INVALID_KEY"
  | "INVALID_SIGNATURE"
  | "MISSING_CERTIFICATE"
  | "INVALID_CERTIFICATE"
  | "EXPIRED_CERTIFICATE"
  | "UNTRUSTED_CERTIFIER"
  | "UNKNOWN";

// =============================================================================
// Authenticated Request Types
// =============================================================================

/**
 * Base interface for authenticated HTTP requests
 * Based on BRC-103 mutual authentication
 */
export interface AuthenticatedRequest {
  /** HTTP method */
  method: string;

  /** Request path (without host) */
  path: string;

  /** Request body (if any) */
  body?: string | object;

  /** Timestamp of request (Unix ms) */
  timestamp: number;

  /** Random nonce to prevent replay attacks */
  nonce: string;

  /** Requester's identity public key */
  identityKey: PublicKey;
}

/**
 * Signed HTTP request structure for authenticated API calls
 * Based on BRC-103 mutual authentication
 */
export interface SignedRequest extends AuthenticatedRequest {
  /** Signature over canonicalized request data */
  signature: Signature;

  /** Optional certificates to present */
  certificates?: VerifiableCertificate[];
}

/**
 * Authenticated request with verified identity attached
 * Used by middleware after successful verification
 */
export interface VerifiedRequest extends SignedRequest {
  /** The verified identity */
  verifiedIdentity: BSVIdentity;

  /** Verification timestamp */
  verifiedAt: number;

  /** Verified certificates (if any were presented) */
  verifiedCertificates?: VerifiableCertificate[];
}

// =============================================================================
// Request Canonicalization
// =============================================================================

/**
 * Canonicalize a signed request for signature verification
 * Order: method + path + timestamp + nonce + body_hash
 */
export function canonicalizeRequest(req: Omit<SignedRequest, "signature">): string {
  const bodyHash = req.body
    ? typeof req.body === "string"
      ? req.body
      : JSON.stringify(req.body)
    : "";
  return `${req.method.toUpperCase()}\n${req.path}\n${req.timestamp}\n${req.nonce}\n${bodyHash}`;
}
