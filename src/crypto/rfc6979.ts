/**
 * RFC 6979: Deterministic ECDSA Signature Generation
 *
 * Implements deterministic k generation for ECDSA signatures to prevent
 * nonce reuse attacks. Per RFC 6979 Section 3.2.
 *
 * **Security Critical:** This code prevents private key leakage through nonce reuse.
 * Any modification must be validated against RFC 6979 test vectors.
 *
 * @see https://tools.ietf.org/html/rfc6979
 * @see SECURITY-MITIGATIONS-v2.md - Mitigation 2.1
 */

import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";

/**
 * Secp256k1 curve order (n)
 * This is the maximum value for private keys and nonces.
 */
const SECP256K1_N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");

/**
 * Size of secp256k1 elements in bytes (256 bits)
 */
const QLEN = 32;

/**
 * Convert an integer to an octet string of fixed length
 * Per RFC 6979 Section 2.3.3
 *
 * @param x - Integer to convert
 * @param rlen - Desired output length in bytes
 * @returns Buffer of length rlen containing big-endian representation of x
 */
function int2octets(x: bigint, rlen: number): Buffer {
  const hex = x.toString(16).padStart(rlen * 2, "0");
  return Buffer.from(hex, "hex");
}

/**
 * Convert a bit string to an integer
 * Per RFC 6979 Section 2.3.2
 *
 * @param bits - Bit string as Buffer
 * @returns Integer representation
 */
function bits2int(bits: Buffer): bigint {
  // Take the leftmost qlen bits
  let value = BigInt("0x" + bits.toString("hex"));

  // If the hash is larger than qlen bits, truncate
  const blen = bits.length * 8;
  if (blen > QLEN * 8) {
    value = value >> BigInt(blen - QLEN * 8);
  }

  return value;
}

/**
 * Convert a bit string to an octet string
 * Per RFC 6979 Section 2.3.4
 *
 * @param bits - Bit string as Buffer
 * @param qlen - Desired output length in bytes
 * @returns Octet string of length qlen
 */
function bits2octets(bits: Buffer, qlen: number): Buffer {
  let z1 = bits2int(bits);

  // Reduce modulo N if needed
  let z2 = z1 % SECP256K1_N;

  return int2octets(z2, qlen);
}

/**
 * Generate deterministic k per RFC 6979 Section 3.2
 *
 * Algorithm:
 * 1. h1 = H(m) where H is SHA-256
 * 2. K = 0x00 00 ... 00 (qlen bytes)
 * 3. V = 0x01 01 ... 01 (qlen bytes)
 * 4. K = HMAC_K(V || 0x00 || x || h1)
 * 5. V = HMAC_K(V)
 * 6. K = HMAC_K(V || 0x01 || x || h1)
 * 7. V = HMAC_K(V)
 * 8. Loop:
 *    a. T = empty
 *    b. While len(T) < qlen:
 *       V = HMAC_K(V)
 *       T = T || V
 *    c. k = bits2int(T)
 *    d. If k in [1, n-1]: return k
 *    e. Else: K = HMAC_K(V || 0x00), V = HMAC_K(V), repeat
 *
 * @param messageHash - SHA-256 hash of the message (32 bytes)
 * @param privateKey - Private key (32 bytes)
 * @returns Deterministic k value for ECDSA signing
 */
export function generateDeterministicK(messageHash: Buffer, privateKey: Buffer): bigint {
  if (messageHash.length !== 32) {
    throw new Error(`Invalid message hash length: ${messageHash.length} (expected 32)`);
  }
  if (privateKey.length !== 32) {
    throw new Error(`Invalid private key length: ${privateKey.length} (expected 32)`);
  }

  // Step 1: h1 = H(m) - already provided as messageHash
  const h1 = bits2octets(messageHash, QLEN);
  const x = int2octets(BigInt("0x" + privateKey.toString("hex")), QLEN);

  // Step 2: K = 0x00 00 ... 00 (qlen bytes)
  let K = Buffer.alloc(QLEN, 0x00);

  // Step 3: V = 0x01 01 ... 01 (qlen bytes)
  let V = Buffer.alloc(QLEN, 0x01);

  // Step 4: K = HMAC_K(V || 0x00 || x || h1)
  K = Buffer.from(hmac(sha256, K, Buffer.concat([V, Buffer.from([0x00]), x, h1])));

  // Step 5: V = HMAC_K(V)
  V = Buffer.from(hmac(sha256, K, V));

  // Step 6: K = HMAC_K(V || 0x01 || x || h1)
  K = Buffer.from(hmac(sha256, K, Buffer.concat([V, Buffer.from([0x01]), x, h1])));

  // Step 7: V = HMAC_K(V)
  V = Buffer.from(hmac(sha256, K, V));

  // Step 8: Generate k
  while (true) {
    // Step 8a: T = empty
    let T = Buffer.alloc(0);

    // Step 8b: While len(T) < qlen
    while (T.length < QLEN) {
      V = Buffer.from(hmac(sha256, K, V));
      T = Buffer.concat([T, V]);
    }

    // Step 8c: k = bits2int(T)
    const k = bits2int(T.subarray(0, QLEN));

    // Step 8d: If k in [1, n-1], return k
    if (k >= 1n && k < SECP256K1_N) {
      return k;
    }

    // Step 8e: K = HMAC_K(V || 0x00), V = HMAC_K(V), repeat
    K = Buffer.from(hmac(sha256, K, Buffer.concat([V, Buffer.from([0x00])])));
    V = Buffer.from(hmac(sha256, K, V));
  }
}

/**
 * Sign a message hash using deterministic k (RFC 6979)
 *
 * This is a reference implementation for testing. In production, use
 * @noble/secp256k1 with the generated k value.
 *
 * @param messageHash - SHA-256 hash of message (32 bytes)
 * @param privateKey - Private key (32 bytes)
 * @returns Object with { k, r, s } signature components
 */
export function signDeterministic(
  messageHash: Buffer,
  privateKey: Buffer,
): { k: bigint; r: bigint; s: bigint } {
  const k = generateDeterministicK(messageHash, privateKey);

  // For actual signing, you would:
  // 1. Calculate R = k * G (elliptic curve point multiplication)
  // 2. r = R.x mod n
  // 3. s = k^-1 * (messageHash + r * privateKey) mod n
  //
  // Use @noble/secp256k1 for the actual signing with this k value.

  // This is just a placeholder - real signing needs EC operations
  return {
    k,
    r: 0n, // Placeholder
    s: 0n, // Placeholder
  };
}

/**
 * Validate that k is in the valid range [1, n-1]
 *
 * @param k - Nonce value to validate
 * @returns true if k is valid
 */
export function isValidK(k: bigint): boolean {
  return k >= 1n && k < SECP256K1_N;
}

/**
 * Get the secp256k1 curve order
 * Exported for testing and validation
 */
export function getCurveOrder(): bigint {
  return SECP256K1_N;
}
