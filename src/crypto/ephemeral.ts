/**
 * Ephemeral Key Generation for ECDH
 *
 * Generates cryptographically secure ephemeral keys for ECDH key exchange.
 * Uses platform CSPRNG with proper range validation.
 *
 * **Security Critical:** Ephemeral keys must be truly random and unpredictable.
 * Forward secrecy depends on this property.
 *
 * @see SECURITY-MITIGATIONS-v2.md - Mitigation 2.2
 * @see NIST SP 800-57 Part 1 Section 5.6.1.2.1
 */

import * as secp from "@noble/secp256k1";
import { randomBytes } from "node:crypto";
import { SECP256K1, validatePrivateKey } from "./constants.js";

/**
 * Ephemeral key pair for ECDH
 */
export interface EphemeralKeyPair {
  /** Ephemeral private key (32 bytes hex) */
  privateKey: string;
  /** Ephemeral public key (33 bytes compressed hex) */
  publicKey: string;
}

/**
 * Generate a cryptographically secure ephemeral private key
 *
 * Algorithm:
 * 1. Generate 32 random bytes using platform CSPRNG
 * 2. Interpret as big-endian integer
 * 3. Reduce modulo (n - 1) and add 1 to ensure range [1, n-1]
 * 4. Validate result
 *
 * Per NIST SP 800-57:
 * "Random bit generators shall be implemented within FIPS 140-2 or
 * 140-3 compliant cryptographic modules"
 *
 * @returns Ephemeral private key (32 bytes hex)
 */
export function generateEphemeralPrivateKey(): string {
  let attempts = 0;
  const MAX_ATTEMPTS = 100;

  while (attempts < MAX_ATTEMPTS) {
    attempts++;

    // Use platform CSPRNG (FIPS 140-2 compliant on most platforms)
    const keyBytes = randomBytes(32);
    const keyBigInt = BigInt("0x" + keyBytes.toString("hex"));

    // Map to valid range [1, n-1]
    // Method: k = (randomValue % (n - 1)) + 1
    const k = (keyBigInt % (SECP256K1.N - 1n)) + 1n;

    // Validate that k is in range [1, n-1]
    try {
      validatePrivateKey(k);

      // Convert back to hex (32 bytes, zero-padded)
      return k.toString(16).padStart(64, "0");
    } catch {
      // Validation failed (extremely rare), retry
      continue;
    }
  }

  throw new Error(`Failed to generate valid ephemeral key after ${MAX_ATTEMPTS} attempts`);
}

/**
 * Generate a complete ephemeral key pair
 *
 * Returns both private and public keys for ECDH.
 * The public key is compressed (33 bytes).
 *
 * @returns Ephemeral key pair
 *
 * @example
 * ```typescript
 * const ephemeralKeys = generateEphemeralKeyPair();
 *
 * // Use ephemeral keys for ECDH
 * const sharedSecret = ecdh(
 *   ephemeralKeys.privateKey,
 *   theirPublicKey
 * );
 *
 * // Immediately discard ephemeral private key after use
 * delete ephemeralKeys.privateKey;
 * ```
 */
export function generateEphemeralKeyPair(): EphemeralKeyPair {
  const privateKey = generateEphemeralPrivateKey();

  // Derive public key from private key
  const publicKeyPoint = secp.ProjectivePoint.fromPrivateKey(privateKey);
  const publicKey = Buffer.from(publicKeyPoint.toRawBytes(true)).toString("hex");

  return {
    privateKey,
    publicKey,
  };
}

/**
 * Statistical tests for ephemeral key generation quality
 *
 * These tests check for obvious biases in the CSPRNG output.
 * Used for validation during testing.
 *
 * @param sampleSize - Number of keys to generate for testing
 * @returns Test results
 */
export function validateCSPRNGQuality(sampleSize: number = 1000): {
  passed: boolean;
  distribution: { zeros: number; ones: number };
  chiSquared: number;
} {
  let bitCounts = { zeros: 0, ones: 0 };

  // Generate sample keys and count bit frequencies
  for (let i = 0; i < sampleSize; i++) {
    const key = generateEphemeralPrivateKey();
    const keyBuffer = Buffer.from(key, "hex");

    // Count bits
    for (const byte of keyBuffer) {
      for (let bit = 0; bit < 8; bit++) {
        if ((byte & (1 << bit)) === 0) {
          bitCounts.zeros++;
        } else {
          bitCounts.ones++;
        }
      }
    }
  }

  // Chi-squared test for uniform distribution
  const expected = (bitCounts.zeros + bitCounts.ones) / 2;
  const chiSquared =
    Math.pow(bitCounts.zeros - expected, 2) / expected +
    Math.pow(bitCounts.ones - expected, 2) / expected;

  // Chi-squared critical value for 1 degree of freedom at 95% confidence: 3.841
  // If chiSquared > 3.841, distribution is likely biased
  const passed = chiSquared < 3.841;

  return {
    passed,
    distribution: bitCounts,
    chiSquared,
  };
}

/**
 * Validate that ephemeral keys are never reused
 *
 * In production, you should track used ephemeral public keys
 * and ensure they are never reused.
 */
export class EphemeralKeyTracker {
  private usedKeys: Set<string> = new Set();

  /**
   * Generate and track a new ephemeral key pair
   *
   * @throws Error if key was somehow already used (extremely rare)
   */
  generateUniqueKeyPair(): EphemeralKeyPair {
    const keyPair = generateEphemeralKeyPair();

    if (this.usedKeys.has(keyPair.publicKey)) {
      throw new Error("Ephemeral key collision detected (should be impossible)");
    }

    this.usedKeys.add(keyPair.publicKey);

    // Limit memory usage: keep only last 10,000 keys
    if (this.usedKeys.size > 10000) {
      // Remove oldest entries
      const keysArray = Array.from(this.usedKeys);
      this.usedKeys = new Set(keysArray.slice(-10000));
    }

    return keyPair;
  }

  /**
   * Clear tracked keys (for testing)
   */
  clear(): void {
    this.usedKeys.clear();
  }
}

/**
 * Security best practices for ephemeral keys
 */
export const EPHEMERAL_KEY_BEST_PRACTICES = {
  /** Ephemeral keys should be used exactly once */
  USE_ONCE_ONLY: true,

  /** Ephemeral private keys should be discarded immediately after deriving shared secret */
  DISCARD_AFTER_USE: true,

  /** Never persist ephemeral keys to disk */
  NEVER_PERSIST: true,

  /** Recommended key rotation period (if using session keys) */
  ROTATION_PERIOD_MS: 3600000, // 1 hour
} as const;
