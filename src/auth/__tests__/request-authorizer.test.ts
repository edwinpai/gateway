/**
 * RequestAuthorizer Tests
 *
 * Tests for BRC-103 request authorization:
 * - Signature verification
 * - Replay protection
 * - Timing constraints
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BSVCrypto } from "../../crypto/bsv-sdk-wrapper.js";
import { canonicalizeSignedPrompt } from "../../types/bsv-auth.js";
import { RequestAuthorizer, createSignedRequest } from "../request-authorizer.js";
import { TimingMonitor } from "../timing-monitor.js";
import { sha256 } from "../verification.js";

describe("RequestAuthorizer", () => {
  let authorizer: RequestAuthorizer;

  beforeEach(() => {
    authorizer = new RequestAuthorizer({
      maxTimestampAgeMs: 30000,
      nonceTtlMs: 60000,
      enableTimingMonitor: false, // Disable for basic tests
    });
  });

  afterEach(() => {
    authorizer.stop();
  });

  describe("authorize()", () => {
    it("should reject requests with missing auth headers", async () => {
      const result = await authorizer.authorize({
        method: "POST",
        path: "/api/test",
        headers: {} as unknown as Record<string, string>,
      });

      expect(result.authorized).toBe(false);
      expect(result.reason).toContain("Missing required auth headers");
    });

    it("should reject requests with invalid identity key format", async () => {
      const result = await authorizer.authorize({
        method: "POST",
        path: "/api/test",
        headers: {
          "x-bsv-identity-key": "invalid-key",
          "x-bsv-signature": "304" + "a".repeat(140),
          "x-bsv-timestamp": Date.now().toString(),
          "x-bsv-nonce": crypto.randomUUID(),
        },
      });

      expect(result.authorized).toBe(false);
      expect(result.reason).toContain("Invalid identity key format");
    });

    it("should reject requests with invalid timestamp format", async () => {
      const key = BSVCrypto.privateKeyFromRandom();
      const pubKey = key.toPublicKey().toHex();

      const result = await authorizer.authorize({
        method: "POST",
        path: "/api/test",
        headers: {
          "x-bsv-identity-key": pubKey,
          "x-bsv-signature": "304" + "a".repeat(140),
          "x-bsv-timestamp": "not-a-number",
          "x-bsv-nonce": crypto.randomUUID(),
        },
      });

      expect(result.authorized).toBe(false);
      expect(result.reason).toContain("Invalid timestamp format");
    });

    it("should reject expired requests", async () => {
      const key = BSVCrypto.privateKeyFromRandom();
      const pubKey = key.toPublicKey().toHex();
      const oldTimestamp = Date.now() - 60000; // 1 minute ago

      const result = await authorizer.authorize({
        method: "POST",
        path: "/api/test",
        headers: {
          "x-bsv-identity-key": pubKey,
          "x-bsv-signature": "304" + "a".repeat(140),
          "x-bsv-timestamp": oldTimestamp.toString(),
          "x-bsv-nonce": crypto.randomUUID(),
        },
      });

      expect(result.authorized).toBe(false);
      expect(result.reason).toContain("expired");
    });

    it("should authorize valid signed requests", async () => {
      const key = BSVCrypto.privateKeyFromRandom();
      const pubKey = key.toPublicKey().toHex();

      const request = await createSignedRequest(
        "POST",
        "/api/agent/run",
        { prompt: "hello" },
        pubKey,
        async (messageHash) => {
          const signature = BSVCrypto.sign(key, messageHash);
          return signature.toString("hex");
        },
      );

      const result = await authorizer.authorize(request);

      expect(result.authorized).toBe(true);
      expect(result.identity).toBe(pubKey);
    });

    it("should route request signature verification through identity-core", async () => {
      const verifySignature = vi.fn(async () => ({ valid: true }));
      const authorizerWithCore = new RequestAuthorizer({
        identityCore: { verifySignature },
      });

      const result = await authorizerWithCore.authorize({
        method: "POST",
        path: "/api/test",
        body: { ok: true },
        headers: {
          "x-bsv-identity-key": "02" + "a".repeat(64),
          "x-bsv-signature": "deadbeef",
          "x-bsv-timestamp": Date.now().toString(),
          "x-bsv-nonce": crypto.randomUUID(),
        },
      });

      expect(result.authorized).toBe(true);
      expect(verifySignature).toHaveBeenCalledTimes(1);
      expect(verifySignature).toHaveBeenCalledWith({
        data: expect.any(String),
        signature: "deadbeef",
        publicKey: "02" + "a".repeat(64),
      });

      authorizerWithCore.stop();
    });

    it("should reject requests with invalid signature", async () => {
      const key = BSVCrypto.privateKeyFromRandom();
      const pubKey = key.toPublicKey().toHex();

      const request = await createSignedRequest(
        "POST",
        "/api/test",
        undefined,
        pubKey,
        async () => "3044" + "a".repeat(138), // Fake signature
      );

      const result = await authorizer.authorize(request);

      expect(result.authorized).toBe(false);
      expect(result.reason).toContain("Invalid signature");
    });
  });

  describe("Replay Protection", () => {
    it("should reject replayed requests (same nonce)", async () => {
      const key = BSVCrypto.privateKeyFromRandom();
      const pubKey = key.toPublicKey().toHex();

      const request = await createSignedRequest(
        "POST",
        "/api/test",
        undefined,
        pubKey,
        async (messageHash) => BSVCrypto.sign(key, messageHash).toString("hex"),
      );

      // First request should succeed
      const result1 = await authorizer.authorize(request);
      expect(result1.authorized).toBe(true);

      // Update timestamp but keep same nonce
      request.headers["x-bsv-timestamp"] = Date.now().toString();

      // Second request with same nonce should fail
      const result2 = await authorizer.authorize(request);
      expect(result2.authorized).toBe(false);
      expect(result2.reason).toContain("Replay detected");
    });

    it("should accept requests with different nonces", async () => {
      const key = BSVCrypto.privateKeyFromRandom();
      const pubKey = key.toPublicKey().toHex();

      const request1 = await createSignedRequest(
        "POST",
        "/api/test",
        undefined,
        pubKey,
        async (messageHash) => BSVCrypto.sign(key, messageHash).toString("hex"),
      );

      const request2 = await createSignedRequest(
        "POST",
        "/api/test",
        undefined,
        pubKey,
        async (messageHash) => BSVCrypto.sign(key, messageHash).toString("hex"),
      );

      const result1 = await authorizer.authorize(request1);
      const result2 = await authorizer.authorize(request2);

      expect(result1.authorized).toBe(true);
      expect(result2.authorized).toBe(true);
    });

    it("should cleanup expired nonces", async () => {
      const shortTtlAuthorizer = new RequestAuthorizer({
        nonceTtlMs: 100, // 100ms
        nonceCleanupIntervalMs: 10000, // Long interval (we'll call cleanup manually)
      });

      const key = BSVCrypto.privateKeyFromRandom();
      const pubKey = key.toPublicKey().toHex();

      const request = await createSignedRequest(
        "POST",
        "/api/test",
        undefined,
        pubKey,
        async (messageHash) => BSVCrypto.sign(key, messageHash).toString("hex"),
      );

      await shortTtlAuthorizer.authorize(request);
      expect(shortTtlAuthorizer.getNonceCount()).toBeGreaterThan(0);

      // Wait for nonce to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      const cleaned = shortTtlAuthorizer.cleanupExpiredNonces();
      expect(cleaned).toBeGreaterThan(0);

      shortTtlAuthorizer.stop();
    });
  });

  describe("Identity Management", () => {
    it("should register known identities", () => {
      const key = BSVCrypto.privateKeyFromRandom();
      const pubKey = key.toPublicKey().toHex();

      authorizer.registerIdentity(pubKey, { name: "Alice", trustLevel: 80 });

      expect(authorizer.isKnownIdentity(pubKey)).toBe(true);

      const metadata = authorizer.getIdentityMetadata(pubKey);
      expect(metadata?.name).toBe("Alice");
      expect(metadata?.trustLevel).toBe(80);
    });

    it("should update identity stats on authorization", async () => {
      const key = BSVCrypto.privateKeyFromRandom();
      const pubKey = key.toPublicKey().toHex();

      authorizer.registerIdentity(pubKey);

      const request = await createSignedRequest(
        "POST",
        "/api/test",
        undefined,
        pubKey,
        async (messageHash) => BSVCrypto.sign(key, messageHash).toString("hex"),
      );

      await authorizer.authorize(request);

      const metadata = authorizer.getIdentityMetadata(pubKey);
      expect(metadata?.authCount).toBe(1);
      expect(metadata?.lastSeenAt).toBeDefined();
    });

    it("should reject invalid public key format when registering", () => {
      expect(() => authorizer.registerIdentity("invalid")).toThrow();
    });
  });

  describe("Timing Integration", () => {
    it("should integrate with TimingMonitor", async () => {
      const timingMonitor = new TimingMonitor();
      const authorizerWithTiming = new RequestAuthorizer({
        enableTimingMonitor: true,
        timingMonitor,
      });

      const key = BSVCrypto.privateKeyFromRandom();
      const pubKey = key.toPublicKey().toHex();

      const request = await createSignedRequest(
        "POST",
        "/api/test",
        undefined,
        pubKey,
        async (messageHash) => BSVCrypto.sign(key, messageHash).toString("hex"),
      );

      const result = await authorizerWithTiming.authorize(request);

      // Debug: If not authorized, check the reason
      if (!result.authorized) {
        console.log("Authorization failed:", result.reason);
      }

      expect(result.authorized).toBe(true);
      // Note: timingVerdict is only set when timing monitor is active AND identity is processed
      // For first request from a new identity, the verdict may be simple

      authorizerWithTiming.stop();
    });
  });

  describe("authorizeSignedPrompt()", () => {
    it("should authorize a valid signed prompt", async () => {
      const key = BSVCrypto.privateKeyFromRandom();
      const pubKey = key.toPublicKey().toHex();
      const envelope = {
        version: "edwinpai/1",
        issuedAt: Date.now(),
        nonce: crypto.randomUUID(),
        promptHash: "hash",
        scopeClaims: ["operator.read"],
        cert: {
          type: "test",
          serialNumber: "1",
          certifier: pubKey,
          subject: pubKey,
          fields: {},
          signature: "deadbeef",
        },
      };

      const canonical = canonicalizeSignedPrompt(envelope);
      const messageHash = sha256(canonical).toString("hex");
      const signature = BSVCrypto.sign(key, messageHash).toString("hex");

      const result = await authorizer.authorizeSignedPrompt({
        envelope,
        signature,
      });

      expect(result.authorized).toBe(true);
    });

    it("should reject expired signed prompt", async () => {
      const key = BSVCrypto.privateKeyFromRandom();
      const pubKey = key.toPublicKey().toHex();
      const envelope = {
        version: "edwinpai/1",
        issuedAt: Date.now() - 60000,
        nonce: crypto.randomUUID(),
        promptHash: "hash",
        cert: {
          type: "test",
          serialNumber: "1",
          certifier: pubKey,
          subject: pubKey,
          fields: {},
          signature: "deadbeef",
        },
      };

      const canonical = canonicalizeSignedPrompt(envelope);
      const messageHash = sha256(canonical).toString("hex");
      const signature = BSVCrypto.sign(key, messageHash).toString("hex");

      const result = await authorizer.authorizeSignedPrompt({
        envelope,
        signature,
      });

      expect(result.authorized).toBe(false);
      expect(result.reason).toContain("Signed prompt expired");
    });
  });
});

describe("createSignedRequest", () => {
  it("should create a properly formatted authenticated request", async () => {
    const key = BSVCrypto.privateKeyFromRandom();
    const pubKey = key.toPublicKey().toHex();

    const request = await createSignedRequest(
      "POST",
      "/api/agent/run",
      { prompt: "test" },
      pubKey,
      async (messageHash) => BSVCrypto.sign(key, messageHash).toString("hex"),
    );

    expect(request.method).toBe("POST");
    expect(request.path).toBe("/api/agent/run");
    expect(request.body).toEqual({ prompt: "test" });
    expect(request.headers["x-bsv-identity-key"]).toBe(pubKey);
    expect(request.headers["x-bsv-signature"]).toMatch(/^[0-9a-fA-F]+$/);
    expect(request.headers["x-bsv-timestamp"]).toMatch(/^\d+$/);
    expect(request.headers["x-bsv-nonce"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
