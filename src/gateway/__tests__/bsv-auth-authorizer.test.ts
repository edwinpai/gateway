/**
 * BSV Auth with RequestAuthorizer Integration Tests
 */

import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RequestSigner } from "../../auth/request-signer.js";
import { BSVCrypto } from "../../crypto/bsv-sdk-wrapper.js";
import {
  processBsvAuth,
  applyBsvAuth,
  resolveBsvAuth,
  getRequestAuthorizer,
  resetRequestAuthorizer,
  type BsvAuthenticatedRequest,
  type ResolvedBsvAuth,
} from "../bsv-auth.js";

/**
 * Create a mock IncomingMessage for testing
 */
function createMockRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
): BsvAuthenticatedRequest {
  const socket = new Socket();
  const req = new IncomingMessage(socket) as BsvAuthenticatedRequest;
  req.method = method;
  req.url = url;
  req.headers = {};

  // Headers should be lowercase
  for (const [key, value] of Object.entries(headers)) {
    req.headers[key.toLowerCase()] = value;
  }

  return req;
}

describe("processBsvAuth with RequestAuthorizer", () => {
  let signer: RequestSigner;
  let bsvAuth: ResolvedBsvAuth;

  beforeEach(() => {
    // Reset the shared authorizer between tests
    resetRequestAuthorizer();

    // Create a test signer
    signer = RequestSigner.fromRandom();

    // Default BSV auth config
    bsvAuth = resolveBsvAuth({
      bsvAuthConfig: {
        enabled: true,
        allowUnauthenticated: false,
        enableReplayProtection: true,
        maxTimestampAge: 30000,
      },
    });
  });

  afterEach(() => {
    resetRequestAuthorizer();
  });

  describe("successful authentication", () => {
    it("should authenticate valid signed request", async () => {
      const headers = signer.signRequest({
        method: "POST",
        path: "/api/test",
        body: { message: "hello" },
      });

      const req = createMockRequest("POST", "/api/test", headers);
      const result = await processBsvAuth(req, bsvAuth, { message: "hello" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.identity).toBeDefined();
        expect(result.identity?.identityKey).toBe(signer.getIdentityKey());
        expect(result.anomalyScore).toBeDefined();
        expect(result.anomalyScore).toBeGreaterThanOrEqual(0);
        expect(result.anomalyScore).toBeLessThanOrEqual(1);
      }
    });

    it("should include timing verdict in result", async () => {
      const headers = signer.signRequest({
        method: "POST",
        path: "/api/test",
      });

      const req = createMockRequest("POST", "/api/test", headers);
      const result = await processBsvAuth(req, bsvAuth);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.timingVerdict).toBeDefined();
        expect(result.timingVerdict?.allowed).toBe(true);
        expect(result.timingVerdict?.escalationLevel).toBe("normal");
      }
    });

    it("should skip auth for paths in skipPaths", async () => {
      const authWithSkip = resolveBsvAuth({
        bsvAuthConfig: {
          enabled: true,
          skipPaths: ["/health", "/ready"],
        },
      });

      const req = createMockRequest("GET", "/health", {});
      const result = await processBsvAuth(req, authWithSkip);

      expect(result.ok).toBe(true);
    });
  });

  describe("authentication failures", () => {
    it("should reject missing auth headers", async () => {
      const req = createMockRequest("POST", "/api/test", {});
      const result = await processBsvAuth(req, bsvAuth);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("UNAUTHENTICATED");
      }
    });

    it("should reject invalid signature", async () => {
      const headers = signer.signRequest({
        method: "POST",
        path: "/api/test",
      });

      // Corrupt the signature
      headers["x-bsv-signature"] = "0".repeat(headers["x-bsv-signature"].length);

      const req = createMockRequest("POST", "/api/test", headers);
      const result = await processBsvAuth(req, bsvAuth);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("INVALID_SIGNATURE");
      }
    });

    it("should reject expired timestamp", async () => {
      const headers = signer.signRequest({
        method: "POST",
        path: "/api/test",
        timestamp: Date.now() - 60000, // 1 minute ago
      });

      const req = createMockRequest("POST", "/api/test", headers);
      const result = await processBsvAuth(req, bsvAuth);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("EXPIRED");
      }
    });

    it("should reject replay attacks (same nonce)", async () => {
      const nonce = crypto.randomUUID();

      // First request should succeed
      const headers1 = signer.signRequest({
        method: "POST",
        path: "/api/test",
        nonce,
      });

      const req1 = createMockRequest("POST", "/api/test", headers1);
      const result1 = await processBsvAuth(req1, bsvAuth);
      expect(result1.ok).toBe(true);

      // Second request with same nonce should fail
      const headers2 = signer.signRequest({
        method: "POST",
        path: "/api/test",
        nonce,
      });

      const req2 = createMockRequest("POST", "/api/test", headers2);
      const result2 = await processBsvAuth(req2, bsvAuth);

      expect(result2.ok).toBe(false);
      if (!result2.ok) {
        expect(result2.code).toBe("REPLAY");
      }
    });
  });

  describe("concurrent action detection", () => {
    it("should detect concurrent actions from same identity", async () => {
      // Get authorizer and configure for stricter concurrency
      const _authorizer = getRequestAuthorizer();

      // Make a rapid sequence of requests with same timestamp
      const timestamp = Date.now();

      const headers1 = signer.signRequest({
        method: "POST",
        path: "/api/test1",
        timestamp,
      });

      const req1 = createMockRequest("POST", "/api/test1", headers1);
      const result1 = await processBsvAuth(req1, bsvAuth);
      expect(result1.ok).toBe(true);

      // Second request with timestamp within concurrency window
      const headers2 = signer.signRequest({
        method: "POST",
        path: "/api/test2",
        timestamp: timestamp + 10, // 10ms later
      });

      const req2 = createMockRequest("POST", "/api/test2", headers2);
      const result2 = await processBsvAuth(req2, bsvAuth);

      // Should be rejected due to concurrent action
      expect(result2.ok).toBe(false);
      if (!result2.ok) {
        expect(result2.code).toBe("CONCURRENT_ACTION");
        expect(result2.status).toBe(429);
      }
    });

    it("should allow sequential requests with sufficient time gap", async () => {
      const headers1 = signer.signRequest({
        method: "POST",
        path: "/api/test1",
      });

      const req1 = createMockRequest("POST", "/api/test1", headers1);
      const result1 = await processBsvAuth(req1, bsvAuth);
      expect(result1.ok).toBe(true);

      // Wait longer than concurrency window (100ms default)
      await new Promise((resolve) => setTimeout(resolve, 150));

      const headers2 = signer.signRequest({
        method: "POST",
        path: "/api/test2",
      });

      const req2 = createMockRequest("POST", "/api/test2", headers2);
      const result2 = await processBsvAuth(req2, bsvAuth);
      expect(result2.ok).toBe(true);
    });
  });

  describe("owner verification", () => {
    it("should identify owner requests", async () => {
      const ownerAuth = resolveBsvAuth({
        bsvAuthConfig: {
          enabled: true,
          ownerPublicKey: signer.getIdentityKey(),
        },
      });

      const headers = signer.signRequest({
        method: "POST",
        path: "/api/test",
      });

      const req = createMockRequest("POST", "/api/test", headers);
      const result = await processBsvAuth(req, ownerAuth);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.isOwner).toBe(true);
      }
    });

    it("should reject non-owner for owner-only endpoints", async () => {
      // Create owner auth with different owner key
      const ownerKey = BSVCrypto.privateKeyFromRandom().toPublicKey().toHex();
      const ownerAuth = resolveBsvAuth({
        bsvAuthConfig: {
          enabled: true,
          ownerPublicKey: ownerKey,
          ownerOnly: true,
        },
      });

      const headers = signer.signRequest({
        method: "POST",
        path: "/api/test",
      });

      const req = createMockRequest("POST", "/api/test", headers);
      const result = await processBsvAuth(req, ownerAuth);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("NOT_OWNER");
        expect(result.status).toBe(403);
      }
    });
  });
});

describe("applyBsvAuth with RequestAuthorizer", () => {
  let signer: RequestSigner;
  let bsvAuth: ResolvedBsvAuth;

  beforeEach(() => {
    resetRequestAuthorizer();
    signer = RequestSigner.fromRandom();
    bsvAuth = resolveBsvAuth({
      bsvAuthConfig: {
        enabled: true,
        allowUnauthenticated: false,
      },
    });
  });

  afterEach(() => {
    resetRequestAuthorizer();
  });

  it("should attach bsvAuth context to request", async () => {
    const headers = signer.signRequest({
      method: "POST",
      path: "/api/test",
    });

    const req = createMockRequest("POST", "/api/test", headers);
    const error = await applyBsvAuth(req, bsvAuth);

    expect(error).toBeUndefined();
    expect(req.bsvAuth).toBeDefined();
    expect(req.bsvAuth?.identityKey).toBe(signer.getIdentityKey());
    expect(req.bsvAuth?.anomalyScore).toBeDefined();
    expect(req.bsvAuth?.timingVerdict).toBeDefined();
  });

  it("should return error for failed auth", async () => {
    const req = createMockRequest("POST", "/api/test", {});
    const error = await applyBsvAuth(req, bsvAuth);

    expect(error).toBeDefined();
    expect(error?.code).toBe("UNAUTHENTICATED");
    expect(req.bsvAuth).toBeUndefined();
  });

  it("should skip when auth is disabled", async () => {
    const disabledAuth = resolveBsvAuth({
      bsvAuthConfig: {
        enabled: false,
      },
    });

    const req = createMockRequest("POST", "/api/test", {});
    const error = await applyBsvAuth(req, disabledAuth);

    expect(error).toBeUndefined();
  });
});

describe("getRequestAuthorizer", () => {
  afterEach(() => {
    resetRequestAuthorizer();
  });

  it("should return singleton authorizer", () => {
    const auth1 = getRequestAuthorizer();
    const auth2 = getRequestAuthorizer();
    expect(auth1).toBe(auth2);
  });

  it("should accept custom max timestamp age", () => {
    const auth = getRequestAuthorizer({ maxTimestampAgeMs: 60000 });
    expect(auth).toBeDefined();
  });
});
