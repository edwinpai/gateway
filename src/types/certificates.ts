/**
 * BSV Certificate Types
 *
 * Certificate types based on BRC-52/107/108 specifications.
 * Certificates attest to user attributes and enable selective disclosure.
 *
 * @see BRC-52: Identity Certificates
 * @see BRC-107: Master Certificate Types
 * @see BRC-108: Verifiable Certificate Format
 */

import type { KeyLinkageProof } from "./keys.js";
import type { PublicKey, Signature, Outpoint } from "./primitives.js";

// =============================================================================
// Certificate Field Types
// =============================================================================

/**
 * Allowed certificate field value types
 * Note: undefined is included to support optional fields in extending interfaces
 */
export type CertificateFieldValue = string | number | boolean | null | undefined;

/**
 * Certificate fields mapping
 */
export type CertificateFields = Record<string, CertificateFieldValue>;

// =============================================================================
// Base Certificate (BRC-52)
// =============================================================================

/**
 * Certificate structure (BRC-52/107/108)
 * A data structure attesting to user attributes, signed by a certifier
 */
export interface Certificate {
  /** Certificate type identifier */
  type: string;

  /** Unique serial number */
  serialNumber: string;

  /** Certifier's identity public key */
  certifier: PublicKey;

  /** Subject's identity public key */
  subject: PublicKey;

  /** Certificate fields (attributes being certified) */
  fields: CertificateFields;

  /** Revocation outpoint (for on-chain revocation tracking) */
  revocationOutpoint?: Outpoint;

  /** Signature from the certifier over certificate data */
  signature: Signature;

  /** Unix timestamp of issuance (milliseconds) */
  issuedAt?: number;

  /** Unix timestamp of expiration (milliseconds, if applicable) */
  expiresAt?: number;
}

// =============================================================================
// Master Certificate (BRC-107)
// =============================================================================

/**
 * Master Certificate fields (BRC-107)
 */
export interface MasterCertificateFields extends CertificateFields {
  /** Primary name/identifier */
  name: string;

  /** Icon/avatar URL or base64 data */
  icon?: string;

  /** Email address (optional) */
  email?: string;

  /** Phone number (optional) */
  phone?: string;
}

/**
 * Certificate structure for BRC-107 Master Certificate
 * Used for root-level identity attestation
 */
export interface MasterCertificate extends Omit<Certificate, "type" | "fields"> {
  type: "master";

  /** Master certificate specific fields */
  fields: MasterCertificateFields;
}

// =============================================================================
// Verifiable Certificate (BRC-108)
// =============================================================================

/**
 * Verifiable certificate with selective disclosure proof (BRC-108)
 */
export interface VerifiableCertificate {
  /** The certificate being verified */
  certificate: Certificate;

  /** Fields revealed for this verification (field names) */
  revealedFields: string[];

  /** Key linkage proof for verification */
  keyLinkageProof: KeyLinkageProof;

  /** Whether this certificate has been verified */
  verified?: boolean;

  /** Timestamp of verification */
  verifiedAt?: number;
}

/**
 * Certificate disclosure request
 * Specifies what certificate information is requested
 */
export interface CertificateDisclosureRequest {
  /** Required certificate type */
  certificateType: string;

  /** Required fields to reveal */
  requiredFields: string[];

  /** Optional fields (nice to have) */
  optionalFields?: string[];

  /** Trusted certifiers (public keys) */
  trustedCertifiers?: PublicKey[];

  /** Whether expired certificates are acceptable */
  allowExpired?: boolean;
}

/**
 * Certificate disclosure response
 */
export interface CertificateDisclosure {
  /** The disclosed verifiable certificate */
  certificate: VerifiableCertificate;

  /** Revealed field values */
  revealedValues: Record<string, CertificateFieldValue>;

  /** Fields that were requested but not revealed */
  withheldFields?: string[];
}

// =============================================================================
// Certificate Acquisition
// =============================================================================

/**
 * Request to acquire a certificate from a certifier
 */
export interface AcquireCertificateRequest {
  /** Certificate type to acquire */
  type: string;

  /** Certifier's identity public key */
  certifier: PublicKey;

  /** Fields to include in the certificate */
  fields: Record<string, string>;

  /** Acquisition protocol (e.g., 'direct', 'oauth', 'email-verification') */
  acquisitionProtocol?: string;

  /** Additional protocol-specific options */
  acquisitionOptions?: Record<string, unknown>;
}

/**
 * Result of certificate acquisition
 */
export interface AcquireCertificateResult {
  /** Whether acquisition succeeded */
  success: boolean;

  /** The acquired certificate (if successful) */
  certificate?: Certificate;

  /** Error message (if failed) */
  error?: string;

  /** Additional acquisition metadata */
  metadata?: {
    /** Time taken to acquire (ms) */
    acquisitionTime?: number;

    /** Protocol used */
    protocol?: string;

    /** Certifier response */
    certifierResponse?: unknown;
  };
}

// =============================================================================
// Certificate Revocation
// =============================================================================

/**
 * Certificate revocation status
 */
export interface RevocationStatus {
  /** Whether the certificate is revoked */
  revoked: boolean;

  /** Revocation timestamp (if revoked) */
  revokedAt?: number;

  /** Revocation reason (if provided) */
  reason?: string;

  /** Revocation transaction ID (if on-chain) */
  revocationTxId?: string;
}

/**
 * Request to check certificate revocation
 */
export interface CheckRevocationRequest {
  /** Certificate to check */
  certificate: Certificate;

  /** Whether to check on-chain status */
  checkOnChain?: boolean;
}

// =============================================================================
// Certificate Utilities
// =============================================================================

/**
 * Data structure for signing a certificate
 * Order of fields is deterministic for consistent hashing
 */
export function getCertificateSigningData(cert: Omit<Certificate, "signature">): string {
  return JSON.stringify({
    type: cert.type,
    serialNumber: cert.serialNumber,
    certifier: cert.certifier,
    subject: cert.subject,
    fields: cert.fields,
    issuedAt: cert.issuedAt,
    expiresAt: cert.expiresAt,
    revocationOutpoint: cert.revocationOutpoint,
  });
}

/**
 * Check if a certificate has expired
 */
export function isCertificateExpired(cert: Certificate, now = Date.now()): boolean {
  return cert.expiresAt !== undefined && cert.expiresAt < now;
}

/**
 * Check if a certificate is a master certificate
 */
export function isMasterCertificate(cert: Certificate): cert is MasterCertificate {
  return cert.type === "master";
}
