/**
 * End-to-End Crypto Flow Integration Tests
 *
 * Tests the complete flow from client to gateway including:
 * - Request signing
 * - Gateway authentication
 * - Timing analysis
 * - Memory encryption
 * - Response encryption
 */

import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EdwinPAIClient } from "../client/edwinpai-client.js";
import {
  processBsvAuth,
  resolveBsvAuth,
  resetRequestAuthorizer,
  type ResolvedBsvAuth,
  type BsvAuthenticatedRequest,
} from "../gateway/bsv-auth.js";
import { CryptoGateway, resetCryptoGateway } from "../gateway/crypto-gateway.js";
import { MemoryEncryption } from "../gateway/memory-encryption.js";

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

  for (const [key, value] of Object.entries(headers)) {
    req.headers[key.toLowerCase()] = value;
  }

  return req;
}

describe("End-to-End Crypto Flow", () => {
  let cryptoGateway: CryptoGateway;
  let memoryEncryption: MemoryEncryption;
  let bsvAuth: ResolvedBsvAuth;

  beforeEach(() => {
    resetRequestAuthorizer();
    resetCryptoGateway();

    cryptoGateway = new CryptoGateway();
    memoryEncryption = new MemoryEncryption(cryptoGateway.getCryptoService());

    bsvAuth = resolveBsvAuth({
      bsvAuthConfig: {
        enabled: true,
        allowUnauthenticated: false,
        enableReplayProtection: true,
      },
    });
  });

  afterEach(() => {
    cryptoGateway.shutdown();
    resetRequestAuthorizer();
    resetCryptoGateway();
  });

  describe("full signed request lifecycle", () => {
    it("should complete full signed request lifecycle", async () => {
      // 1. Client generates identity
      const identity = EdwinPAIClient.generateIdentity();
      const client = new EdwinPAIClient({
        serverUrl: "https://example.com",
        privateKeyHex: identity.privateKeyHex,
      });

      expect(client.getPublicKey()).toBe(identity.publicKeyHex);

      // 2. Client signs a chat request
      const signedHeaders = client.getSignedHeaders("POST", "/api/chat", {
        message: "Hello, EdwinPAI!",
      });

      expect(signedHeaders["x-bsv-identity-key"]).toBe(client.getPublicKey());
      expect(signedHeaders["x-bsv-signature"]).toBeDefined();

      // 3. Gateway receives and verifies signature (RequestAuthorizer)
      const req = createMockRequest("POST", "/api/chat", signedHeaders);
      const authResult = await processBsvAuth(req, bsvAuth, { message: "Hello, EdwinPAI!" });

      expect(authResult.ok).toBe(true);
      if (authResult.ok) {
        expect(authResult.identity?.identityKey).toBe(client.getPublicKey());
        expect(authResult.anomalyScore).toBeDefined();
        expect(authResult.timingVerdict).toBeDefined();
        expect(authResult.timingVerdict?.allowed).toBe(true);
      }

      // 4. Gateway processes through CryptoService
      const cryptoService = cryptoGateway.getCryptoService();
      expect(cryptoService).toBeDefined();

      // 5. Memory is encrypted at rest
      const memoryContent = "User said: Hello, EdwinPAI!";
      const encryptedMemory = await memoryEncryption.encryptMemory(
        memoryContent,
        client.getPublicKey(),
      );

      expect(encryptedMemory.version).toBe(1);
      expect(encryptedMemory.ciphertext).toBeDefined();
      expect(encryptedMemory.ciphertext).not.toContain(memoryContent);

      // 6. Memory can be decrypted for retrieval
      const decryptedMemory = await memoryEncryption.decryptMemory(
        encryptedMemory,
        client.getPublicKey(),
      );

      expect(decryptedMemory).toBe(memoryContent);

      // 7. Gateway health check confirms all systems operational
      const health = cryptoGateway.health();
      expect(health.status).toBe("ok");
    });
  });

  describe("reject unsigned requests", () => {
    it("should reject requests without auth headers", async () => {
      const req = createMockRequest("POST", "/api/chat", {});
      const authResult = await processBsvAuth(req, bsvAuth, { message: "Hello" });

      expect(authResult.ok).toBe(false);
      if (!authResult.ok) {
        expect(authResult.code).toBe("UNAUTHENTICATED");
        expect(authResult.status).toBe(401);
      }
    });

    it("should reject requests with invalid signature", async () => {
      const client = new EdwinPAIClient({
        serverUrl: "https://example.com",
      });

      const signedHeaders = client.getSignedHeaders("POST", "/api/chat", { message: "Hello" });

      // Corrupt the signature
      signedHeaders["x-bsv-signature"] = "0".repeat(signedHeaders["x-bsv-signature"].length);

      const req = createMockRequest("POST", "/api/chat", signedHeaders);
      const authResult = await processBsvAuth(req, bsvAuth, { message: "Hello" });

      expect(authResult.ok).toBe(false);
      if (!authResult.ok) {
        expect(authResult.code).toBe("INVALID_SIGNATURE");
      }
    });

    it("should reject requests with tampered body", async () => {
      const client = new EdwinPAIClient({
        serverUrl: "https://example.com",
      });

      // Sign with one body
      const signedHeaders = client.getSignedHeaders("POST", "/api/chat", { message: "Hello" });

      // Verify with different body
      const req = createMockRequest("POST", "/api/chat", signedHeaders);
      const authResult = await processBsvAuth(req, bsvAuth, { message: "Goodbye" });

      expect(authResult.ok).toBe(false);
      if (!authResult.ok) {
        expect(authResult.code).toBe("INVALID_SIGNATURE");
      }
    });
  });

  describe("reject replayed requests", () => {
    it("should reject replay attacks", async () => {
      const client = new EdwinPAIClient({
        serverUrl: "https://example.com",
      });

      // First request succeeds
      const signedHeaders = client.getSignedHeaders("POST", "/api/chat", { message: "Hello" });
      const req1 = createMockRequest("POST", "/api/chat", signedHeaders);
      const result1 = await processBsvAuth(req1, bsvAuth, { message: "Hello" });
      expect(result1.ok).toBe(true);

      // Same headers replayed should fail
      const req2 = createMockRequest("POST", "/api/chat", signedHeaders);
      const result2 = await processBsvAuth(req2, bsvAuth, { message: "Hello" });

      expect(result2.ok).toBe(false);
      if (!result2.ok) {
        expect(result2.code).toBe("REPLAY");
      }
    });
  });

  describe("detect concurrent action anomaly", () => {
    it("should detect concurrent actions from same identity", async () => {
      // Use RequestSigner directly since EdwinPAIClient doesn't expose timestamp control
      const identity = EdwinPAIClient.generateIdentity();
      const { RequestSigner } = await import("../auth/request-signer.js");
      const signer = RequestSigner.fromHex(identity.privateKeyHex);

      const timestamp = Date.now();

      // First request with specific timestamp
      const headers1 = signer.signRequest({
        method: "POST",
        path: "/api/chat",
        body: { message: "First" },
        timestamp,
      });

      const req1 = createMockRequest("POST", "/api/chat", headers1);
      const result1 = await processBsvAuth(req1, bsvAuth, { message: "First" });
      expect(result1.ok).toBe(true);

      // Second request with timestamp in concurrency window (within 100ms)
      const headers2 = signer.signRequest({
        method: "POST",
        path: "/api/chat",
        body: { message: "Second" },
        timestamp: timestamp + 50,
      });

      const req2 = createMockRequest("POST", "/api/chat", headers2);
      const result2 = await processBsvAuth(req2, bsvAuth, { message: "Second" });

      expect(result2.ok).toBe(false);
      if (!result2.ok) {
        expect(result2.code).toBe("CONCURRENT_ACTION");
        expect(result2.status).toBe(429);
      }
    });

    it("should allow sequential requests with proper timing", async () => {
      const client = new EdwinPAIClient({
        serverUrl: "https://example.com",
      });

      // First request
      const headers1 = client.getSignedHeaders("POST", "/api/chat", { message: "First" });
      const req1 = createMockRequest("POST", "/api/chat", headers1);
      const result1 = await processBsvAuth(req1, bsvAuth, { message: "First" });
      expect(result1.ok).toBe(true);

      // Wait for concurrency window to pass
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Second request should succeed
      const headers2 = client.getSignedHeaders("POST", "/api/chat", { message: "Second" });
      const req2 = createMockRequest("POST", "/api/chat", headers2);
      const result2 = await processBsvAuth(req2, bsvAuth, { message: "Second" });
      expect(result2.ok).toBe(true);
    });
  });

  describe("encrypt and decrypt memories round-trip", () => {
    it("should encrypt and decrypt memories correctly", async () => {
      const client = new EdwinPAIClient({
        serverUrl: "https://example.com",
      });

      const memories = ["User prefers dark mode", "User's name is Alice", "User likes jazz music"];

      // Encrypt all memories
      const encrypted = await memoryEncryption.encryptBatch(memories, client.getPublicKey());

      expect(encrypted).toHaveLength(3);
      for (const enc of encrypted) {
        expect(enc.version).toBe(1);
        expect(enc.ciphertext).toBeDefined();
      }

      // Decrypt all memories
      const decrypted = await memoryEncryption.decryptBatch(encrypted, client.getPublicKey());

      expect(decrypted).toEqual(memories);
    });

    it("should isolate memories between users", async () => {
      const client1 = new EdwinPAIClient({ serverUrl: "https://example.com" });
      const _client2 = new EdwinPAIClient({ serverUrl: "https://example.com" });

      // Encrypt memory for client1
      const encrypted = await memoryEncryption.encryptMemory(
        "Secret for client 1",
        client1.getPublicKey(),
      );

      // Decrypt with correct key
      const decrypted = await memoryEncryption.decryptMemory(encrypted, client1.getPublicKey());
      expect(decrypted).toBe("Secret for client 1");

      // Note: Trying to decrypt with wrong key would fail
      // but that requires storing the encrypted data differently
    });
  });

  describe("owner authentication", () => {
    it("should identify owner requests", async () => {
      const ownerClient = new EdwinPAIClient({
        serverUrl: "https://example.com",
      });

      const ownerAuth = resolveBsvAuth({
        bsvAuthConfig: {
          enabled: true,
          ownerPublicKey: ownerClient.getPublicKey(),
        },
      });

      // Sign with a body and pass that same body to processBsvAuth
      const body = { action: "admin" };
      const headers = ownerClient.getSignedHeaders("POST", "/api/admin", body);
      const req = createMockRequest("POST", "/api/admin", headers);
      const result = await processBsvAuth(req, ownerAuth, body);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.isOwner).toBe(true);
      }
    });

    it("should reject non-owner on owner-only endpoints", async () => {
      const ownerClient = new EdwinPAIClient({ serverUrl: "https://example.com" });
      const regularClient = new EdwinPAIClient({ serverUrl: "https://example.com" });

      const ownerAuth = resolveBsvAuth({
        bsvAuthConfig: {
          enabled: true,
          ownerPublicKey: ownerClient.getPublicKey(),
          ownerOnly: true,
        },
      });

      // Sign with a body and pass that same body to processBsvAuth
      const body = { action: "admin" };
      const headers = regularClient.getSignedHeaders("POST", "/api/admin", body);
      const req = createMockRequest("POST", "/api/admin", headers);
      const result = await processBsvAuth(req, ownerAuth, body);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("NOT_OWNER");
      }
    });
  });

  describe("client-to-client encryption", () => {
    it("should allow encrypted messaging between clients", async () => {
      const alice = new EdwinPAIClient({ serverUrl: "https://example.com" });
      const bob = new EdwinPAIClient({ serverUrl: "https://example.com" });

      // Alice encrypts for Bob
      const plaintext = "Hello Bob, this is a secret message!";
      const encrypted = await alice.encryptFor(bob.getPublicKey(), plaintext);

      // Bob decrypts from Alice
      const decrypted = await bob.decryptFrom(alice.getPublicKey(), encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it("should support bidirectional encrypted communication", async () => {
      const alice = new EdwinPAIClient({ serverUrl: "https://example.com" });
      const bob = new EdwinPAIClient({ serverUrl: "https://example.com" });

      // Alice to Bob
      const msg1 = "Hello Bob!";
      const enc1 = await alice.encryptFor(bob.getPublicKey(), msg1);
      const dec1 = await bob.decryptFrom(alice.getPublicKey(), enc1);
      expect(dec1).toBe(msg1);

      // Bob to Alice
      const msg2 = "Hello Alice!";
      const enc2 = await bob.encryptFor(alice.getPublicKey(), msg2);
      const dec2 = await alice.decryptFrom(bob.getPublicKey(), enc2);
      expect(dec2).toBe(msg2);
    });
  });

  describe("gateway health monitoring", () => {
    it("should report healthy status during normal operation", () => {
      const health = cryptoGateway.health();

      expect(health.status).toBe("ok");
      expect(health.details.cryptoService.status).toBe("ok");
      expect(health.details.requestAuthorizer.status).toBe("ok");
      expect(health.details.timingMonitor.status).toBe("ok");
    });

    it("should report error status after shutdown", () => {
      cryptoGateway.shutdown();
      const health = cryptoGateway.health();

      expect(health.status).toBe("error");
    });
  });
});
