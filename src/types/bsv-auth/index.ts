/**
 * BSV Authentication Type Definitions - Export Barrel
 *
 * Central export point for all BSV auth types.
 * Organized by BRC specification categories.
 *
 * @see BRC-42: BSV Key Derivation Scheme (BKDS)
 * @see BRC-43: Security Levels, Protocol IDs, Key IDs and Counterparties
 * @see BRC-3: Digital Signature Creation and Verification
 * @see BRC-52/107/108: Identity Certificates
 * @see BRC-56/100: Wallet Interface Specification
 * @see BRC-103: Peer-to-peer authentication
 */

// =============================================================================
// Primitive Types
// =============================================================================
export type {
  HexString,
  Base64String,
  PublicKey,
  Signature,
  PrivateKey,
  Hash256,
  Hash160,
  TxID,
  Outpoint,
  UnixTimestampMs,
  UnixTimestampSec,
} from "../primitives.js";

export { isHexString, isCompressedPublicKey, isDERSignature } from "../primitives.js";

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
  ProtocolKeyNode,
  KeyIDNode,
  CounterpartyKeyNode,
  KeyTreeManager,
  KeyLinkageProof,
  KeyLinkageVerifier,
} from "../keys.js";

export { protocolIDToString, stringToProtocolID, keyPath } from "../keys.js";

// =============================================================================
// Signature Types (BRC-3/77)
// =============================================================================
export type {
  SignaturePayload,
  SignatureRequest,
  SignatureResponse,
  VerifySignatureRequest,
  VerifySignatureResponse,
  SerializedMessageSignature,
  MessageSigningOptions,
  SignedMessage,
  DERSignatureComponents,
} from "../signatures.js";

export { parseDERSignature } from "../signatures.js";

// =============================================================================
// Certificate Types (BRC-52/107/108)
// =============================================================================
export type {
  CertificateFieldValue,
  CertificateFields,
  Certificate,
  MasterCertificateFields,
  MasterCertificate,
  VerifiableCertificate,
  CertificateDisclosureRequest,
  CertificateDisclosure,
  AcquireCertificateRequest,
  AcquireCertificateResult,
  RevocationStatus,
  CheckRevocationRequest,
} from "../certificates.js";

export {
  getCertificateSigningData,
  isCertificateExpired,
  isMasterCertificate,
} from "../certificates.js";

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
} from "../identity.js";

export { canonicalizeRequest } from "../identity.js";
export type { SignedPromptEnvelope, SignedPrompt } from "../bsv-auth.js";
export { canonicalizeCertificate, canonicalizeSignedPrompt } from "../bsv-auth.js";

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
  WalletEventType,
  WalletEvent,
  WalletEventListener,
  EventedWalletInterface,
} from "../wallet.js";

// =============================================================================
// Error Types
// =============================================================================
export type {
  SignatureVerificationErrorCode,
  RequestVerificationErrorCode,
  CertificateVerificationErrorCode,
  IdentityVerificationErrorCode,
  VerificationErrorCode,
  AuthErrorCode,
  BaseVerificationResult,
  SignatureVerificationResult,
  RequestVerificationResult,
  CertificateVerificationResult,
  FullVerificationResult,
} from "../errors.js";

// Re-export IdentityVerificationResult from errors (different from identity.ts version)
export type { IdentityVerificationResult as ErrorIdentityVerificationResult } from "../errors.js";

export {
  VerificationError,
  SignatureError,
  RequestError,
  CertificateError,
  IdentityError,
  AuthError,
  successResult,
  failureResult,
  isSuccessResult,
  hasErrorCode,
  errorCodeToHttpStatus,
  authErrorCodeToHttpStatus,
} from "../errors.js";

// =============================================================================
// Middleware Types (BRC-103)
// =============================================================================
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
} from "../middleware.js";
