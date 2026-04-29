/**
 * RFC 6979 Test Vectors
 *
 * Test vectors from RFC 6979 Appendix A.2.5 (ECDSA, 256 bits - secp256k1)
 *
 * These tests verify that our deterministic k generation matches the
 * published RFC 6979 test vectors exactly.
 *
 * @see https://tools.ietf.org/html/rfc6979#appendix-A.2.5
 */

import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { generateDeterministicK, isValidK, getCurveOrder } from "../rfc6979.js";

/**
 * Hash a message with SHA-256
 */
function sha256Hash(message: string): Buffer {
  return createHash("sha256").update(message, "utf-8").digest();
}

describe("RFC 6979 - Deterministic ECDSA", () => {
  /**
   * Test vector from RFC 6979 Appendix A.2.5
   * Curve: secp256k1
   * Hash: SHA-256
   */
  const TEST_PRIVATE_KEY = "C9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721";

  describe("Test Vector: secp256k1 with SHA-256", () => {
    it('should generate correct k for message "sample"', () => {
      const privateKey = Buffer.from(TEST_PRIVATE_KEY, "hex");
      const message = "sample";
      const messageHash = sha256Hash(message);

      const k = generateDeterministicK(messageHash, privateKey);

      // Expected k from RFC 6979 Appendix A.2.5
      const expectedK = BigInt(
        "0xA6E3C57DD01ABE90086538398355DD4C3B17AA873382B0F24D6129493D8AAD60",
      );

      expect(k).toBe(expectedK);
      expect(isValidK(k)).toBe(true);
    });

    it('should generate correct k for message "test"', () => {
      const privateKey = Buffer.from(TEST_PRIVATE_KEY, "hex");
      const message = "test";
      const messageHash = sha256Hash(message);

      const k = generateDeterministicK(messageHash, privateKey);

      // Expected k from RFC 6979 Appendix A.2.5
      const expectedK = BigInt(
        "0xD16B6AE827F17175E040871A1C7EC3500192C4C92677336EC2537ACAEE0008E0",
      );

      expect(k).toBe(expectedK);
      expect(isValidK(k)).toBe(true);
    });

    it("should generate k in valid range [1, n-1]", () => {
      const privateKey = Buffer.from(TEST_PRIVATE_KEY, "hex");
      const message = "sample";
      const messageHash = sha256Hash(message);

      const k = generateDeterministicK(messageHash, privateKey);
      const n = getCurveOrder();

      expect(k >= 1n).toBe(true);
      expect(k < n).toBe(true);
    });

    it("should generate same k for same inputs (determinism)", () => {
      const privateKey = Buffer.from(TEST_PRIVATE_KEY, "hex");
      const message = "sample";
      const messageHash = sha256Hash(message);

      const k1 = generateDeterministicK(messageHash, privateKey);
      const k2 = generateDeterministicK(messageHash, privateKey);

      expect(k1).toBe(k2);
    });

    it("should generate different k for different messages", () => {
      const privateKey = Buffer.from(TEST_PRIVATE_KEY, "hex");

      const messageHash1 = sha256Hash("sample");
      const messageHash2 = sha256Hash("test");

      const k1 = generateDeterministicK(messageHash1, privateKey);
      const k2 = generateDeterministicK(messageHash2, privateKey);

      expect(k1).not.toBe(k2);
    });

    it("should generate different k for different private keys", () => {
      const privateKey1 = Buffer.from(TEST_PRIVATE_KEY, "hex");
      const privateKey2 = Buffer.from(
        "AAAA000011112222333344445555666677778888999900001111222233334444",
        "hex",
      );

      const messageHash = sha256Hash("sample");

      const k1 = generateDeterministicK(messageHash, privateKey1);
      const k2 = generateDeterministicK(messageHash, privateKey2);

      expect(k1).not.toBe(k2);
    });
  });

  describe("Input Validation", () => {
    it("should reject message hash with wrong length", () => {
      const privateKey = Buffer.from(TEST_PRIVATE_KEY, "hex");
      const invalidHash = Buffer.alloc(16); // Wrong size

      expect(() => generateDeterministicK(invalidHash, privateKey)).toThrow(
        "Invalid message hash length",
      );
    });

    it("should reject private key with wrong length", () => {
      const invalidPrivateKey = Buffer.alloc(16); // Wrong size
      const messageHash = sha256Hash("sample");

      expect(() => generateDeterministicK(messageHash, invalidPrivateKey)).toThrow(
        "Invalid private key length",
      );
    });
  });

  describe("Additional Test Vectors from RFC 6979", () => {
    /**
     * Additional test vectors to ensure comprehensive coverage
     * These are from RFC 6979 Appendix A.2.5
     */
    const testVectors = [
      {
        message: "sample",
        expectedK: "A6E3C57DD01ABE90086538398355DD4C3B17AA873382B0F24D6129493D8AAD60",
      },
      {
        message: "test",
        expectedK: "D16B6AE827F17175E040871A1C7EC3500192C4C92677336EC2537ACAEE0008E0",
      },
    ];

    testVectors.forEach(({ message, expectedK }) => {
      it(`should match RFC 6979 k for message "${message}"`, () => {
        const privateKey = Buffer.from(TEST_PRIVATE_KEY, "hex");
        const messageHash = sha256Hash(message);

        const k = generateDeterministicK(messageHash, privateKey);
        const expected = BigInt("0x" + expectedK);

        expect(k).toBe(expected);
      });
    });
  });

  describe("Security Properties", () => {
    it("should never generate k = 0", () => {
      const privateKey = Buffer.from(TEST_PRIVATE_KEY, "hex");

      // Try with multiple different messages
      const messages = ["sample", "test", "hello", "world", "security"];

      for (const message of messages) {
        const messageHash = sha256Hash(message);
        const k = generateDeterministicK(messageHash, privateKey);
        expect(k).not.toBe(0n);
      }
    });

    it("should never generate k >= n (curve order)", () => {
      const privateKey = Buffer.from(TEST_PRIVATE_KEY, "hex");
      const n = getCurveOrder();

      const messages = ["sample", "test", "hello", "world", "security"];

      for (const message of messages) {
        const messageHash = sha256Hash(message);
        const k = generateDeterministicK(messageHash, privateKey);
        expect(k < n).toBe(true);
      }
    });
  });
});

/**
 * NOTE: Full signature generation (r, s) requires elliptic curve operations.
 * For complete ECDSA signing, integrate with @noble/secp256k1:
 *
 * import * as secp from '@noble/secp256k1';
 *
 * async function signWithRFC6979(messageHash: Buffer, privateKey: Buffer) {
 *   const k = generateDeterministicK(messageHash, privateKey);
 *   // Use k with secp256k1 signing
 *   // This ensures deterministic signatures
 * }
 */
