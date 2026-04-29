/**
 * HKDF (HMAC-based Key Derivation Function) for ECDH Shared Secrets
 *
 * Implements HKDF-SHA256 per NIST SP 800-56A Rev 3 for processing
 * ECDH shared secrets. Raw shared secrets MUST NOT be used directly
 * as cryptographic keys.
 *
 * **Security Critical:** Using raw ECDH shared secrets directly is
 * cryptographically weak. Always apply KDF to derive keys.
 *
 * @see https://csrc.nist.gov/publications/detail/sp/800-56a/rev-3/final
 * @see https://tools.ietf.org/html/rfc5869 (HKDF specification)
 * @see SECURITY-MITIGATIONS-v2.md - Mitigation 8.1
 */

import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";

/**
 * HKDF key derivation options
 */
export interface HKDFOptions {
  /** Salt value (optional, uses zeros if not provided) */
  salt?: Buffer;
  /** Info string for context binding (recommended) */
  info?: string;
  /** Output key length in bytes (default: 32) */
  outputLength?: number;
}

/**
 * Derive cryptographic key from ECDH shared secret using HKDF-SHA256
 *
 * Per NIST SP 800-56A Rev 3:
 * "The output of an ECDH key agreement scheme shall be processed by
 * an approved key derivation function (KDF) before being used as
 * keying material."
 *
 * Algorithm (HKDF-SHA256):
 * 1. Extract: PRK = HMAC-SHA256(salt, sharedSecret)
 * 2. Expand: OKM = HMAC-SHA256(PRK, info || 0x01)
 *
 * @param sharedSecret - ECDH shared secret (raw output from point multiplication)
 * @param options - Derivation options (salt, info, outputLength)
 * @returns Derived cryptographic key material
 *
 * @example
 * ```typescript
 * const sharedSecret = ecdh(myPrivateKey, theirPublicKey);
 * const derivedKey = deriveKeyFromSharedSecret(sharedSecret, {
 *   salt: randomBytes(32),
 *   info: 'BRC-42-encryption-key',
 *   outputLength: 32
 * });
 * // Use derivedKey for encryption, NOT the raw sharedSecret
 * ```
 */
export function deriveKeyFromSharedSecret(sharedSecret: Buffer, options: HKDFOptions = {}): Buffer {
  const {
    salt = Buffer.alloc(32, 0), // Default: 32 zero bytes
    info = "",
    outputLength = 32,
  } = options;

  // Validate inputs
  if (sharedSecret.length === 0) {
    throw new Error("Shared secret cannot be empty");
  }

  if (outputLength < 1 || outputLength > 255 * 32) {
    throw new Error(`Invalid output length: ${outputLength} (must be 1-8160 bytes)`);
  }

  // Apply HKDF-SHA256
  const derivedKey = hkdf(sha256, sharedSecret, salt, Buffer.from(info, "utf-8"), outputLength);

  return Buffer.from(derivedKey);
}

/**
 * Derive BRC-42 key from ECDH shared secret (specialized wrapper)
 *
 * This is a convenience function for BRC-42 key derivation that
 * applies proper KDF with recommended parameters.
 *
 * @param sharedSecret - ECDH shared secret
 * @param invoiceNumber - Invoice number (used as salt)
 * @returns Derived key for BRC-42 usage
 */
export function deriveBRC42Key(sharedSecret: Buffer, invoiceNumber: string): Buffer {
  return deriveKeyFromSharedSecret(sharedSecret, {
    salt: Buffer.from(invoiceNumber, "utf-8"),
    info: "BRC-42-key-derivation",
    outputLength: 32,
  });
}

/**
 * Derive encryption key and MAC key from shared secret
 *
 * Best practice: Derive separate keys for encryption and authentication
 * from the same shared secret.
 *
 * @param sharedSecret - ECDH shared secret
 * @param context - Context string for key binding
 * @returns Object with separate encryption and MAC keys
 */
export function deriveEncryptionKeys(
  sharedSecret: Buffer,
  context: string = "encryption",
): { encryptionKey: Buffer; macKey: Buffer } {
  // Derive 64 bytes: 32 for encryption, 32 for MAC
  const derivedMaterial = deriveKeyFromSharedSecret(sharedSecret, {
    info: `${context}-keys`,
    outputLength: 64,
  });

  return {
    encryptionKey: derivedMaterial.subarray(0, 32),
    macKey: derivedMaterial.subarray(32, 64),
  };
}

/**
 * Constant-time comparison of derived keys
 *
 * Use this to verify shared secrets without timing leaks.
 *
 * @param key1 - First key
 * @param key2 - Second key
 * @returns true if keys are equal (constant-time)
 */
export function constantTimeCompare(key1: Buffer, key2: Buffer): boolean {
  if (key1.length !== key2.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < key1.length; i++) {
    result |= key1[i] ^ key2[i];
  }

  return result === 0;
}

/**
 * Validate that a buffer looks like a valid ECDH shared secret
 *
 * @param sharedSecret - Buffer to validate
 * @throws Error if invalid
 */
export function validateSharedSecret(sharedSecret: Buffer): void {
  if (!Buffer.isBuffer(sharedSecret)) {
    throw new Error("Shared secret must be a Buffer");
  }

  // Secp256k1 ECDH shared secret is 33 bytes (compressed point)
  // or 32 bytes (x-coordinate only)
  if (sharedSecret.length !== 32 && sharedSecret.length !== 33) {
    throw new Error(
      `Invalid shared secret length: ${sharedSecret.length} (expected 32 or 33 bytes)`,
    );
  }

  // Check for all-zero shared secret (invalid)
  const isAllZeros = sharedSecret.every((byte) => byte === 0);
  if (isAllZeros) {
    throw new Error("Shared secret is all zeros (invalid ECDH output)");
  }
}

/**
 * Security best practices for KDF usage
 */
export const KDF_BEST_PRACTICES = {
  /** Recommended salt length (minimum) */
  RECOMMENDED_SALT_LENGTH: 16,

  /** Recommended output length for symmetric keys */
  RECOMMENDED_KEY_LENGTH: 32,

  /** Info strings should be application-specific */
  INFO_EXAMPLES: ["BRC-42-key-derivation", "application-encryption-v1", "session-key-2024"],
} as const;
