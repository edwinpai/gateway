/**
 * BSV Wallet Interface Types
 *
 * Wallet interface types based on BRC-56/100 specifications.
 * Provides standard interface for wallet-application communication.
 *
 * @see BRC-56: Wallet Standard Interface
 * @see BRC-100: Wallet Interface Specification
 */

import type { Certificate } from "./certificates.js";
import type { ProtocolID, Counterparty, KeyLinkageProof } from "./keys.js";
import type { PublicKey } from "./primitives.js";
import type {
  SignatureRequest,
  SignatureResponse,
  VerifySignatureRequest,
  VerifySignatureResponse,
} from "./signatures.js";

// =============================================================================
// Wallet Result Wrapper
// =============================================================================

/**
 * Wallet operation result wrapper
 * All wallet operations return this structure for consistent error handling
 */
export interface WalletResult<T> {
  /** Whether the operation succeeded */
  success: boolean;

  /** Error message if success is false */
  error?: string;

  /** Error code for programmatic handling */
  errorCode?: WalletErrorCode;

  /** Result data if success is true */
  result?: T;
}

/**
 * Standard wallet error codes
 */
export type WalletErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_PARAMS"
  | "NOT_FOUND"
  | "PERMISSION_DENIED"
  | "USER_REJECTED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "INTERNAL_ERROR"
  | "NOT_IMPLEMENTED";

// =============================================================================
// Wallet Interface (BRC-56/100)
// =============================================================================

/**
 * Wallet Interface - based on BRC-100 specification
 * Manages user keys for signing, encrypting, and decrypting data
 */
export interface WalletInterface {
  // --- Identity Methods ---

  /**
   * Get the wallet's public key
   * Without parameters, returns root identity key
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

  /**
   * Wait for wallet to be authenticated
   * Returns when user authenticates or timeout expires
   */
  waitForAuthentication?(params?: {
    timeout?: number;
  }): Promise<WalletResult<{ authenticated: boolean }>>;

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
   * Prove ownership of a certificate with selective disclosure
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

// =============================================================================
// Discovery Types
// =============================================================================

/**
 * Discovery result from identity/attribute lookup
 */
export interface DiscoveryResult {
  /** Identity public key */
  identityKey: PublicKey;

  /** Human-readable name (if available) */
  name?: string;

  /** Additional attributes */
  attributes?: Record<string, string>;

  /** Discovery source */
  source?: "local" | "overlay" | "lookup";

  /** Confidence score (0-1) */
  confidence?: number;
}

// =============================================================================
// Wallet Connection Types
// =============================================================================

/**
 * Wallet connection status
 */
export interface WalletConnectionStatus {
  /** Whether connected to wallet */
  connected: boolean;

  /** Wallet identity key (if connected and authenticated) */
  identityKey?: PublicKey;

  /** Connection type */
  connectionType?: "http" | "websocket" | "local" | "extension";

  /** Last activity timestamp */
  lastActivity?: number;
}

/**
 * Wallet capabilities (what operations it supports)
 */
export interface WalletCapabilities {
  /** Supports digital signatures */
  signing: boolean;

  /** Supports encryption/decryption */
  encryption: boolean;

  /** Supports certificates */
  certificates: boolean;

  /** Supports identity discovery */
  discovery: boolean;

  /** Supports transactions */
  transactions: boolean;

  /** Version string */
  version?: string;

  /** Supported BRCs */
  supportedBRCs?: string[];
}

// =============================================================================
// Wallet Events
// =============================================================================

/**
 * Wallet event types for event-driven communication
 */
export type WalletEventType =
  | "connected"
  | "disconnected"
  | "authenticated"
  | "locked"
  | "certificateAdded"
  | "certificateRemoved"
  | "signatureRequested"
  | "error";

/**
 * Wallet event payload
 */
export interface WalletEvent {
  type: WalletEventType;
  timestamp: number;
  data?: unknown;
}

/**
 * Wallet event listener
 */
export type WalletEventListener = (event: WalletEvent) => void;

/**
 * Extended wallet interface with event support
 */
export interface EventedWalletInterface extends WalletInterface {
  /** Subscribe to wallet events */
  on(event: WalletEventType, listener: WalletEventListener): void;

  /** Unsubscribe from wallet events */
  off(event: WalletEventType, listener: WalletEventListener): void;

  /** Emit a wallet event */
  emit?(event: WalletEvent): void;
}
