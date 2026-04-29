/**
 * BSV Key Derivation Types
 *
 * Key derivation types based on BRC-42 (BKDS) and BRC-43 specifications.
 * Implements hierarchical key derivation with protocol-specific namespacing.
 *
 * @see BRC-42: BSV Key Derivation Scheme (BKDS)
 * @see BRC-43: Security Levels, Protocol IDs, Key IDs and Counterparties
 * @see BRC-86: Bidirectionally Authenticated Derivation of Privacy Restricted Type 42 Keys
 */

import type { PublicKey, HexString } from "./primitives.js";

// =============================================================================
// Security Levels (BRC-43)
// =============================================================================

/**
 * Security levels for key derivation (BRC-43)
 * - Level 0: Reserved/admin (privileged operations)
 * - Level 1: No counterparty privacy (public key derivation)
 * - Level 2: Counterparty-specific key derivation (private)
 */
export type SecurityLevel = 0 | 1 | 2;

/**
 * Protocol ID for key derivation (BRC-43)
 * Format: [securityLevel, protocolString]
 *
 * @example
 * [1, 'auth'] - Level 1, auth protocol
 * [2, 'messaging'] - Level 2, private messaging
 */
export type ProtocolID = [SecurityLevel, string];

/**
 * Counterparty identifier for key derivation
 * - string: Public key of the counterparty (33 bytes hex)
 * - 'self': Keys derived for self-use only
 * - 'anyone': Keys derivable by anyone (public)
 */
export type Counterparty = string;

// =============================================================================
// Key Derivation Parameters
// =============================================================================

/**
 * Key derivation parameters for BKDS (BRC-42)
 */
export interface KeyDerivationParams {
  /** Protocol identifier [securityLevel, protocolString] */
  protocolID: ProtocolID;

  /** Unique key identifier within protocol namespace */
  keyID: string;

  /** Counterparty public key or special value */
  counterparty?: Counterparty;

  /** Whether to derive a privileged key (level 0) */
  privileged?: boolean;

  /** Key derivation reason for audit purposes */
  reason?: string;
}

/**
 * Result of key derivation
 */
export interface DerivedKey {
  /** The derived public key (compressed, 33 bytes hex) */
  publicKey: PublicKey;

  /** Protocol ID used for derivation */
  protocolID: ProtocolID;

  /** Key ID within the protocol */
  keyID: string;

  /** Counterparty context */
  counterparty?: Counterparty;

  /** Whether this is a privileged key */
  privileged: boolean;
}

// =============================================================================
// BRC-42 Key Tree Structure
// =============================================================================

/**
 * Hierarchical key tree based on BRC-42 BKDS
 *
 * Structure:
 * - Root Identity Key (master)
 *   └── Protocol Keys (derived per protocol ID)
 *       └── Key ID Keys (derived per key ID within protocol)
 *           └── Counterparty Keys (derived per counterparty)
 */
export interface BRC42KeyTree {
  /** Root identity public key */
  rootKey: PublicKey;

  /** Protocol-level key nodes */
  protocols: Map<string, ProtocolKeyNode>;

  /** Whether the tree is locked/sealed */
  locked: boolean;

  /** Creation timestamp */
  createdAt: number;
}

/**
 * Protocol-level key node in the BRC-42 key tree
 */
export interface ProtocolKeyNode {
  /** Protocol identifier */
  protocolID: ProtocolID;

  /** Protocol-level derived public key */
  publicKey: PublicKey;

  /** Key ID nodes within this protocol */
  keyIDs: Map<string, KeyIDNode>;
}

/**
 * Key ID node within a protocol
 */
export interface KeyIDNode {
  /** Key identifier */
  keyID: string;

  /** Derived public key for this key ID */
  publicKey: PublicKey;

  /** Counterparty-specific key derivations */
  counterparties: Map<string, CounterpartyKeyNode>;
}

/**
 * Counterparty-specific key node
 */
export interface CounterpartyKeyNode {
  /** Counterparty identifier or 'self'/'anyone' */
  counterparty: Counterparty;

  /** Final derived public key for this counterparty context */
  publicKey: PublicKey;

  /** Last used timestamp */
  lastUsed?: number;
}

// =============================================================================
// Key Tree Operations Interface
// =============================================================================

/**
 * Interface for managing a BRC-42 key tree
 */
export interface KeyTreeManager {
  /**
   * Get or derive a key for the given parameters
   */
  getKey(params: KeyDerivationParams): Promise<DerivedKey>;

  /**
   * Check if a key exists in the tree
   */
  hasKey(params: KeyDerivationParams): boolean;

  /**
   * List all protocol IDs in the tree
   */
  listProtocols(): ProtocolID[];

  /**
   * List all key IDs for a protocol
   */
  listKeyIDs(protocolID: ProtocolID): string[];

  /**
   * Get the root identity key
   */
  getRootKey(): PublicKey;

  /**
   * Export the key tree (public keys only)
   */
  export(): BRC42KeyTree;
}

// =============================================================================
// Key Linkage Proof (BRC-97)
// =============================================================================

/**
 * Key linkage proof structure (BRC-97)
 * Proves relationship between keys without revealing private keys
 */
export interface KeyLinkageProof {
  /** Type of proof (e.g., 'DLEQ', future ZKP types) */
  proofType: string;

  /** The proof data (hex-encoded) */
  proof: HexString;

  /** Protocol ID used */
  protocolID: ProtocolID;

  /** Key ID used */
  keyID: string;

  /** Counterparty (verifier) public key */
  counterparty: string;

  /** The derived public key being proven */
  derivedPublicKey: PublicKey;
}

/**
 * Verify a key linkage proof
 */
export interface KeyLinkageVerifier {
  /**
   * Verify that a derived key belongs to an identity
   */
  verify(identityKey: PublicKey, derivedKey: PublicKey, proof: KeyLinkageProof): Promise<boolean>;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create a protocol ID string for map keys
 */
export function protocolIDToString(protocolID: ProtocolID): string {
  return `${protocolID[0]}:${protocolID[1]}`;
}

/**
 * Parse a protocol ID string back to tuple
 */
export function stringToProtocolID(str: string): ProtocolID {
  const [level, protocol] = str.split(":");
  return [parseInt(level, 10) as SecurityLevel, protocol];
}

/**
 * Create a full key path string for unique identification
 */
export function keyPath(params: KeyDerivationParams): string {
  const proto = protocolIDToString(params.protocolID);
  const cp = params.counterparty ?? "anyone";
  return `${proto}/${params.keyID}/${cp}`;
}
