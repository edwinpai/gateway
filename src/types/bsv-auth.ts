/**
 * BSV Authentication Type Definitions
 * Based on Bitcoin SV Request for Comments (BRCs)
 *
 * Sources:
 * - BRC-42: BSV Key Derivation Scheme (BKDS)
 * - BRC-43: Security Levels, Protocol IDs, Key IDs and Counterparties
 * - BRC-3: Digital Signature Creation and Verification
 * - BRC-100: Wallet Interface Specification
 * - BRC-103: Peer-to-peer authentication
 */

// =============================================================================
// BRC-42/43: Key Derivation Types
// =============================================================================

/**
 * Security levels for key derivation (BRC-43)
 * - Level 0: Reserved/admin
 * - Level 1: No counterparty privacy (public key derivation)
 * - Level 2: Counterparty-specific key derivation (private)
 */
export type SecurityLevel = 0 | 1 | 2;

/**
 * Protocol ID for key derivation (BRC-43)
 * Format: [securityLevel, protocolString]
 */
export type ProtocolID = [SecurityLevel, string];

/**
 * Counterparty identifier - either a public key or 'self'/'anyone'
 */
export type Counterparty = string;

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

/**
 * Key derivation parameters for BKDS (BRC-42)
 */
export interface KeyDerivationParams {
  /** Protocol identifier */
  protocolID: ProtocolID;

  /** Unique key identifier within protocol */
  keyID: string;

  /** Counterparty public key or special value */
  counterparty?: Counterparty;

  /** Whether to derive a privileged key */
  privileged?: boolean;

  /** Key derivation reason for audit purposes */
  reason?: string;
}

// =============================================================================
// BRC-3: Digital Signature Types
// =============================================================================

/**
 * Request to create a digital signature (BRC-3)
 */
export interface SignatureRequest {
  /** Data to be signed (hex-encoded or Uint8Array) */
  data: string | Uint8Array;

  /** Protocol ID for key derivation */
  protocolID: ProtocolID;

  /** Key ID to use for signing */
  keyID: string;

  /** Optional counterparty context */
  counterparty?: Counterparty;

  /** Description of what is being signed (for user confirmation) */
  description?: string;
}

/**
 * Response from signature creation (BRC-3)
 */
export interface SignatureResponse {
  /** DER-encoded signature (hex string) */
  signature: string;

  /** Public key that created the signature (compressed, hex) */
  publicKey: string;
}

/**
 * Request to verify a signature (BRC-3)
 */
export interface VerifySignatureRequest {
  /** Original data that was signed */
  data: string | Uint8Array;

  /** DER-encoded signature to verify */
  signature: string;

  /** Protocol ID used for key derivation */
  protocolID: ProtocolID;

  /** Key ID used for signing */
  keyID: string;

  /** Counterparty context */
  counterparty?: Counterparty;

  /** Expected signer's identity key (if verifying against known identity) */
  forSelf?: boolean;
}

/**
 * Response from signature verification
 */
export interface VerifySignatureResponse {
  /** Whether the signature is valid */
  valid: boolean;
}

// =============================================================================
// BRC-100: Wallet Interface (Subset)
// =============================================================================

/**
 * Wallet operation result wrapper
 */
export interface WalletResult<T> {
  /** Whether the operation succeeded */
  success: boolean;

  /** Error message if success is false */
  error?: string;

  /** Result data if success is true */
  result?: T;
}

/**
 * Wallet Interface - subset of BRC-100 specification
 * Manages user keys for signing, encrypting, and decrypting data
 */
export interface WalletInterface {
  // --- Identity Methods ---

  /**
   * Get the wallet's root identity public key
   */
  getPublicKey(params?: {
    protocolID?: ProtocolID;
    keyID?: string;
    counterparty?: Counterparty;
    forSelf?: boolean;
  }): Promise<WalletResult<{ publicKey: string }>>;

  /**
   * Check if wallet is authenticated/unlocked
   */
  isAuthenticated(): Promise<WalletResult<{ authenticated: boolean }>>;

  // --- Signing Methods (BRC-3) ---

  /**
   * Create a digital signature
   */
  createSignature(params: SignatureRequest): Promise<WalletResult<SignatureResponse>>;

  /**
   * Verify a digital signature
   */
  verifySignature(params: VerifySignatureRequest): Promise<WalletResult<VerifySignatureResponse>>;

  // --- Encryption Methods ---

  /**
   * Encrypt data for a recipient
   */
  encrypt(params: {
    plaintext: string | Uint8Array;
    protocolID: ProtocolID;
    keyID: string;
    counterparty?: Counterparty;
  }): Promise<WalletResult<{ ciphertext: string }>>;

  /**
   * Decrypt data
   */
  decrypt(params: {
    ciphertext: string | Uint8Array;
    protocolID: ProtocolID;
    keyID: string;
    counterparty?: Counterparty;
  }): Promise<WalletResult<{ plaintext: string }>>;

  // --- Certificate Methods (BRC-52/107/108) ---

  /**
   * Acquire a certificate from a certifier
   */
  acquireCertificate(params: {
    type: string;
    certifier: string;
    fields: Record<string, string>;
    acquisitionProtocol?: string;
  }): Promise<WalletResult<{ certificate: Certificate }>>;

  /**
   * List certificates held by the wallet
   */
  listCertificates(params?: {
    types?: string[];
    certifiers?: string[];
  }): Promise<WalletResult<{ certificates: Certificate[] }>>;

  /**
   * Prove ownership of a certificate
   */
  proveCertificate(params: {
    certificate: Certificate;
    fieldsToReveal: string[];
    verifier: string;
  }): Promise<WalletResult<{ keyLinkageProof: KeyLinkageProof }>>;

  /**
   * Relinquish (delete) a certificate
   */
  relinquishCertificate(params: {
    type: string;
    serialNumber: string;
    certifier: string;
  }): Promise<WalletResult<{ relinquished: boolean }>>;

  // --- Discovery Methods ---

  /**
   * Discover entities by identity key
   */
  discoverByIdentityKey(params: {
    identityKey: string;
    limit?: number;
  }): Promise<WalletResult<{ results: DiscoveryResult[] }>>;

  /**
   * Discover entities by attributes
   */
  discoverByAttributes(params: {
    attributes: Record<string, string>;
    limit?: number;
  }): Promise<WalletResult<{ results: DiscoveryResult[] }>>;
}

/**
 * Discovery result from identity/attribute lookup
 */
export interface DiscoveryResult {
  identityKey: string;
  name?: string;
  attributes?: Record<string, string>;
}

// =============================================================================
// BRC-52/107/108: Certificate Types
// =============================================================================

/**
 * Base certificate field types
 * Note: undefined is included to support optional fields in extending interfaces
 */
export type CertificateFieldValue = string | number | boolean | null | undefined;

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
  certifier: string;

  /** Subject's identity public key */
  subject: string;

  /** Certificate fields (attributes being certified) */
  fields: Record<string, CertificateFieldValue>;

  /** Encrypted field revelation keys (for selective disclosure) */
  revocationOutpoint?: string;

  /** Signature from the certifier */
  signature: string;

  /** Unix timestamp of issuance */
  issuedAt?: number;

  /** Unix timestamp of expiration (if applicable) */
  expiresAt?: number;
}

/**
 * Certificate structure for BRC-107 Master Certificate
 * Used for root-level identity attestation
 */
export interface MasterCertificate extends Certificate {
  type: "master";

  /** Master certificate specific fields */
  fields: {
    /** Primary name/identifier */
    name: string;

    /** Icon/avatar URL or data */
    icon?: string;

    /** Additional attributes */
    [key: string]: CertificateFieldValue;
  };
}

/**
 * Verifiable certificate with proof (BRC-108)
 */
export interface VerifiableCertificate {
  /** The certificate being verified */
  certificate: Certificate;

  /** Fields revealed for this verification */
  revealedFields: string[];

  /** Key linkage proof for verification */
  keyLinkageProof: KeyLinkageProof;

  /** Verification status */
  verified?: boolean;
}

/**
 * Key linkage proof structure (BRC-97)
 * Proves relationship between keys without revealing private keys
 */
export interface KeyLinkageProof {
  /** Type of proof (e.g., 'DLEQ', future ZKP types) */
  proofType: string;

  /** The proof data */
  proof: string;

  /** Protocol ID used */
  protocolID: ProtocolID;

  /** Key ID used */
  keyID: string;

  /** Counterparty (verifier) public key */
  counterparty: string;

  /** The derived public key being proven */
  derivedPublicKey: string;
}

// =============================================================================
// BRC-103: Authentication Types
// =============================================================================

/**
 * Signed Prompt Envelope (EdwinPAI identity-first signed prompts)
 */
export interface SignedPromptEnvelope {
  version: string;
  issuedAt: number;
  nonce: string;
  promptHash: string;
  scopeClaims?: string[];
  cert?: Certificate;
  certHash?: string;
  paymentRef?: {
    txid: string;
    proof?: string;
  };
  permissionTokens?: Array<{
    scope: string;
    certHash: string;
    txid?: string;
    proof?: string;
    assetId?: string;
    amount?: string;
    prevTxid?: string;
    commitment?: string;
  }>;
  device?: {
    id: string;
    publicKey: string;
    signature: string;
    signedAt: number;
    nonce?: string;
  };
}

export interface SignedPrompt {
  envelope: SignedPromptEnvelope;
  signature: string;
}

/**
 * Canonicalize a signed prompt envelope for signature verification.
 * Uses stable key ordering for deterministic hashing.
 */
export function canonicalizeSignedPrompt(envelope: SignedPromptEnvelope): string {
  return JSON.stringify(stableSort(envelope));
}

export function canonicalizeCertificate(cert: Certificate): string {
  return JSON.stringify(stableSort(cert));
}

function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableSort(item));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, stableSort(v)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

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
  identityKey: string;

  /** Signature over the auth request (proves key ownership) */
  signature: string;

  /** Optional certificates as requested */
  certificates?: VerifiableCertificate[];

  /** Timestamp of response */
  timestamp: number;
}

// =============================================================================
// BSV Identity Types
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

/**
 * Signed HTTP request structure for authenticated API calls
 * Based on BRC-103 mutual authentication
 */
export interface SignedRequest {
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

  /** Signature over canonicalized request data */
  signature: Signature;

  /** Optional certificates to present */
  certificates?: VerifiableCertificate[];
}

/**
 * Result of verifying a signed request or signature
 */
export interface VerificationResult {
  /** Whether verification succeeded */
  valid: boolean;

  /** Verified identity (if valid) */
  identity?: BSVIdentity;

  /** Error message (if invalid) */
  error?: string;

  /** Error code for programmatic handling */
  errorCode?: "INVALID_SIGNATURE" | "EXPIRED" | "REPLAY" | "INVALID_CERTIFICATE" | "UNKNOWN";

  /** Verified certificates (if presented and valid) */
  verifiedCertificates?: VerifiableCertificate[];

  /** Timestamp of verification */
  verifiedAt: number;
}

/**
 * Configuration options for authentication middleware
 */
export interface AuthMiddlewareOptions {
  /** Wallet interface for cryptographic operations */
  wallet: WalletInterface;

  /** Required certificate types for access */
  requiredCertificates?: string[];

  /** Required certificate fields to reveal */
  requiredFields?: string[];

  /** Maximum age of request timestamp (ms) - default 30000 */
  maxTimestampAge?: number;

  /** Enable nonce tracking for replay protection */
  enableReplayProtection?: boolean;

  /** Custom nonce storage (default: in-memory) */
  nonceStore?: NonceStore;

  /** Trusted certifiers (identity keys) */
  trustedCertifiers?: PublicKey[];

  /** Skip verification for certain paths (e.g., health checks) */
  skipPaths?: string[];

  /** Custom error handler */
  onError?: (error: VerificationResult, req: unknown) => void;

  /** Custom success handler */
  onSuccess?: (identity: BSVIdentity, req: unknown) => void;
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
// Utility Types
// =============================================================================

/**
 * Hex-encoded byte string
 */
export type HexString = string;

/**
 * Base64-encoded byte string
 */
export type Base64String = string;

/**
 * Public key in compressed DER format (33 bytes, hex-encoded)
 */
export type PublicKey = HexString;

/**
 * DER-encoded signature
 */
export type Signature = HexString;

// =============================================================================
// Request/Response Helpers
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
