/**
 * BRC-100 Signature Verification Tests
 *
 * Tests for ECDSA signature verification with secp256k1:
 * - Public key PEM conversion
 * - SHA-256 hashing
 * - Signature verification
 * - Request verification
 */

import { describe, it, expect, vi } from "vitest";
import type { SignedRequest, WalletInterface } from "./types.js";
import {
  publicKeyToPem,
  sha256,
  verifySignature,
  verifySignedRequest,
  generateNonce,
  createMessageHash,
  WalletVerifier,
} from "./verification.js";

// =============================================================================
// publicKeyToPem Tests
// =============================================================================

describe("publicKeyToPem", () => {
  it("converts valid compressed public key to PEM", () => {
    // Valid compressed public key (02 prefix = even y coordinate)
    const pubKeyHex = "02" + "a".repeat(64);
    const pem = publicKeyToPem(pubKeyHex);

    expect(pem).toContain("-----BEGIN PUBLIC KEY-----");
    expect(pem).toContain("-----END PUBLIC KEY-----");
  });

  it("converts 03 prefix public key to PEM", () => {
    // Valid compressed public key (03 prefix = odd y coordinate)
    const pubKeyHex = "03" + "b".repeat(64);
    const pem = publicKeyToPem(pubKeyHex);

    expect(pem).toContain("-----BEGIN PUBLIC KEY-----");
    expect(pem).toContain("-----END PUBLIC KEY-----");
  });

  it("throws for invalid key length", () => {
    expect(() => publicKeyToPem("02abcd")).toThrow("Invalid compressed public key length");
  });

  it("throws for empty key", () => {
    expect(() => publicKeyToPem("")).toThrow("Invalid compressed public key length");
  });
});

// =============================================================================
// sha256 Tests
// =============================================================================

describe("sha256", () => {
  it("hashes string correctly", () => {
    const hash = sha256("hello");
    expect(hash).toBeInstanceOf(Buffer);
    expect(hash.length).toBe(32); // 256 bits = 32 bytes
  });

  it("produces deterministic output", () => {
    const hash1 = sha256("test");
    const hash2 = sha256("test");
    expect(hash1.equals(hash2)).toBe(true);
  });

  it("produces different hashes for different inputs", () => {
    const hash1 = sha256("hello");
    const hash2 = sha256("world");
    expect(hash1.equals(hash2)).toBe(false);
  });

  it("hashes Buffer correctly", () => {
    const buffer = Buffer.from("hello");
    const hash = sha256(buffer);
    expect(hash).toBeInstanceOf(Buffer);
    expect(hash.length).toBe(32);
  });

  it("produces same hash for string and equivalent Buffer", () => {
    const hashStr = sha256("hello");
    const hashBuf = sha256(Buffer.from("hello"));
    expect(hashStr.equals(hashBuf)).toBe(true);
  });
});

// =============================================================================
// verifySignature Tests
// =============================================================================

describe("verifySignature", () => {
  it("returns false for malformed signature", () => {
    const message = "test message";
    const invalidSig = "not-a-valid-signature";
    const pubKey = "02" + "a".repeat(64);

    const result = verifySignature(message, invalidSig, pubKey);

    expect(result).toBe(false);
  });

  it("returns false for invalid public key", () => {
    const message = "test message";
    const signature = "3045022100" + "ab".repeat(32) + "022100" + "cd".repeat(32);
    const invalidPubKey = "invalid-key";

    const result = verifySignature(message, signature, invalidPubKey);

    expect(result).toBe(false);
  });

  it("returns false for mismatched signature", () => {
    const message = "test message";
    // Valid DER format but not matching the message/key
    const signature = "3045022100" + "ab".repeat(32) + "022100" + "cd".repeat(32);
    const pubKey = "02" + "a".repeat(64);

    const result = verifySignature(message, signature, pubKey);

    expect(result).toBe(false);
  });
});

// =============================================================================
// verifySignedRequest Tests
// =============================================================================

describe("verifySignedRequest", () => {
  it("rejects expired requests", () => {
    const request: SignedRequest = {
      method: "GET",
      path: "/test",
      timestamp: Date.now() - 60000, // 1 minute ago
      nonce: generateNonce(),
      identityKey: "02" + "a".repeat(64),
      signature: "3045022100test",
    };

    const result = verifySignedRequest(request, { maxTimestampAge: 30000 });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("EXPIRED");
    expect(result.error).toContain("timestamp age");
  });

  it("accepts requests within timestamp tolerance", () => {
    const request: SignedRequest = {
      method: "GET",
      path: "/test",
      timestamp: Date.now() - 5000, // 5 seconds ago
      nonce: generateNonce(),
      identityKey: "02" + "a".repeat(64),
      signature: "3045022100" + "ab".repeat(32) + "022100" + "cd".repeat(32),
    };

    // Will fail on signature but not on timestamp
    const result = verifySignedRequest(request, { maxTimestampAge: 30000 });

    expect(result.errorCode).not.toBe("EXPIRED");
  });

  it("rejects invalid signatures", () => {
    const request: SignedRequest = {
      method: "GET",
      path: "/test",
      timestamp: Date.now(),
      nonce: generateNonce(),
      identityKey: "02" + "a".repeat(64),
      signature: "invalid-signature",
    };

    const result = verifySignedRequest(request);

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("INVALID_SIGNATURE");
  });

  it("includes verifiedAt timestamp", () => {
    const request: SignedRequest = {
      method: "GET",
      path: "/test",
      timestamp: Date.now(),
      nonce: generateNonce(),
      identityKey: "02" + "a".repeat(64),
      signature: "invalid",
    };

    const before = Date.now();
    const result = verifySignedRequest(request);
    const after = Date.now();

    expect(result.verifiedAt).toBeGreaterThanOrEqual(before);
    expect(result.verifiedAt).toBeLessThanOrEqual(after);
  });
});

// =============================================================================
// generateNonce Tests
// =============================================================================

describe("generateNonce", () => {
  it("generates 32-character hex string by default", () => {
    const nonce = generateNonce();

    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it("generates unique nonces", () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 100; i++) {
      nonces.add(generateNonce());
    }

    expect(nonces.size).toBe(100); // All should be unique
  });
});

// =============================================================================
// createMessageHash Tests
// =============================================================================

describe("createMessageHash", () => {
  it("returns hex string", () => {
    const hash = createMessageHash("test");

    expect(hash).toMatch(/^[0-9a-f]{64}$/); // 32 bytes = 64 hex chars
  });

  it("produces deterministic output", () => {
    const hash1 = createMessageHash("hello");
    const hash2 = createMessageHash("hello");

    expect(hash1).toBe(hash2);
  });
});

// =============================================================================
// WalletVerifier Tests
// =============================================================================

describe("WalletVerifier", () => {
  function createMockWallet(): WalletInterface {
    return {
      getPublicKey: vi.fn().mockResolvedValue({
        success: true,
        result: { publicKey: "02" + "a".repeat(64) },
      }),
      isAuthenticated: vi.fn().mockResolvedValue({
        success: true,
        result: { authenticated: true },
      }),
      createSignature: vi.fn().mockResolvedValue({
        success: true,
        result: { signature: "sig", publicKey: "02" + "a".repeat(64) },
      }),
      verifySignature: vi.fn().mockResolvedValue({
        success: true,
        result: { valid: true },
      }),
      encrypt: vi.fn().mockResolvedValue({ success: true, result: { ciphertext: "" } }),
      decrypt: vi.fn().mockResolvedValue({ success: true, result: { plaintext: "" } }),
      acquireCertificate: vi.fn().mockResolvedValue({ success: true, result: { certificate: {} } }),
      listCertificates: vi.fn().mockResolvedValue({ success: true, result: { certificates: [] } }),
      proveCertificate: vi
        .fn()
        .mockResolvedValue({ success: true, result: { keyLinkageProof: {} } }),
      relinquishCertificate: vi
        .fn()
        .mockResolvedValue({ success: true, result: { relinquished: true } }),
      discoverByIdentityKey: vi.fn().mockResolvedValue({ success: true, result: { results: [] } }),
      discoverByAttributes: vi.fn().mockResolvedValue({ success: true, result: { results: [] } }),
    };
  }

  describe("verify", () => {
    it("returns true for valid signature", async () => {
      const wallet = createMockWallet();
      const verifier = new WalletVerifier(wallet);

      const result = await verifier.verify("test data", "signature", [2, "auth"], "key1");

      expect(result).toBe(true);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(wallet.verifySignature).toHaveBeenCalledWith({
        data: "test data",
        signature: "signature",
        protocolID: [2, "auth"],
        keyID: "key1",
      });
    });

    it("returns false when wallet returns invalid", async () => {
      const wallet = createMockWallet();
      (wallet.verifySignature as unknown as { mockResolvedValue: Function }).mockResolvedValue({
        success: true,
        result: { valid: false },
      });
      const verifier = new WalletVerifier(wallet);

      const result = await verifier.verify("data", "sig", [2, "auth"], "key");

      expect(result).toBe(false);
    });

    it("returns false on wallet error", async () => {
      const wallet = createMockWallet();
      (wallet.verifySignature as unknown as { mockResolvedValue: Function }).mockResolvedValue({
        success: false,
        error: "Wallet error",
      });
      const verifier = new WalletVerifier(wallet);

      const result = await verifier.verify("data", "sig", [2, "auth"], "key");

      expect(result).toBe(false);
    });
  });

  describe("verifyRequest", () => {
    it("rejects expired requests", async () => {
      const wallet = createMockWallet();
      const verifier = new WalletVerifier(wallet);

      const request: SignedRequest = {
        method: "GET",
        path: "/test",
        timestamp: Date.now() - 60000, // 1 minute ago
        nonce: generateNonce(),
        identityKey: "02" + "a".repeat(64),
        signature: "sig",
      };

      const result = await verifier.verifyRequest(request, { maxTimestampAge: 30000 });

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("EXPIRED");
    });

    it("returns verified identity on success", async () => {
      const wallet = createMockWallet();
      const verifier = new WalletVerifier(wallet);
      const identityKey = "02" + "a".repeat(64);

      const request: SignedRequest = {
        method: "GET",
        path: "/test",
        timestamp: Date.now(),
        nonce: generateNonce(),
        identityKey,
        signature: "valid-sig",
      };

      const result = await verifier.verifyRequest(request);

      expect(result.valid).toBe(true);
      expect(result.identity?.identityKey).toBe(identityKey);
    });
  });
});
