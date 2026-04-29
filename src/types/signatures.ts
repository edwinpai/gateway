/**
 * BSV Signature Types
 *
 * Digital signature types based on BRC-3 specification.
 * Uses ECDSA with secp256k1 curve and SHA-256 message hashing.
 *
 * @see BRC-3: Digital Signature Creation and Verification
 * @see BRC-77: Message Signature Creation and Verification
 */

import type { ProtocolID, Counterparty } from "./keys.js";
import type { Signature, HexString } from "./primitives.js";

// =============================================================================
// Signature Payload Types
// =============================================================================

/**
 * Payload structure for creating signatures
 * Contains all data needed to produce a deterministic signature
 */
export interface SignaturePayload {
  /** Data to be signed (original bytes or hex-encoded) */
  data: string | Uint8Array;

  /** Protocol ID for key derivation context */
  protocolID: ProtocolID;

  /** Key ID to use for signing */
  keyID: string;

  /** Optional counterparty context for key derivation */
  counterparty?: Counterparty;

  /** Human-readable description for user confirmation */
  description?: string;

  /** Whether to hash the data before signing (default: true) */
  hashData?: boolean;
}

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
  signature: Signature;

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
  signature: Signature;

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
// Message Signing (BRC-77)
// =============================================================================

/**
 * Serialized message signature format (BRC-77)
 * Standard binary format for signed messages
 */
export interface SerializedMessageSignature {
  /** Version number of serialization format */
  version: number;

  /** Identity key of the signer (33 bytes compressed) */
  signerIdentityKey: HexString;

  /** Identity key of the recipient (33 bytes) or 0x00 for anyone */
  recipientIdentityKey: HexString | null;

  /** The DER-encoded signature */
  signature: Signature;

  /** Original message that was signed */
  message: Uint8Array;
}

/**
 * Options for message signing
 */
export interface MessageSigningOptions {
  /** Protocol ID for key derivation */
  protocolID: ProtocolID;

  /** Key ID for signing */
  keyID: string;

  /** Intended recipient (optional, for directed messages) */
  recipient?: string;

  /** Include timestamp in signed data */
  includeTimestamp?: boolean;

  /** Include nonce for replay protection */
  includeNonce?: boolean;
}

/**
 * Signed message with metadata
 */
export interface SignedMessage {
  /** Original message content */
  message: string | Uint8Array;

  /** DER-encoded signature */
  signature: Signature;

  /** Signer's public key */
  signerPublicKey: HexString;

  /** Timestamp when signed (if included) */
  timestamp?: number;

  /** Nonce (if included) */
  nonce?: string;

  /** Intended recipient (if specified) */
  recipient?: HexString;
}

// =============================================================================
// Signature Utilities
// =============================================================================

/**
 * DER signature components for manual verification
 */
export interface DERSignatureComponents {
  /** R component (32 bytes) */
  r: HexString;

  /** S component (32 bytes) */
  s: HexString;
}

/**
 * Parse a DER-encoded signature into r and s components
 */
export function parseDERSignature(signature: Signature): DERSignatureComponents | null {
  try {
    const sig = Buffer.from(signature, "hex");

    // DER format: 0x30 [total-length] 0x02 [R-length] [R] 0x02 [S-length] [S]
    if (sig[0] !== 0x30) {
      return null;
    }

    let offset = 2;
    if (sig[1] >= 0x80) {
      offset++;
    } // Long form length

    if (sig[offset] !== 0x02) {
      return null;
    }
    const rLen = sig[offset + 1];
    const r = sig.subarray(offset + 2, offset + 2 + rLen).toString("hex");

    offset += 2 + rLen;
    if (sig[offset] !== 0x02) {
      return null;
    }
    const sLen = sig[offset + 1];
    const s = sig.subarray(offset + 2, offset + 2 + sLen).toString("hex");

    return { r, s };
  } catch {
    return null;
  }
}
