/**
 * BSV Primitive Types
 *
 * Base cryptographic primitive types used throughout the BSV auth system.
 * These are fundamental building blocks for all other type definitions.
 */

// =============================================================================
// Byte String Types
// =============================================================================

/**
 * Hex-encoded byte string
 * @example "0a1b2c3d" - represents 4 bytes
 */
export type HexString = string;

/**
 * Base64-encoded byte string
 * @example "SGVsbG8=" - represents "Hello"
 */
export type Base64String = string;

// =============================================================================
// Cryptographic Types
// =============================================================================

/**
 * Public key in compressed DER format (33 bytes, hex-encoded)
 * Format: 02/03 prefix + 32 bytes X coordinate
 *
 * @example "02abc123..." - compressed secp256k1 public key
 */
export type PublicKey = HexString;

/**
 * DER-encoded ECDSA signature
 * Format: 0x30 [length] 0x02 [r-length] [r] 0x02 [s-length] [s]
 *
 * @example "3045022100..." - DER signature
 */
export type Signature = HexString;

/**
 * Private key (32 bytes, hex-encoded)
 * CAUTION: Handle with care, never log or expose
 */
export type PrivateKey = HexString;

/**
 * SHA-256 hash (32 bytes, hex-encoded)
 */
export type Hash256 = HexString;

/**
 * RIPEMD-160 hash (20 bytes, hex-encoded)
 */
export type Hash160 = HexString;

// =============================================================================
// Transaction Types
// =============================================================================

/**
 * Transaction ID (32 bytes, hex-encoded, reversed byte order)
 */
export type TxID = HexString;

/**
 * Transaction outpoint reference
 * Format: "txid:vout" or {txid, vout}
 */
export type Outpoint = string | { txid: TxID; vout: number };

// =============================================================================
// Time Types
// =============================================================================

/**
 * Unix timestamp in milliseconds
 */
export type UnixTimestampMs = number;

/**
 * Unix timestamp in seconds
 */
export type UnixTimestampSec = number;

// =============================================================================
// Utility Type Guards
// =============================================================================

/**
 * Check if a string is a valid hex string
 */
export function isHexString(value: string): value is HexString {
  return /^[0-9a-fA-F]*$/.test(value) && value.length % 2 === 0;
}

/**
 * Check if a string is a valid compressed public key (33 bytes hex)
 */
export function isCompressedPublicKey(value: string): value is PublicKey {
  if (!isHexString(value) || value.length !== 66) {
    return false;
  }
  const prefix = value.substring(0, 2);
  return prefix === "02" || prefix === "03";
}

/**
 * Check if a string appears to be a DER-encoded signature
 */
export function isDERSignature(value: string): value is Signature {
  if (!isHexString(value) || value.length < 16) {
    return false;
  }
  return value.startsWith("30");
}
