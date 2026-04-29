/**
 * BRC-3 Signature Creation Tests
 *
 * Tests for digital signature creation:
 * - Canonical message formatting
 * - Hash generation
 * - Signature format validation
 * - Request signing
 */

import { describe, it, expect, vi } from "vitest";
import type { WalletInterface, SignatureRequest } from "./types.js";
import {
  formatCanonicalMessage,
  hashForSigning,
  createSigningHash,
  signRequest,
  isValidSignatureFormat,
  extractSignatureComponents,
  createTimestampedRequest,
  type CanonicalMessage,
} from "./signing.js";

// =============================================================================
// formatCanonicalMessage Tests
// =============================================================================

describe("formatCanonicalMessage", () => {
  it("formats message with all components", () => {
    const message: CanonicalMessage = {
      protocolID: [2, "auth"],
      keyID: "request",
      counterparty: "anyone",
      data: "test data",
    };

    const result = formatCanonicalMessage(message);

    expect(result).toBe("BRC3-SIGNATURE\n2:auth\nrequest\nanyone\ntest data");
  });

  it('uses "anyone" as default counterparty', () => {
    const message: CanonicalMessage = {
      protocolID: [1, "signing"],
      keyID: "main",
      data: "payload",
    };

    const result = formatCanonicalMessage(message);

    expect(result).toContain("\nanyone\n");
  });

  it("includes timestamp when provided", () => {
    const message: CanonicalMessage = {
      protocolID: [2, "auth"],
      keyID: "request",
      data: "test",
      timestamp: 1234567890,
    };

    const result = formatCanonicalMessage(message);

    expect(result).toContain("\n1234567890");
  });

  it("handles different security levels", () => {
    const level0: CanonicalMessage = {
      protocolID: [0, "admin"],
      keyID: "key",
      data: "data",
    };
    const level1: CanonicalMessage = {
      protocolID: [1, "public"],
      keyID: "key",
      data: "data",
    };
    const level2: CanonicalMessage = {
      protocolID: [2, "private"],
      keyID: "key",
      data: "data",
    };

    expect(formatCanonicalMessage(level0)).toContain("0:admin");
    expect(formatCanonicalMessage(level1)).toContain("1:public");
    expect(formatCanonicalMessage(level2)).toContain("2:private");
  });

  it("produces deterministic output", () => {
    const message: CanonicalMessage = {
      protocolID: [2, "test"],
      keyID: "key1",
      data: "hello",
    };

    const result1 = formatCanonicalMessage(message);
    const result2 = formatCanonicalMessage(message);

    expect(result1).toBe(result2);
  });
});

// =============================================================================
// hashForSigning Tests
// =============================================================================

describe("hashForSigning", () => {
  it("returns Buffer", () => {
    const hash = hashForSigning("test");
    expect(hash).toBeInstanceOf(Buffer);
  });

  it("produces 32-byte hash", () => {
    const hash = hashForSigning("test");
    expect(hash.length).toBe(32);
  });

  it("handles Uint8Array input", () => {
    const input = new Uint8Array([1, 2, 3, 4]);
    const hash = hashForSigning(input);
    expect(hash.length).toBe(32);
  });

  it("produces same hash for equivalent inputs", () => {
    const str = "hello";
    const buf = new Uint8Array(Buffer.from(str));

    const hashStr = hashForSigning(str);
    const hashBuf = hashForSigning(buf);

    expect(hashStr.equals(hashBuf)).toBe(true);
  });
});

// =============================================================================
// createSigningHash Tests
// =============================================================================

describe("createSigningHash", () => {
  it("creates hash from signature request", () => {
    const request: SignatureRequest = {
      data: "test data",
      protocolID: [2, "auth"],
      keyID: "request",
    };

    const hash = createSigningHash(request);

    expect(hash).toBeInstanceOf(Buffer);
    expect(hash.length).toBe(32);
  });

  it("handles Uint8Array data", () => {
    const request: SignatureRequest = {
      data: new Uint8Array([1, 2, 3]),
      protocolID: [2, "auth"],
      keyID: "key",
    };

    const hash = createSigningHash(request);

    expect(hash).toBeInstanceOf(Buffer);
    expect(hash.length).toBe(32);
  });

  it("produces different hashes for different data", () => {
    const request1: SignatureRequest = {
      data: "data1",
      protocolID: [2, "auth"],
      keyID: "key",
    };
    const request2: SignatureRequest = {
      data: "data2",
      protocolID: [2, "auth"],
      keyID: "key",
    };

    const hash1 = createSigningHash(request1);
    const hash2 = createSigningHash(request2);

    expect(hash1.equals(hash2)).toBe(false);
  });

  it("produces different hashes for different protocol IDs", () => {
    const request1: SignatureRequest = {
      data: "same",
      protocolID: [1, "proto"],
      keyID: "key",
    };
    const request2: SignatureRequest = {
      data: "same",
      protocolID: [2, "proto"],
      keyID: "key",
    };

    const hash1 = createSigningHash(request1);
    const hash2 = createSigningHash(request2);

    expect(hash1.equals(hash2)).toBe(false);
  });
});

// =============================================================================
// signRequest Tests
// =============================================================================

describe("signRequest", () => {
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
        result: {
          signature: "3045022100" + "ab".repeat(32) + "022100" + "cd".repeat(32),
          publicKey: "02" + "a".repeat(64),
        },
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

  it("calls wallet createSignature with correct params", async () => {
    const wallet = createMockWallet();
    const request: SignatureRequest = {
      data: "test data",
      protocolID: [2, "auth"],
      keyID: "request",
      description: "Test signature",
    };

    await signRequest(wallet, request);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(wallet.createSignature).toHaveBeenCalledWith({
      data: "test data",
      protocolID: [2, "auth"],
      keyID: "request",
      counterparty: undefined,
      description: "Test signature",
    });
  });

  it("returns signature and public key", async () => {
    const wallet = createMockWallet();
    const request: SignatureRequest = {
      data: "test",
      protocolID: [2, "auth"],
      keyID: "key",
    };

    const result = await signRequest(wallet, request);

    expect(result.signature).toBeDefined();
    expect(result.publicKey).toBe("02" + "a".repeat(64));
  });

  it("throws on wallet error", async () => {
    const wallet = createMockWallet();
    (
      wallet.createSignature as unknown as { mockResolvedValue: (v: unknown) => void }
    ).mockResolvedValue({
      success: false,
      error: "Signature failed",
    });

    const request: SignatureRequest = {
      data: "test",
      protocolID: [2, "auth"],
      keyID: "key",
    };

    await expect(signRequest(wallet, request)).rejects.toThrow("Signature failed");
  });

  it("handles Uint8Array data", async () => {
    const wallet = createMockWallet();
    const request: SignatureRequest = {
      data: new Uint8Array([1, 2, 3]),
      protocolID: [2, "auth"],
      keyID: "key",
    };

    const result = await signRequest(wallet, request);

    expect(result.signature).toBeDefined();
    // Data should be converted to hex string
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(wallet.createSignature).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.any(String),
      }),
    );
  });
});

// =============================================================================
// isValidSignatureFormat Tests
// =============================================================================

describe("isValidSignatureFormat", () => {
  it("returns true for valid DER signature", () => {
    // Valid DER format: 0x30 [len] 0x02 [R-len] [R] 0x02 [S-len] [S]
    const validSig = "3045022100" + "ab".repeat(32) + "0220" + "cd".repeat(32);

    expect(isValidSignatureFormat(validSig)).toBe(true);
  });

  it("returns false for non-hex string", () => {
    expect(isValidSignatureFormat("not-hex")).toBe(false);
  });

  it("returns false for too short signature", () => {
    expect(isValidSignatureFormat("3045")).toBe(false);
  });

  it("returns false for wrong start byte", () => {
    // DER signatures must start with 0x30
    const wrongStart = "4045022100" + "ab".repeat(32) + "0220" + "cd".repeat(32);

    expect(isValidSignatureFormat(wrongStart)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidSignatureFormat("")).toBe(false);
  });
});

// =============================================================================
// extractSignatureComponents Tests
// =============================================================================

describe("extractSignatureComponents", () => {
  it("extracts r and s from valid DER signature", () => {
    // Construct a properly formatted DER signature
    const r = "ab".repeat(32);
    const s = "cd".repeat(32);
    // r=32 bytes, no leading zero needed if high bit not set
    // s=32 bytes
    const derSig =
      "3044" + // SEQUENCE, 68 bytes
      "0220" +
      r + // INTEGER, 32 bytes
      "0220" +
      s; // INTEGER, 32 bytes

    const result = extractSignatureComponents(derSig);

    expect(result).not.toBeNull();
    expect(result?.r).toBeDefined();
    expect(result?.s).toBeDefined();
  });

  it("returns null for invalid signature", () => {
    const result = extractSignatureComponents("invalid");

    expect(result).toBeNull();
  });

  it("returns null for signature with wrong tag", () => {
    const wrongTag = "40440220" + "ab".repeat(32) + "0220" + "cd".repeat(32);

    const result = extractSignatureComponents(wrongTag);

    expect(result).toBeNull();
  });
});

// =============================================================================
// createTimestampedRequest Tests
// =============================================================================

describe("createTimestampedRequest", () => {
  it("adds timestamp to request", () => {
    const before = Date.now();
    const request = createTimestampedRequest("data", [2, "auth"], "key");
    const after = Date.now();

    expect(request.timestamp).toBeGreaterThanOrEqual(before);
    expect(request.timestamp).toBeLessThanOrEqual(after);
  });

  it("adds nonce to request", () => {
    const request = createTimestampedRequest("data", [2, "auth"], "key");

    expect(request.nonce).toBeDefined();
    expect(request.nonce.length).toBe(32); // 16 bytes = 32 hex chars
  });

  it("embeds timestamp and nonce in data", () => {
    const request = createTimestampedRequest("original data", [2, "auth"], "key");

    expect(request.data).toContain("original data");
    expect(request.data).toContain(request.timestamp.toString());
    expect(request.data).toContain(request.nonce);
  });

  it("includes protocol ID and key ID", () => {
    const request = createTimestampedRequest("data", [2, "myproto"], "mykey");

    expect(request.protocolID).toEqual([2, "myproto"]);
    expect(request.keyID).toBe("mykey");
  });

  it("includes counterparty when provided", () => {
    const counterparty = "02" + "a".repeat(64);
    const request = createTimestampedRequest("data", [2, "auth"], "key", counterparty);

    expect(request.counterparty).toBe(counterparty);
  });

  it("generates unique nonces", () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const request = createTimestampedRequest("data", [2, "auth"], "key");
      nonces.add(request.nonce);
    }

    expect(nonces.size).toBe(100);
  });
});
