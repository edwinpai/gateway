/**
 * BRC-103 End-to-End Authentication Tests
 *
 * Tests the full authentication pipeline from request signing through
 * identity verification, including:
 * - Request signing with RequestSigner
 * - Identity extraction from headers
 * - Signature verification with BSV SDK
 * - Owner verification
 * - Replay protection
 * - Key derivation integration
 * - ECIES encryption
 *
 * @see https://github.com/bitcoin-sv/BRCs/blob/master/peer-to-peer/0103.md
 */

import { IncomingMessage } from "node:http";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BSVCrypto } from "../../crypto/bsv-sdk-wrapper.js";
import { ECIES } from "../../crypto/ecies.js";
import { processBsvAuth, resolveBsvAuth } from "../../gateway/bsv-auth.js";
import { canonicalizeRequest } from "../../types/bsv-auth.js";
import { extractIdentityFromHeaders, verifyIdentity } from "../identity.js";
import { KeyDerivationService } from "../key-derivation.js";
import { InMemoryNonceStore } from "../middleware.js";
import { publicKeysEqual } from "../owner.js";
import { RequestSigner } from "../request-signer.js";
import { sha256 } from "../verification.js";

/**
 * Create a mock IncomingMessage from headers
 */
function createMockRequest(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: object,
): IncomingMessage & { body?: object } {
  const req = {
    method,
    url: path,
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    body,
  } as unknown as IncomingMessage & { body?: object };
  return req;
}

describe("BRC-103 End-to-End Authentication", () => {
  describe("RequestSigner", () => {
    it("should create signer from random key", () => {
      const signer = RequestSigner.fromRandom();
      expect(signer.getIdentityKey()).toMatch(/^0[23][0-9a-f]{64}$/);
    });

    it("should create signer from hex key", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const expectedPubKey = privateKey.toPublicKey().toHex();

      const signer = new RequestSigner(privateKey);
      expect(signer.getIdentityKey()).toBe(expectedPubKey);
    });

    it("should sign a request and produce valid headers", () => {
      const signer = RequestSigner.fromRandom();
      const headers = signer.signRequest({
        method: "POST",
        path: "/api/agent/run",
        body: { prompt: "hello" },
      });

      expect(headers["x-bsv-identity-key"]).toBe(signer.getIdentityKey());
      expect(headers["x-bsv-signature"]).toMatch(/^[0-9a-f]+$/);
      expect(headers["x-bsv-timestamp"]).toMatch(/^\d+$/);
      expect(headers["x-bsv-nonce"]).toBeDefined();
    });

    it("should use custom timestamp and nonce when provided", () => {
      const signer = RequestSigner.fromRandom();
      const customTimestamp = 1609459200000;
      const customNonce = "custom-nonce-123";

      const headers = signer.signRequest({
        method: "GET",
        path: "/api/status",
        timestamp: customTimestamp,
        nonce: customNonce,
      });

      expect(headers["x-bsv-timestamp"]).toBe(customTimestamp.toString());
      expect(headers["x-bsv-nonce"]).toBe(customNonce);
    });
  });

  describe("Full Pipeline: Sign → Extract → Verify", () => {
    it("should sign a request and verify it through the full pipeline", async () => {
      // 1. Create a keypair and signer
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const signer = new RequestSigner(privateKey);

      // 2. Sign a request
      const method = "POST";
      const path = "/api/agent/run";
      const body = { prompt: "hello" };
      const headers = signer.signRequest({ method, path, body });

      // 3. Create a mock HTTP request with those headers
      const req = createMockRequest(method, path, headers, body);

      // 4. Extract identity from headers
      const extraction = extractIdentityFromHeaders(req, body);
      expect(extraction.success).toBe(true);
      expect(extraction.signedRequest).toBeDefined();
      expect(extraction.signedRequest!.identityKey).toBe(signer.getIdentityKey());

      // 5. Verify identity
      const identityContext = await verifyIdentity(extraction.signedRequest!);

      // 6. Verify the identity context matches the signer's public key
      expect(identityContext.identityKey).toBe(signer.getIdentityKey());
      expect(identityContext.identity.identityKey).toBe(signer.getIdentityKey());
      expect(identityContext.verifiedAt).toBeLessThanOrEqual(Date.now());
    });

    it("should reject tampered requests (modified body)", async () => {
      const signer = RequestSigner.fromRandom();
      const headers = signer.signRequest({
        method: "POST",
        path: "/api/agent/run",
        body: { prompt: "hello" },
      });

      // Tamper with the body
      const tamperedBody = { prompt: "goodbye" };
      const req = createMockRequest("POST", "/api/agent/run", headers, tamperedBody);

      const extraction = extractIdentityFromHeaders(req, tamperedBody);
      expect(extraction.success).toBe(true);

      // Verification should fail due to signature mismatch
      await expect(verifyIdentity(extraction.signedRequest!)).rejects.toThrow("Invalid signature");
    });

    it("should reject tampered requests (modified path)", async () => {
      const signer = RequestSigner.fromRandom();
      const body = { prompt: "hello" };
      const headers = signer.signRequest({
        method: "POST",
        path: "/api/agent/run",
        body,
      });

      // Tamper with the path
      const req = createMockRequest("POST", "/api/agent/delete", headers, body);

      const extraction = extractIdentityFromHeaders(req, body);
      expect(extraction.success).toBe(true);

      // Verification should fail
      await expect(verifyIdentity(extraction.signedRequest!)).rejects.toThrow("Invalid signature");
    });

    it("should reject expired timestamps", async () => {
      const signer = RequestSigner.fromRandom();
      const body = { data: "test" };

      // Use a very old timestamp
      const oldTimestamp = Date.now() - 60000; // 1 minute ago
      const headers = signer.signRequest({
        method: "POST",
        path: "/api/test",
        body,
        timestamp: oldTimestamp,
      });

      const req = createMockRequest("POST", "/api/test", headers, body);
      const extraction = extractIdentityFromHeaders(req, body);
      expect(extraction.success).toBe(true);

      // Verification should fail due to expired timestamp
      await expect(
        verifyIdentity(extraction.signedRequest!, { maxTimestampAge: 30000 }),
      ).rejects.toThrow(/expired|timestamp/i);
    });

    it("should reject missing headers", () => {
      const req = createMockRequest("GET", "/api/test", {});
      const extraction = extractIdentityFromHeaders(req);

      expect(extraction.success).toBe(false);
      expect(extraction.error).toBeDefined();
      expect(extraction.missingHeaders).toContain("x-bsv-identity-key");
    });
  });

  describe("Replay Protection", () => {
    let nonceStore: InMemoryNonceStore;

    beforeEach(() => {
      nonceStore = new InMemoryNonceStore();
    });

    afterEach(() => {
      nonceStore.destroy();
    });

    it("should detect replayed nonces", async () => {
      const nonce = "unique-nonce-12345";

      // First use - should not exist
      expect(await nonceStore.has(nonce)).toBe(false);

      // Add nonce
      await nonceStore.add(nonce, Date.now() + 60000);

      // Second use - should exist
      expect(await nonceStore.has(nonce)).toBe(true);
    });

    it("should cleanup expired nonces", async () => {
      const nonce = "expired-nonce";

      // Add with past expiry
      await nonceStore.add(nonce, Date.now() - 1000);

      // Cleanup
      await nonceStore.cleanup();

      // Should be gone
      expect(await nonceStore.has(nonce)).toBe(false);
    });
  });

  describe("Gateway Integration: processBsvAuth()", () => {
    it("should process valid authenticated requests", async () => {
      const signer = RequestSigner.fromRandom();
      const body = { prompt: "hello" };
      const headers = signer.signRequest({
        method: "POST",
        path: "/api/agent/run",
        body,
      });

      const req = createMockRequest("POST", "/api/agent/run", headers, body);
      const bsvAuth = resolveBsvAuth({
        bsvAuthConfig: {
          enabled: true,
          allowUnauthenticated: false,
        },
      });

      const result = await processBsvAuth(req, bsvAuth, body);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.identity).toBeDefined();
        expect(result.identity!.identityKey).toBe(signer.getIdentityKey());
      }
    });

    it("should skip authentication for configured paths", async () => {
      const req = createMockRequest("GET", "/health", {});
      const bsvAuth = resolveBsvAuth({
        bsvAuthConfig: {
          enabled: true,
          allowUnauthenticated: false,
          skipPaths: ["/health", "/ready"],
        },
      });

      const result = await processBsvAuth(req, bsvAuth);

      expect(result.ok).toBe(true);
    });

    it("should allow unauthenticated requests when configured", async () => {
      const req = createMockRequest("GET", "/api/public", {});
      const bsvAuth = resolveBsvAuth({
        bsvAuthConfig: {
          enabled: true,
          allowUnauthenticated: true,
        },
      });

      const result = await processBsvAuth(req, bsvAuth);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.identity).toBeUndefined();
      }
    });

    it("should reject unauthenticated requests when required", async () => {
      const req = createMockRequest("GET", "/api/private", {});
      const bsvAuth = resolveBsvAuth({
        bsvAuthConfig: {
          enabled: true,
          allowUnauthenticated: false,
        },
      });

      const result = await processBsvAuth(req, bsvAuth);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("UNAUTHENTICATED");
      }
    });
  });

  describe("Owner Verification", () => {
    it("should identify the owner correctly", async () => {
      const ownerPrivateKey = BSVCrypto.privateKeyFromRandom();
      const ownerPublicKey = ownerPrivateKey.toPublicKey().toHex();
      const signer = new RequestSigner(ownerPrivateKey);

      const body = { data: "owner request" };
      const headers = signer.signRequest({
        method: "POST",
        path: "/admin/action",
        body,
      });

      const req = createMockRequest("POST", "/admin/action", headers, body);
      const bsvAuth = resolveBsvAuth({
        bsvAuthConfig: {
          enabled: true,
          ownerPublicKey,
          ownerOnly: false,
        },
      });

      const result = await processBsvAuth(req, bsvAuth, body);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.isOwner).toBe(true);
      }
    });

    it("should reject non-owner when ownerOnly=true", async () => {
      const ownerPrivateKey = BSVCrypto.privateKeyFromRandom();
      const ownerPublicKey = ownerPrivateKey.toPublicKey().toHex();

      // Create a different (non-owner) signer
      const nonOwnerSigner = RequestSigner.fromRandom();
      const body = { data: "non-owner request" };
      const headers = nonOwnerSigner.signRequest({
        method: "POST",
        path: "/admin/action",
        body,
      });

      const req = createMockRequest("POST", "/admin/action", headers, body);
      const bsvAuth = resolveBsvAuth({
        bsvAuthConfig: {
          enabled: true,
          ownerPublicKey,
          ownerOnly: true,
        },
      });

      const result = await processBsvAuth(req, bsvAuth, body);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("NOT_OWNER");
        expect(result.status).toBe(403);
      }
    });

    it("should allow non-owner when ownerOnly=false", async () => {
      const ownerPrivateKey = BSVCrypto.privateKeyFromRandom();
      const ownerPublicKey = ownerPrivateKey.toPublicKey().toHex();

      const nonOwnerSigner = RequestSigner.fromRandom();
      const body = { data: "non-owner request" };
      const headers = nonOwnerSigner.signRequest({
        method: "POST",
        path: "/api/action",
        body,
      });

      const req = createMockRequest("POST", "/api/action", headers, body);
      const bsvAuth = resolveBsvAuth({
        bsvAuthConfig: {
          enabled: true,
          ownerPublicKey,
          ownerOnly: false,
        },
      });

      const result = await processBsvAuth(req, bsvAuth, body);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.isOwner).toBe(false);
      }
    });

    it("should use publicKeysEqual for comparison", () => {
      const key1 = "02abc123def456abc123def456abc123def456abc123def456abc123def456abc1";
      const key2 = "02ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC1";

      expect(publicKeysEqual(key1, key2)).toBe(true);
      expect(publicKeysEqual(key1, "03" + key1.slice(2))).toBe(false);
    });
  });

  describe("Key Derivation Integration", () => {
    it("should derive session keys between client and server", () => {
      // Client and server each have their own identity keys
      const clientService = KeyDerivationService.fromRandom();
      const serverService = KeyDerivationService.fromRandom();

      const sessionId = crypto.randomUUID();

      // Both derive keys for the same session
      const _clientDerivedKey = clientService.derivePrivateKey(
        serverService.getIdentityPublicKey(),
        {
          protocolID: [2, "auth"],
          keyID: sessionId,
        },
      );

      const _serverDerivedKey = serverService.derivePrivateKey(
        clientService.getIdentityPublicKey(),
        {
          protocolID: [2, "auth"],
          keyID: sessionId,
        },
      );

      // The derived keys should be different (each side has their own)
      // But they can use ECDH to derive a shared secret
      const clientSharedSecret = clientService.deriveSharedSecret(
        serverService.getIdentityPublicKey(),
      );

      const serverSharedSecret = serverService.deriveSharedSecret(
        clientService.getIdentityPublicKey(),
      );

      // Shared secrets should match (ECDH is symmetric)
      expect(clientSharedSecret.toString("hex")).toBe(serverSharedSecret.toString("hex"));
    });

    it("should produce deterministic key derivation", () => {
      const masterKey = BSVCrypto.privateKeyFromRandom();
      const counterpartyKey = BSVCrypto.privateKeyFromRandom();

      const service1 = new KeyDerivationService(masterKey);
      const service2 = new KeyDerivationService(masterKey);

      const params = {
        protocolID: [2, "test"] as [number, string],
        keyID: "deterministic-test",
      };

      const derived1 = service1.derivePrivateKey(counterpartyKey.toPublicKey(), params);
      const derived2 = service2.derivePrivateKey(counterpartyKey.toPublicKey(), params);

      expect(derived1.toHex()).toBe(derived2.toHex());
    });
  });

  describe("ECIES Encryption Integration", () => {
    it("should encrypt and decrypt messages between client and server", () => {
      const alice = ECIES.fromRandom();
      const bob = ECIES.fromRandom();

      const message = Buffer.from("Hello Bob, this is a secret message!");

      // Alice encrypts for Bob
      const encrypted = alice.encrypt(message, bob.getPublicKey());

      // Bob decrypts from Alice
      const decrypted = bob.decrypt(encrypted, alice.getPublicKey());

      expect(decrypted.toString()).toBe(message.toString());
    });

    it("should fail when wrong recipient tries to decrypt", () => {
      const alice = ECIES.fromRandom();
      const bob = ECIES.fromRandom();
      const eve = ECIES.fromRandom();

      const message = Buffer.from("Secret for Bob only");
      const encrypted = alice.encrypt(message, bob.getPublicKey());

      // Eve (wrong recipient) tries to decrypt
      expect(() => eve.decrypt(encrypted, alice.getPublicKey())).toThrow();
    });

    it("should work with string helpers", () => {
      const sender = ECIES.fromRandom();
      const receiver = ECIES.fromRandom();

      const message = "Hello, encrypted world!";
      const encryptedHex = sender.encryptString(message, receiver.getPublicKey());
      const decrypted = receiver.decryptString(encryptedHex, sender.getPublicKey());

      expect(decrypted).toBe(message);
    });

    it("should handle binary data with null bytes", () => {
      const alice = ECIES.fromRandom();
      const bob = ECIES.fromRandom();

      // Binary data with null bytes
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff, 0x00, 0xfe]);
      const encrypted = alice.encrypt(binaryData, bob.getPublicKey());
      const decrypted = bob.decrypt(encrypted, alice.getPublicKey());

      expect(decrypted).toEqual(binaryData);
    });

    it("should handle empty plaintext", () => {
      const alice = ECIES.fromRandom();
      const bob = ECIES.fromRandom();

      const empty = Buffer.from("");
      const encrypted = alice.encrypt(empty, bob.getPublicKey());
      const decrypted = bob.decrypt(encrypted, alice.getPublicKey());

      expect(decrypted.length).toBe(0);
    });
  });

  describe("Signature Verification with BSV SDK", () => {
    it("should verify signatures created by RequestSigner", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const publicKey = privateKey.toPublicKey();
      const signer = new RequestSigner(privateKey);

      const method = "POST";
      const path = "/api/test";
      const body = { test: "data" };
      const timestamp = Date.now();
      const nonce = crypto.randomUUID();

      const headers = signer.signRequest({ method, path, body, timestamp, nonce });

      // Manually verify the signature
      const canonical = canonicalizeRequest({
        method,
        path,
        body,
        timestamp,
        nonce,
        identityKey: signer.getIdentityKey(),
      });

      const messageHash = sha256(canonical).toString("hex");
      const signature = Buffer.from(headers["x-bsv-signature"], "hex");

      const isValid = BSVCrypto.verify(publicKey, messageHash, signature);
      expect(isValid).toBe(true);
    });

    it("should reject invalid signatures", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const publicKey = privateKey.toPublicKey();
      const wrongKey = BSVCrypto.privateKeyFromRandom().toPublicKey();

      // Sign with one key
      const message = "test message";
      const messageHash = sha256(message).toString("hex");
      const signature = BSVCrypto.sign(privateKey, messageHash);

      // Verify with correct key - should pass
      expect(BSVCrypto.verify(publicKey, messageHash, signature)).toBe(true);

      // Verify with wrong key - should fail
      expect(BSVCrypto.verify(wrongKey, messageHash, signature)).toBe(false);
    });
  });

  describe("Cross-Component Integration", () => {
    it("should work through the complete auth + encryption flow", async () => {
      // Server setup
      const serverPrivateKey = BSVCrypto.privateKeyFromRandom();
      const serverPublicKey = serverPrivateKey.toPublicKey();
      const serverEcies = new ECIES(serverPrivateKey);

      // Client setup
      const clientPrivateKey = BSVCrypto.privateKeyFromRandom();
      const clientSigner = new RequestSigner(clientPrivateKey);
      const clientEcies = new ECIES(clientPrivateKey);

      // Step 1: Client authenticates with server
      const authHeaders = clientSigner.signRequest({
        method: "POST",
        path: "/api/init-session",
        body: { serverPublicKey: serverPublicKey.toHex() },
      });

      const authReq = createMockRequest("POST", "/api/init-session", authHeaders, {
        serverPublicKey: serverPublicKey.toHex(),
      });

      const extraction = extractIdentityFromHeaders(authReq, {
        serverPublicKey: serverPublicKey.toHex(),
      });
      expect(extraction.success).toBe(true);

      const identityContext = await verifyIdentity(extraction.signedRequest!);
      expect(identityContext.identityKey).toBe(clientSigner.getIdentityKey());

      // Step 2: Server sends encrypted response
      const sessionSecret = Buffer.from("session-secret-12345");
      const encryptedSession = serverEcies.encrypt(sessionSecret, clientSigner.getIdentityKey());

      // Step 3: Client decrypts the session
      const decryptedSession = clientEcies.decrypt(encryptedSession, serverPublicKey);
      expect(decryptedSession).toEqual(sessionSecret);

      // Step 4: Client makes authenticated request with session
      const requestBody = { action: "perform-task", session: decryptedSession.toString() };
      const taskHeaders = clientSigner.signRequest({
        method: "POST",
        path: "/api/task",
        body: requestBody,
      });

      const taskReq = createMockRequest("POST", "/api/task", taskHeaders, requestBody);
      const taskExtraction = extractIdentityFromHeaders(taskReq, requestBody);
      const taskIdentity = await verifyIdentity(taskExtraction.signedRequest!);

      expect(taskIdentity.identityKey).toBe(clientSigner.getIdentityKey());
    });

    it("should maintain identity consistency across multiple requests", async () => {
      const signer = RequestSigner.fromRandom();
      const identityKey = signer.getIdentityKey();

      // Multiple different requests
      const requests = [
        { method: "GET", path: "/api/status" },
        { method: "POST", path: "/api/action", body: { data: 1 } },
        { method: "PUT", path: "/api/resource/123", body: { update: true } },
        { method: "DELETE", path: "/api/resource/456" },
      ];

      for (const { method, path, body } of requests) {
        const headers = signer.signRequest({ method, path, body });
        const req = createMockRequest(method, path, headers, body);
        const extraction = extractIdentityFromHeaders(req, body);

        expect(extraction.success).toBe(true);
        expect(extraction.signedRequest!.identityKey).toBe(identityKey);

        const identity = await verifyIdentity(extraction.signedRequest!);
        expect(identity.identityKey).toBe(identityKey);
      }
    });
  });

  describe("Edge Cases", () => {
    it("should handle requests with query parameters", async () => {
      const signer = RequestSigner.fromRandom();
      const headers = signer.signRequest({
        method: "GET",
        path: "/api/search?q=test&page=1",
      });

      const req = createMockRequest("GET", "/api/search?q=test&page=1", headers);
      const extraction = extractIdentityFromHeaders(req);
      expect(extraction.success).toBe(true);

      const identity = await verifyIdentity(extraction.signedRequest!);
      expect(identity.identityKey).toBe(signer.getIdentityKey());
    });

    it("should handle empty body", async () => {
      const signer = RequestSigner.fromRandom();
      const headers = signer.signRequest({
        method: "GET",
        path: "/api/empty",
      });

      const req = createMockRequest("GET", "/api/empty", headers);
      const extraction = extractIdentityFromHeaders(req);
      expect(extraction.success).toBe(true);

      const identity = await verifyIdentity(extraction.signedRequest!);
      expect(identity.identityKey).toBe(signer.getIdentityKey());
    });

    it("should handle large bodies", async () => {
      const signer = RequestSigner.fromRandom();
      const largeBody = {
        data: "x".repeat(100000), // 100KB of data
        nested: {
          array: Array(1000).fill({ key: "value" }),
        },
      };

      const headers = signer.signRequest({
        method: "POST",
        path: "/api/large",
        body: largeBody,
      });

      const req = createMockRequest("POST", "/api/large", headers, largeBody);
      const extraction = extractIdentityFromHeaders(req, largeBody);
      expect(extraction.success).toBe(true);

      const identity = await verifyIdentity(extraction.signedRequest!);
      expect(identity.identityKey).toBe(signer.getIdentityKey());
    });

    it("should handle string body", async () => {
      const signer = RequestSigner.fromRandom();
      const stringBody = "plain text body content";

      const headers = signer.signRequest({
        method: "POST",
        path: "/api/text",
        body: stringBody,
      });

      // For the mock request, we pass the string as-is
      const req = createMockRequest("POST", "/api/text", headers);
      const extraction = extractIdentityFromHeaders(req, stringBody);
      expect(extraction.success).toBe(true);

      const identity = await verifyIdentity(extraction.signedRequest!);
      expect(identity.identityKey).toBe(signer.getIdentityKey());
    });

    it("should reject future timestamps (clock skew)", async () => {
      const signer = RequestSigner.fromRandom();
      const body = { data: "test" };

      // Use a future timestamp
      const futureTimestamp = Date.now() + 60000; // 1 minute in the future
      const headers = signer.signRequest({
        method: "POST",
        path: "/api/test",
        body,
        timestamp: futureTimestamp,
      });

      const req = createMockRequest("POST", "/api/test", headers, body);
      const extraction = extractIdentityFromHeaders(req, body);
      expect(extraction.success).toBe(true);

      // With default maxTimestampAge of 30000ms, future timestamps beyond that should fail
      await expect(
        verifyIdentity(extraction.signedRequest!, { maxTimestampAge: 30000 }),
      ).rejects.toThrow(/expired|timestamp/i);
    });
  });
});
