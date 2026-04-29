/**
 * BSV Authentication Type Definitions
 *
 * Central export point for all BSV authentication types implementing
 * Bitcoin SV Request for Comments (BRC) specifications.
 *
 * @module types
 *
 * @see {@link https://github.com/bitcoin-sv/BRCs BRC Repository}
 *
 * ## BRC Specification References
 *
 * ### Key Derivation
 * @see BRC-42 - BSV Key Derivation Scheme (BKDS) - Hierarchical key derivation
 * @see BRC-43 - Security Levels, Protocol IDs, Key IDs and Counterparties
 * @see BRC-86 - Bidirectionally Authenticated Derivation of Privacy Restricted Type 42 Keys
 *
 * ### Digital Signatures
 * @see BRC-3 - Digital Signature Creation and Verification
 * @see BRC-77 - Message Signature Creation and Verification
 *
 * ### Certificates
 * @see BRC-52 - Identity Certificates
 * @see BRC-97 - Key Linkage Proofs
 * @see BRC-107 - Master Certificate Types
 * @see BRC-108 - Verifiable Certificate Format
 *
 * ### Wallet Interface
 * @see BRC-56 - Wallet Standard Interface
 * @see BRC-100 - Wallet Interface Specification
 *
 * ### Authentication
 * @see BRC-103 - Peer-to-peer Authentication
 */

// =============================================================================
// Primitive Types
// Base cryptographic primitives used throughout the BSV auth system
// =============================================================================

/**
 * @see BRC-42 - Uses secp256k1 elliptic curve with compressed DER-formatted public keys
 */
export type {
  /** Hex-encoded byte string */
  HexString,
  /** Base64-encoded byte string */
  Base64String,
  /** Public key in compressed DER format (33 bytes, hex-encoded) */
  PublicKey,
  /** DER-encoded ECDSA signature */
  Signature,
  /** Private key (32 bytes, hex-encoded) - handle with care */
  PrivateKey,
  /** SHA-256 hash (32 bytes, hex-encoded) */
  Hash256,
  /** RIPEMD-160 hash (20 bytes, hex-encoded) */
  Hash160,
  /** Transaction ID (32 bytes, hex-encoded, reversed byte order) */
  TxID,
  /** Transaction outpoint reference */
  Outpoint,
  /** Unix timestamp in milliseconds */
  UnixTimestampMs,
  /** Unix timestamp in seconds */
  UnixTimestampSec,
} from "./primitives.js";

export {
  /** Check if a string is a valid hex string */
  isHexString,
  /** Check if a string is a valid compressed public key (33 bytes hex) */
  isCompressedPublicKey,
  /** Check if a string appears to be a DER-encoded signature */
  isDERSignature,
} from "./primitives.js";

// =============================================================================
// Key Derivation Types (BRC-42/43/86)
// Hierarchical key derivation with protocol-specific namespacing
// =============================================================================

/**
 * Key derivation types implementing BRC-42 BSV Key Derivation Scheme (BKDS)
 * and BRC-43 security level specifications.
 *
 * @see BRC-42 - BSV Key Derivation Scheme (BKDS)
 * @see BRC-43 - Security Levels, Protocol IDs, Key IDs and Counterparties
 * @see BRC-86 - Bidirectionally Authenticated Derivation
 */
export type {
  /** Security levels: 0 (admin), 1 (public derivation), 2 (private/counterparty) */
  SecurityLevel,
  /** Protocol ID tuple: [securityLevel, protocolString] */
  ProtocolID,
  /** Counterparty identifier: public key, 'self', or 'anyone' */
  Counterparty,
  /** Parameters for BKDS key derivation */
  KeyDerivationParams,
  /** Result of key derivation operation */
  DerivedKey,
  /** Hierarchical key tree structure (BRC-42) */
  BRC42KeyTree,
  /** Protocol-level key node */
  ProtocolKeyNode,
  /** Key ID node within a protocol */
  KeyIDNode,
  /** Counterparty-specific key node */
  CounterpartyKeyNode,
  /** Interface for managing a BRC-42 key tree */
  KeyTreeManager,
  /** Key linkage proof (BRC-97) - proves key relationships without revealing private keys */
  KeyLinkageProof,
  /** Interface for verifying key linkage proofs */
  KeyLinkageVerifier,
} from "./keys.js";

export {
  /** Convert a protocol ID to string format for map keys */
  protocolIDToString,
  /** Parse a protocol ID string back to tuple */
  stringToProtocolID,
  /** Create a full key path string for unique identification */
  keyPath,
} from "./keys.js";

// =============================================================================
// Digital Signature Types (BRC-3/77)
// ECDSA signatures with secp256k1 curve and SHA-256 hashing
// =============================================================================

/**
 * Digital signature types implementing BRC-3 specification.
 * Uses ECDSA with secp256k1 curve and SHA-256 message hashing.
 *
 * @see BRC-3 - Digital Signature Creation and Verification
 * @see BRC-77 - Message Signature Creation and Verification
 */
export type {
  /** Payload structure for creating signatures */
  SignaturePayload,
  /** Request to create a digital signature */
  SignatureRequest,
  /** Response from signature creation */
  SignatureResponse,
  /** Request to verify a signature */
  VerifySignatureRequest,
  /** Response from signature verification */
  VerifySignatureResponse,
  /** Serialized message signature format (BRC-77) */
  SerializedMessageSignature,
  /** Options for message signing */
  MessageSigningOptions,
  /** Signed message with metadata */
  SignedMessage,
  /** DER signature components (r, s values) */
  DERSignatureComponents,
} from "./signatures.js";

export {
  /** Parse a DER-encoded signature into r and s components */
  parseDERSignature,
} from "./signatures.js";

// =============================================================================
// Certificate Types (BRC-52/97/107/108)
// Identity certificates with selective disclosure
// =============================================================================

/**
 * Certificate types implementing BRC-52/107/108 specifications.
 * Enables identity attestation with selective disclosure.
 *
 * @see BRC-52 - Identity Certificates
 * @see BRC-97 - Key Linkage Proofs
 * @see BRC-107 - Master Certificate Types
 * @see BRC-108 - Verifiable Certificate Format
 */
export type {
  /** Allowed certificate field value types */
  CertificateFieldValue,
  /** Certificate fields mapping */
  CertificateFields,
  /** Base certificate structure (BRC-52) */
  Certificate,
  /** Master certificate fields (BRC-107) */
  MasterCertificateFields,
  /** Master certificate for root-level identity attestation */
  MasterCertificate,
  /** Verifiable certificate with selective disclosure proof (BRC-108) */
  VerifiableCertificate,
  /** Certificate disclosure request specification */
  CertificateDisclosureRequest,
  /** Certificate disclosure response */
  CertificateDisclosure,
  /** Request to acquire a certificate */
  AcquireCertificateRequest,
  /** Result of certificate acquisition */
  AcquireCertificateResult,
  /** Certificate revocation status */
  RevocationStatus,
  /** Request to check certificate revocation */
  CheckRevocationRequest,
} from "./certificates.js";

export {
  /** Get deterministic signing data from certificate */
  getCertificateSigningData,
  /** Check if a certificate has expired */
  isCertificateExpired,
  /** Type guard for master certificates */
  isMasterCertificate,
} from "./certificates.js";

// =============================================================================
// Identity Types (BRC-103)
// Cryptographic identity for peer-to-peer authentication
// =============================================================================

/**
 * Identity types implementing BRC-103 peer-to-peer authentication.
 * Provides cryptographic identity based on secp256k1 key pairs.
 *
 * @see BRC-103 - Peer-to-peer Authentication
 * @see BRC-42 - BSV Key Derivation (identity key derivation)
 * @see BRC-100 - Wallet Interface (identity operations)
 */
export type {
  /** Identity key derived via BRC-42 BKDS */
  IdentityKey,
  /** BSV Identity - cryptographic identity based on secp256k1 */
  BSVIdentity,
  /** Interface for verifying cryptographic identities */
  IdentityVerifier,
  /** Options for identity verification */
  IdentityVerificationOptions,
  /** Result of identity verification (from identity module) */
  IdentityVerificationResult,
  /** Identity error codes */
  IdentityErrorCode,
  /** Base interface for authenticated HTTP requests */
  AuthenticatedRequest,
  /** Signed HTTP request for authenticated API calls */
  SignedRequest,
  /** Authenticated request with verified identity attached */
  VerifiedRequest,
} from "./identity.js";

export {
  /** Canonicalize a signed request for signature verification */
  canonicalizeRequest,
} from "./identity.js";

// =============================================================================
// Wallet Types (BRC-56/100)
// Wallet interface for key management and cryptographic operations
// =============================================================================

/**
 * Wallet interface types implementing BRC-56/100 specifications.
 * Standard interface for wallet-application communication.
 *
 * @see BRC-56 - Wallet Standard Interface
 * @see BRC-100 - Wallet Interface Specification
 */
export type {
  /** Wallet operation result wrapper */
  WalletResult,
  /** Standard wallet error codes */
  WalletErrorCode,
  /** Wallet interface (BRC-100) */
  WalletInterface,
  /** Discovery result from identity/attribute lookup */
  DiscoveryResult,
  /** Wallet connection status */
  WalletConnectionStatus,
  /** Wallet capabilities descriptor */
  WalletCapabilities,
  /** Wallet event types */
  WalletEventType,
  /** Wallet event payload */
  WalletEvent,
  /** Wallet event listener function */
  WalletEventListener,
  /** Extended wallet interface with event support */
  EventedWalletInterface,
} from "./wallet.js";

// =============================================================================
// Error Types
// Verification errors and result structures
// =============================================================================

/**
 * Error types and verification result structures.
 * Provides standardized error handling across the authentication system.
 */
export type {
  /** Error codes for signature verification failures */
  SignatureVerificationErrorCode,
  /** Error codes for request verification failures */
  RequestVerificationErrorCode,
  /** Error codes for certificate verification failures */
  CertificateVerificationErrorCode,
  /** Error codes for identity verification failures */
  IdentityVerificationErrorCode,
  /** Combined verification error code type */
  VerificationErrorCode,
  /** Auth middleware specific error codes */
  AuthErrorCode,
  /** Base verification result structure */
  BaseVerificationResult,
  /** Result of signature verification */
  SignatureVerificationResult,
  /** Result of request verification */
  RequestVerificationResult,
  /** Result of certificate verification */
  CertificateVerificationResult,
  /** Combined verification result for full verification */
  FullVerificationResult,
} from "./errors.js";

/**
 * Identity verification result from errors module
 * (distinct from identity.ts IdentityVerificationResult)
 */
export type { IdentityVerificationResult as ErrorsIdentityVerificationResult } from "./errors.js";

export {
  /** Base verification error class */
  VerificationError,
  /** Signature verification error */
  SignatureError,
  /** Request verification error */
  RequestError,
  /** Certificate verification error */
  CertificateError,
  /** Identity verification error */
  IdentityError,
  /** Auth middleware error class */
  AuthError,
  /** Create a successful verification result */
  successResult,
  /** Create a failed verification result */
  failureResult,
  /** Check if a result indicates success */
  isSuccessResult,
  /** Check if a result indicates a specific error */
  hasErrorCode,
  /** Map error code to HTTP status code */
  errorCodeToHttpStatus,
  /** Map auth error code to HTTP status code */
  authErrorCodeToHttpStatus,
} from "./errors.js";

// =============================================================================
// Middleware Types (BRC-103)
// Express/HTTP middleware for authenticated requests
// =============================================================================

/**
 * Middleware types implementing BRC-103 mutual authentication.
 * Provides configuration, callbacks, and request context types.
 *
 * @see BRC-103 - Peer-to-peer Authentication
 */
export type {
  /** Owner configuration for ownerOnly mode */
  OwnerConfig,
  /** Nonce store interface for replay protection */
  NonceStore,
  /** In-memory nonce store configuration */
  InMemoryNonceStoreOptions,
  /** Callback for verification errors */
  VerificationErrorCallback,
  /** Callback for successful verification */
  VerificationSuccessCallback,
  /** Custom authorization check callback */
  AuthorizationCallback,
  /** Identity resolver callback */
  IdentityResolverCallback,
  /** Full middleware configuration options */
  AuthMiddlewareOptions,
  /** Minimal middleware options (wallet only) */
  MinimalAuthMiddlewareOptions,
  /** Request context with verified identity */
  AuthenticatedRequestContext,
  /** Express request with BSV auth context */
  BSVAuthenticatedRequest,
  /** Express middleware function signature */
  ExpressMiddleware,
  /** Factory for creating auth middleware */
  AuthMiddlewareFactory,
  /** Extracted auth data from HTTP request */
  ExtractedAuthData,
  /** Result of auth data extraction */
  AuthDataExtractionResult,
} from "./middleware.js";

// =============================================================================
// Re-export from bsv-auth barrel (for backwards compatibility)
// =============================================================================

/**
 * Re-export all types from bsv-auth barrel for backwards compatibility
 * and as an alternative import path.
 */
export * as bsvAuth from "./bsv-auth/index.js";
