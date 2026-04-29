/**
 * BRC-107/108 Identity Verification Middleware Tests
 *
 * Tests for certificate-based authentication verifying:
 * - Header extraction and validation
 * - Signature verification
 * - Certificate verification
 * - Error handling
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProtocolID, VerifiableCertificate } from "./types.js";
import {
  createBRC107Middleware,
  createBRC107Headers,
  requireBRC107Certificates,
  allowBRC107Identities,
  BRC107_HEADERS,
  type BRC107AuthenticatedRequest,
} from "./brc107-middleware.js";

// =============================================================================
// Test Helpers
// =============================================================================

function createMockRequest(
  headers: Record<string, string> = {},
  options: Partial<IncomingMessage> = {},
): BRC107AuthenticatedRequest {
  return {
    headers,
    url: "/api/test",
    method: "GET",
    ...options,
  } as BRC107AuthenticatedRequest;
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

function createValidHeaders(): Record<string, string> {
  return {
    [BRC107_HEADERS.IDENTITY_KEY]: "02" + "a".repeat(64),
    [BRC107_HEADERS.SIGNATURE]: "3045022100" + "ab".repeat(32) + "022100" + "cd".repeat(32),
    [BRC107_HEADERS.TIMESTAMP]: Date.now().toString(),
    [BRC107_HEADERS.NONCE]: "a".repeat(32),
    [BRC107_HEADERS.PROTOCOL_ID]: "2:auth",
    [BRC107_HEADERS.KEY_ID]: "request",
  };
}

// =============================================================================
// BRC-107 Middleware Tests
// =============================================================================

describe("createBRC107Middleware", () => {
  let mockWallet: ReturnType<typeof createMockWallet>;

  beforeEach(() => {
    mockWallet = createMockWallet();
  });

  describe("header validation", () => {
    it("rejects requests with no auth headers", async () => {
      const middleware = createBRC107Middleware({
        wallet: mockWallet,
      });

      const req = createMockRequest({});
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
      const body = JSON.parse(res.body);
      expect(body.error).toBe("MISSING_HEADER");
      expect(body.message).toContain("Missing required authentication headers");
    });

    it("rejects requests with invalid identity key format", async () => {
      const middleware = createBRC107Middleware({
        wallet: mockWallet,
      });

      const headers = createValidHeaders();
      headers[BRC107_HEADERS.IDENTITY_KEY] = "invalid-key";

      const req = createMockRequest(headers);
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe("INVALID_FORMAT");
      expect(body.message).toContain("Invalid identity key format");
    });

    it("rejects requests with invalid timestamp format", async () => {
      const middleware = createBRC107Middleware({
        wallet: mockWallet,
      });

      const headers = createValidHeaders();
      headers[BRC107_HEADERS.TIMESTAMP] = "not-a-number";

      const req = createMockRequest(headers);
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe("INVALID_FORMAT");
    });

    it("rejects requests with invalid protocol ID format", async () => {
      const middleware = createBRC107Middleware({
        wallet: mockWallet,
      });

      const headers = createValidHeaders();
      headers[BRC107_HEADERS.PROTOCOL_ID] = "invalid";

      const req = createMockRequest(headers);
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe("INVALID_FORMAT");
      expect(body.message).toContain("protocol ID");
    });

    it("rejects requests with invalid security level", async () => {
      const middleware = createBRC107Middleware({
        wallet: mockWallet,
      });

      const headers = createValidHeaders();
      headers[BRC107_HEADERS.PROTOCOL_ID] = "5:auth"; // Level 5 is invalid

      const req = createMockRequest(headers);
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe("INVALID_FORMAT");
      expect(body.message).toContain("security level");
    });
  });

  describe("timestamp validation", () => {
    it("rejects expired timestamps", async () => {
      const middleware = createBRC107Middleware({
        wallet: mockWallet,
        maxTimestampAge: 30000,
      });

      const headers = createValidHeaders();
      headers[BRC107_HEADERS.TIMESTAMP] = (Date.now() - 60000).toString();

      const req = createMockRequest(headers);
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(410); // Gone status for expired
      const body = JSON.parse(res.body);
      expect(body.error).toBe("EXPIRED");
    });

    it("rejects future timestamps", async () => {
      const middleware = createBRC107Middleware({
        wallet: mockWallet,
        maxFutureTimestamp: 5000,
      });

      const headers = createValidHeaders();
      headers[BRC107_HEADERS.TIMESTAMP] = (Date.now() + 30000).toString(); // 30s in future

      const req = createMockRequest(headers);
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe("INVALID_FORMAT");
      expect(body.message).toContain("future");
    });
  });

  describe("nonce validation", () => {
    it("rejects nonces with invalid format", async () => {
      const middleware = createBRC107Middleware({
        wallet: mockWallet,
      });

      const headers = createValidHeaders();
      headers[BRC107_HEADERS.NONCE] = "short"; // Less than 16 chars

      const req = createMockRequest(headers);
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe("INVALID_NONCE");
    });

    it("detects replay attacks", async () => {
      const usedNonces = new Set<string>();

      const middleware = createBRC107Middleware({
        wallet: mockWallet,
        validateNonce: async (nonce) => usedNonces.has(nonce),
        storeNonce: async (nonce) => {
          usedNonces.add(nonce);
        },
      });

      const nonce = "a".repeat(32);
      usedNonces.add(nonce);

      const headers = createValidHeaders();
      headers[BRC107_HEADERS.NONCE] = nonce;

      const req = createMockRequest(headers);
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(409); // Conflict
      const body = JSON.parse(res.body);
      expect(body.error).toBe("REPLAY");
    });
  });

  describe("skip paths", () => {
    it("skips authentication for configured paths", async () => {
      const middleware = createBRC107Middleware({
        wallet: mockWallet,
        skipPaths: ["/health", "/public"],
      });

      const req = createMockRequest({}, { url: "/health/check" });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
    });
  });

  describe("identity-core verification seam", () => {
    it("uses injected identityCore.verifySignature for request verification with canonical request data", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-25T12:00:00.000Z"));

      try {
        const verifySignature = vi.fn().mockResolvedValue({ valid: true });
        const middleware = createBRC107Middleware({
          wallet: mockWallet,
          identityCore: { verifySignature },
        });

        const timestamp = Date.parse("2026-04-25T11:59:55.000Z");
        const nonce = "abcdef1234567890abcdef1234567890";
        const signature = "3045022100" + "ab".repeat(32) + "022100" + "cd".repeat(32);
        const identityKey = "02" + "a".repeat(64);

        const req = createMockRequest({
          [BRC107_HEADERS.IDENTITY_KEY]: identityKey,
          [BRC107_HEADERS.SIGNATURE]: signature,
          [BRC107_HEADERS.TIMESTAMP]: timestamp.toString(),
          [BRC107_HEADERS.NONCE]: nonce,
          [BRC107_HEADERS.PROTOCOL_ID]: "2:auth",
          [BRC107_HEADERS.KEY_ID]: "request",
        });
        const res = createMockResponse();
        const next = vi.fn();

        await middleware(req, res, next);

        expect(verifySignature).toHaveBeenCalledTimes(1);
        expect(verifySignature).toHaveBeenCalledWith({
          data: ["GET", "/api/test", timestamp.toString(), nonce, "2:auth", "request", ""].join(
            "\n",
          ),
          signature,
          publicKey: identityKey,
        });
        expect(next).toHaveBeenCalledOnce();
        expect(res.statusCode).toBe(200);
      } finally {
        vi.useRealTimers();
      }
    });

    it("uses injected identityCore.verifySignature for both request and certificate verification when certificates are required", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-25T12:00:00.000Z"));

      try {
        const verifySignature = vi.fn().mockResolvedValue({ valid: true });
        const middleware = createBRC107Middleware({
          wallet: mockWallet,
          requiredCertificateTypes: ["identity.master"],
          trustedCertifiers: ["02" + "b".repeat(64)],
          identityCore: { verifySignature },
        });

        const timestamp = Date.parse("2026-04-25T11:59:55.000Z");
        const nonce = "fedcba0987654321fedcba0987654321";
        const signature = "3045022100" + "ab".repeat(32) + "022100" + "cd".repeat(32);
        const identityKey = "02" + "a".repeat(64);
        const certifier = "02" + "b".repeat(64);
        const certificate: VerifiableCertificate = {
          certificate: {
            type: "identity.master",
            serialNumber: "cert-123",
            certifier,
            subject: identityKey,
            fields: { name: "Test User" },
            issuedAt: 1714046000000,
            expiresAt: 1777118400000,
            signature: "certificate-signature",
          },
          revealedFields: ["name"],
          keyLinkageProof: {
            proofType: "DLEQ",
            proof: "proof",
            protocolID: [2, "auth"],
            keyID: "request",
            counterparty: "anyone",
            derivedPublicKey: identityKey,
          },
        };

        const req = createMockRequest({
          [BRC107_HEADERS.IDENTITY_KEY]: identityKey,
          [BRC107_HEADERS.SIGNATURE]: signature,
          [BRC107_HEADERS.TIMESTAMP]: timestamp.toString(),
          [BRC107_HEADERS.NONCE]: nonce,
          [BRC107_HEADERS.PROTOCOL_ID]: "2:auth",
          [BRC107_HEADERS.KEY_ID]: "request",
          [BRC107_HEADERS.CERTIFICATES]: Buffer.from(JSON.stringify([certificate])).toString(
            "base64",
          ),
        });
        const res = createMockResponse();
        const next = vi.fn();

        await middleware(req, res, next);

        expect(verifySignature).toHaveBeenCalledTimes(2);
        expect(verifySignature).toHaveBeenNthCalledWith(1, {
          data: ["GET", "/api/test", timestamp.toString(), nonce, "2:auth", "request", ""].join(
            "\n",
          ),
          signature,
          publicKey: identityKey,
        });
        expect(verifySignature).toHaveBeenNthCalledWith(2, {
          data: JSON.stringify({
            type: "identity.master",
            serialNumber: "cert-123",
            subject: identityKey,
            fields: { name: "Test User" },
            issuedAt: 1714046000000,
            expiresAt: 1777118400000,
          }),
          signature: "certificate-signature",
          publicKey: certifier,
        });
        expect(next).toHaveBeenCalledOnce();
        expect(res.statusCode).toBe(200);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("callbacks", () => {
    it("calls onError callback on failure", async () => {
      const onError = vi.fn();

      const middleware = createBRC107Middleware({
        wallet: mockWallet,
        onError,
      });

      const req = createMockRequest({});
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(onError).toHaveBeenCalled();
      expect(onError.mock.calls[0][0]).toMatchObject({
        code: "MISSING_HEADER",
      });
    });
  });
});

// =============================================================================
// createBRC107Headers Tests
// =============================================================================

describe("createBRC107Headers", () => {
  it("creates correct header object", () => {
    const identityKey = "02" + "a".repeat(64);
    const signature = "3045022100test";
    const timestamp = 1234567890;
    const nonce = "test-nonce-12345678";
    const protocolID: ProtocolID = [2, "auth"];
    const keyID = "request";

    const headers = createBRC107Headers(
      identityKey,
      signature,
      timestamp,
      nonce,
      protocolID,
      keyID,
    );

    expect(headers[BRC107_HEADERS.IDENTITY_KEY]).toBe(identityKey);
    expect(headers[BRC107_HEADERS.SIGNATURE]).toBe(signature);
    expect(headers[BRC107_HEADERS.TIMESTAMP]).toBe("1234567890");
    expect(headers[BRC107_HEADERS.NONCE]).toBe(nonce);
    expect(headers[BRC107_HEADERS.PROTOCOL_ID]).toBe("2:auth");
    expect(headers[BRC107_HEADERS.KEY_ID]).toBe(keyID);
  });

  it("includes certificates when provided", () => {
    const identityKey = "02" + "a".repeat(64);
    const certificates: VerifiableCertificate[] = [
      {
        certificate: {
          type: "test",
          serialNumber: "123",
          certifier: "02" + "b".repeat(64),
          subject: identityKey,
          fields: {},
          signature: "sig",
        },
        revealedFields: ["name"],
        keyLinkageProof: {
          proofType: "DLEQ",
          proof: "proof",
          protocolID: [2, "auth"],
          keyID: "test",
          counterparty: "anyone",
          derivedPublicKey: identityKey,
        },
      },
    ];

    const headers = createBRC107Headers(
      identityKey,
      "3045022100test",
      Date.now(),
      "nonce12345678901234",
      [2, "auth"],
      "request",
      certificates,
    );

    expect(headers[BRC107_HEADERS.CERTIFICATES]).toBeDefined();
    const decoded = JSON.parse(
      Buffer.from(headers[BRC107_HEADERS.CERTIFICATES], "base64").toString(),
    );
    expect(decoded).toHaveLength(1);
    expect(decoded[0].certificate.type).toBe("test");
  });
});

// =============================================================================
// requireBRC107Certificates Tests
// =============================================================================

describe("requireBRC107Certificates", () => {
  it("rejects unauthenticated requests", () => {
    const middleware = requireBRC107Certificates("identity.master");

    const req = createMockRequest({});
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects requests without required certificate type", () => {
    const middleware = requireBRC107Certificates("identity.master");

    const req = createMockRequest({});
    req.brc107Identity = {
      identityKey: "02" + "a".repeat(64),
      lastSeen: Date.now(),
    };
    req.brc107Certificates = [
      {
        certificate: {
          type: "other.type",
          serialNumber: "123",
          certifier: "02" + "b".repeat(64),
          subject: "02" + "a".repeat(64),
          fields: {},
          signature: "sig",
        },
        revealedFields: [],
        keyLinkageProof: {
          proofType: "DLEQ",
          proof: "proof",
          protocolID: [2, "auth"],
          keyID: "test",
          counterparty: "anyone",
          derivedPublicKey: "02" + "a".repeat(64),
        },
      },
    ];

    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body.message).toContain("identity.master");
  });

  it("allows requests with required certificate type", () => {
    const middleware = requireBRC107Certificates("identity.master");

    const req = createMockRequest({});
    req.brc107Identity = {
      identityKey: "02" + "a".repeat(64),
      lastSeen: Date.now(),
    };
    req.brc107Certificates = [
      {
        certificate: {
          type: "identity.master",
          serialNumber: "123",
          certifier: "02" + "b".repeat(64),
          subject: "02" + "a".repeat(64),
          fields: { name: "Test User" },
          signature: "sig",
        },
        revealedFields: ["name"],
        keyLinkageProof: {
          proofType: "DLEQ",
          proof: "proof",
          protocolID: [2, "auth"],
          keyID: "test",
          counterparty: "anyone",
          derivedPublicKey: "02" + "a".repeat(64),
        },
      },
    ];

    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

// =============================================================================
// allowBRC107Identities Tests
// =============================================================================

describe("allowBRC107Identities", () => {
  const allowedKey = "02" + "a".repeat(64);
  const forbiddenKey = "02" + "b".repeat(64);

  it("rejects unauthenticated requests", () => {
    const middleware = allowBRC107Identities(allowedKey);

    const req = createMockRequest({});
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects unauthorized identities", () => {
    const middleware = allowBRC107Identities(allowedKey);

    const req = createMockRequest({});
    req.brc107Identity = {
      identityKey: forbiddenKey,
      lastSeen: Date.now(),
    };

    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows authorized identities", () => {
    const middleware = allowBRC107Identities(allowedKey);

    const req = createMockRequest({});
    req.brc107Identity = {
      identityKey: allowedKey,
      lastSeen: Date.now(),
    };

    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
