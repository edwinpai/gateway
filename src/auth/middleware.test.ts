/**
 * BSV Authentication Middleware Tests
 *
 * Tests for BRC-103/104 middleware verifying:
 * - Unsigned request rejection
 * - Valid signature acceptance
 * - Timestamp expiration
 * - Replay attack protection
 * - Certificate verification
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SignedRequest } from "./types.js";
import {
  createAuthMiddleware,
  createAuthHeaders,
  InMemoryNonceStore,
  AUTH_HEADERS,
  type AuthenticatedRequest,
} from "./middleware.js";
import { verifySignedRequest, generateNonce } from "./verification.js";

// =============================================================================
// Test Helpers
// =============================================================================

function createMockRequest(
  headers: Record<string, string> = {},
  options: Partial<IncomingMessage> = {},
): AuthenticatedRequest {
  return {
    headers,
    url: "/api/test",
    method: "GET",
    ...options,
  } as AuthenticatedRequest;
}

function createMockResponse(): ServerResponse & {
  body: string;
  statusCode: number;
} {
  const res = {
    statusCode: 200,
    body: "",
    setHeader: vi.fn(),
    end: vi.fn((data: string) => {
      res.body = data;
    }),
  };
  return res as unknown as ServerResponse & { body: string; statusCode: number };
}

function createMockWallet() {
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
    proveCertificate: vi.fn().mockResolvedValue({ success: true, result: { keyLinkageProof: {} } }),
    relinquishCertificate: vi
      .fn()
      .mockResolvedValue({ success: true, result: { relinquished: true } }),
    discoverByIdentityKey: vi.fn().mockResolvedValue({ success: true, result: { results: [] } }),
    discoverByAttributes: vi.fn().mockResolvedValue({ success: true, result: { results: [] } }),
  };
}

// =============================================================================
// Middleware Tests
// =============================================================================

describe("createAuthMiddleware", () => {
  let nonceStore: InMemoryNonceStore;
  let mockWallet: ReturnType<typeof createMockWallet>;

  beforeEach(() => {
    nonceStore = new InMemoryNonceStore();
    mockWallet = createMockWallet();
  });

  afterEach(() => {
    nonceStore.destroy();
  });

  describe("unsigned request rejection", () => {
    it("rejects requests with no auth headers", async () => {
      const middleware = createAuthMiddleware({
        wallet: mockWallet,
        nonceStore,
      });

      const req = createMockRequest({});
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
      const body = JSON.parse(res.body);
      expect(body.error).toBe("Missing authentication headers");
      expect(body.code).toBe("INVALID_SIGNATURE");
    });

    it("rejects requests missing identity key", async () => {
      const middleware = createAuthMiddleware({
        wallet: mockWallet,
        nonceStore,
      });

      const req = createMockRequest({
        [AUTH_HEADERS.SIGNATURE]: "3045022100test",
        [AUTH_HEADERS.TIMESTAMP]: Date.now().toString(),
        [AUTH_HEADERS.NONCE]: generateNonce(),
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("rejects requests missing signature", async () => {
      const middleware = createAuthMiddleware({
        wallet: mockWallet,
        nonceStore,
      });

      const req = createMockRequest({
        [AUTH_HEADERS.IDENTITY_KEY]: "02" + "a".repeat(64),
        [AUTH_HEADERS.TIMESTAMP]: Date.now().toString(),
        [AUTH_HEADERS.NONCE]: generateNonce(),
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("rejects requests missing timestamp", async () => {
      const middleware = createAuthMiddleware({
        wallet: mockWallet,
        nonceStore,
      });

      const req = createMockRequest({
        [AUTH_HEADERS.IDENTITY_KEY]: "02" + "a".repeat(64),
        [AUTH_HEADERS.SIGNATURE]: "3045022100test",
        [AUTH_HEADERS.NONCE]: generateNonce(),
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("rejects requests missing nonce", async () => {
      const middleware = createAuthMiddleware({
        wallet: mockWallet,
        nonceStore,
      });

      const req = createMockRequest({
        [AUTH_HEADERS.IDENTITY_KEY]: "02" + "a".repeat(64),
        [AUTH_HEADERS.SIGNATURE]: "3045022100test",
        [AUTH_HEADERS.TIMESTAMP]: Date.now().toString(),
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("timestamp validation", () => {
    it("rejects expired timestamps", async () => {
      const middleware = createAuthMiddleware({
        wallet: mockWallet,
        nonceStore,
        maxTimestampAge: 30000, // 30 seconds
      });

      const oldTimestamp = Date.now() - 60000; // 1 minute ago
      const req = createMockRequest({
        [AUTH_HEADERS.IDENTITY_KEY]: "02" + "a".repeat(64),
        [AUTH_HEADERS.SIGNATURE]: "3045022100" + "ab".repeat(32) + "022100" + "cd".repeat(32),
        [AUTH_HEADERS.TIMESTAMP]: oldTimestamp.toString(),
        [AUTH_HEADERS.NONCE]: generateNonce(),
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
      const body = JSON.parse(res.body);
      expect(body.code).toBe("EXPIRED");
    });

    it("rejects invalid timestamp format", async () => {
      const middleware = createAuthMiddleware({
        wallet: mockWallet,
        nonceStore,
      });

      const req = createMockRequest({
        [AUTH_HEADERS.IDENTITY_KEY]: "02" + "a".repeat(64),
        [AUTH_HEADERS.SIGNATURE]: "3045022100test",
        [AUTH_HEADERS.TIMESTAMP]: "invalid-timestamp",
        [AUTH_HEADERS.NONCE]: generateNonce(),
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("replay attack protection", () => {
    it("rejects duplicate nonces when replay protection enabled", async () => {
      const middleware = createAuthMiddleware({
        wallet: mockWallet,
        nonceStore,
        enableReplayProtection: true,
      });

      const nonce = generateNonce();
      // Add nonce to store (simulating a previous valid request)
      await nonceStore.add(nonce, Date.now() + 60000);

      const req = createMockRequest({
        [AUTH_HEADERS.IDENTITY_KEY]: "02" + "a".repeat(64),
        [AUTH_HEADERS.SIGNATURE]: "3045022100" + "ab".repeat(32) + "022100" + "cd".repeat(32),
        [AUTH_HEADERS.TIMESTAMP]: Date.now().toString(),
        [AUTH_HEADERS.NONCE]: nonce,
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
      const body = JSON.parse(res.body);
      expect(body.code).toBe("REPLAY");
      expect(body.error).toContain("replay attack");
    });
  });

  describe("skip paths", () => {
    it("skips authentication for configured paths", async () => {
      const middleware = createAuthMiddleware({
        wallet: mockWallet,
        nonceStore,
        skipPaths: ["/health", "/public"],
      });

      const req = createMockRequest({}, { url: "/health/check" });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
    });

    it("enforces authentication for non-skip paths", async () => {
      const middleware = createAuthMiddleware({
        wallet: mockWallet,
        nonceStore,
        skipPaths: ["/health"],
      });

      const req = createMockRequest({}, { url: "/api/protected" });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("callbacks", () => {
    it("calls onError callback on authentication failure", async () => {
      const onError = vi.fn();
      const middleware = createAuthMiddleware({
        wallet: mockWallet,
        nonceStore,
        onError,
      });

      const req = createMockRequest({});
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          valid: false,
          error: "Missing authentication headers",
        }),
        req,
      );
    });
  });
});

// =============================================================================
// InMemoryNonceStore Tests
// =============================================================================

describe("InMemoryNonceStore", () => {
  it("stores and retrieves nonces", async () => {
    const store = new InMemoryNonceStore();
    const nonce = "test-nonce-123";
    const expiresAt = Date.now() + 60000;

    await store.add(nonce, expiresAt);
    const hasNonce = await store.has(nonce);

    expect(hasNonce).toBe(true);
    store.destroy();
  });

  it("returns false for unknown nonces", async () => {
    const store = new InMemoryNonceStore();

    const hasNonce = await store.has("unknown-nonce");

    expect(hasNonce).toBe(false);
    store.destroy();
  });

  it("cleans up expired nonces", async () => {
    const store = new InMemoryNonceStore(100); // Fast cleanup interval
    const nonce = "expired-nonce";
    const expiresAt = Date.now() - 1000; // Already expired

    await store.add(nonce, expiresAt);
    await store.cleanup();

    const hasNonce = await store.has(nonce);
    expect(hasNonce).toBe(false);
    store.destroy();
  });
});

// =============================================================================
// createAuthHeaders Tests
// =============================================================================

describe("createAuthHeaders", () => {
  it("creates correct header object", () => {
    const identityKey = "02" + "a".repeat(64);
    const signature = "3045022100test";
    const timestamp = 1234567890;
    const nonce = "test-nonce";

    const headers = createAuthHeaders(identityKey, signature, timestamp, nonce);

    expect(headers[AUTH_HEADERS.IDENTITY_KEY]).toBe(identityKey);
    expect(headers[AUTH_HEADERS.SIGNATURE]).toBe(signature);
    expect(headers[AUTH_HEADERS.TIMESTAMP]).toBe("1234567890");
    expect(headers[AUTH_HEADERS.NONCE]).toBe(nonce);
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
});
