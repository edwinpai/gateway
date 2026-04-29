/**
 * End-to-End Integration Tests - Signed Request Flow
 *
 * Tests the complete signed request lifecycle:
 * 1. Client generates a key pair (BRC-42 key derivation)
 * 2. Client signs a request (RequestSigner)
 * 3. Request travels through simulated network
 * 4. Server receives and verifies signature (RequestAuthorizer)
 * 5. CryptoService processes the request within the isolation boundary
 * 6. Encrypted response sent back (BRC-78 ECIES)
 * 7. Client decrypts response
 *
 * Test scenarios:
 * - Happy path (full roundtrip)
 * - Expired requests
 * - Invalid signatures
 * - Timing anomalies
 * - Concurrent request detection
 * - Key rotation mid-flow
 * - Large payload handling
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { KeyDerivationService, StandardProtocols } from "../../src/auth/key-derivation.js";
import { RequestAuthorizer, type AuthenticatedRequest } from "../../src/auth/request-authorizer.js";
import { RequestSigner } from "../../src/auth/request-signer.js";
import { TimingMonitor } from "../../src/auth/timing-monitor.js";
import { BSVCrypto } from "../../src/crypto/bsv-sdk-wrapper.js";
import { CryptoService } from "../../src/crypto/crypto-service.js";
import { ECIES } from "../../src/crypto/ecies.js";

describe("E2E: Signed Request Flow", () => {
  // Client and server keys
  let clientSigner: RequestSigner;
  let clientECIES: ECIES;
  let serverAuthorizer: RequestAuthorizer;
  let serverCryptoService: CryptoService;
  let serverECIES: ECIES;
  let timingMonitor: TimingMonitor;

  beforeEach(() => {
    // Use deterministic keys for reproducible tests
    const clientPrivateKey = BSVCrypto.privateKeyFromHex(
      "6a1751169c111b4667a6539ee1be6b7cd9f6e9c8fe011a5f2fe31e03a15e0ede",
    );
    const serverPrivateKey = BSVCrypto.privateKeyFromHex(
      "cab2500e206f31bc18a8af9d6f44f0b9a208c32d5cca2b22acfe9d1a213b2f36",
    );

    // Client setup
    clientSigner = new RequestSigner(clientPrivateKey);
    clientECIES = new ECIES(clientPrivateKey);

    // Server setup
    timingMonitor = new TimingMonitor({
      concurrencyWindowMs: 100,
      flagThreshold: 0.5,
      rejectThreshold: 0.9,
    });

    serverAuthorizer = new RequestAuthorizer({
      maxTimestampAgeMs: 30000,
      nonceTtlMs: 60000,
      enableTimingMonitor: true,
      timingMonitor,
    });

    serverCryptoService = new CryptoService({
      defaultKeyTtlMs: 60000, // 1 minute
      enableAuditLog: true,
    });

    serverECIES = new ECIES(serverPrivateKey);

    // Register client as known identity
    serverAuthorizer.registerIdentity(clientSigner.getIdentityKey(), {
      name: "Test Client",
      trustLevel: 80,
    });
  });

  afterEach(() => {
    serverAuthorizer.stop();
  });

  describe("Happy Path: Full Request-Response Cycle", () => {
    it("should complete a full signed request with encrypted response", async () => {
      // ==================================================================
      // STEP 1: Client generates request
      // ==================================================================
      const requestPayload = { action: "getBalance", accountId: "alice" };

      const signedHeaders = clientSigner.signRequest({
        method: "POST",
        path: "/api/agent/run",
        body: requestPayload,
      });

      // ==================================================================
      // STEP 2: Request travels through network (simulated)
      // ==================================================================
      const authenticatedRequest: AuthenticatedRequest = {
        method: "POST",
        path: "/api/agent/run",
        body: requestPayload,
        headers: signedHeaders,
      };

      // ==================================================================
      // STEP 3: Server receives and verifies signature
      // ==================================================================
      const authResult = await serverAuthorizer.authorize(authenticatedRequest);

      expect(authResult.authorized).toBe(true);
      expect(authResult.identity).toBe(clientSigner.getIdentityKey());
      expect(authResult.anomalyScore).toBeLessThan(0.5);

      // ==================================================================
      // STEP 4: Server processes request in CryptoService
      // ==================================================================
      const serverKeyResult = await serverCryptoService.execute({
        action: "generate-ephemeral",
        ttlMs: 60000,
      });

      expect(serverKeyResult.success).toBe(true);
      const serverKeyRefId = serverKeyResult.result!.keyRefId;

      // ==================================================================
      // STEP 5: Server generates encrypted response
      // ==================================================================
      const responsePayload = { balance: 1000, currency: "BSV" };
      const responsePlaintext = Buffer.from(JSON.stringify(responsePayload), "utf-8");

      const encryptResult = await serverCryptoService.execute({
        action: "encrypt",
        keyRefId: serverKeyRefId,
        plaintextHex: responsePlaintext.toString("hex"),
        recipientPublicKey: clientSigner.getPublicKey().toHex(),
      });

      expect(encryptResult.success).toBe(true);
      const encryptedResponseHex = encryptResult.result!.ciphertext;

      // ==================================================================
      // STEP 6: Response travels back through network
      // ==================================================================
      const encryptedResponseBuffer = Buffer.from(encryptedResponseHex, "hex");

      // ==================================================================
      // STEP 7: Client decrypts response
      // ==================================================================
      const serverEphemeralPublicKey = serverKeyResult.result!.publicKey;
      const decryptedResponse = clientECIES.decrypt(
        encryptedResponseBuffer,
        serverEphemeralPublicKey,
      );

      const parsedResponse = JSON.parse(decryptedResponse.toString("utf-8"));

      expect(parsedResponse).toEqual(responsePayload);
      expect(parsedResponse.balance).toBe(1000);
      expect(parsedResponse.currency).toBe("BSV");

      // ==================================================================
      // Verify audit trail
      // ==================================================================
      const auditLog = serverCryptoService.getAuditLog(10);
      expect(auditLog.length).toBeGreaterThan(0);
      expect(auditLog.some((entry) => entry.action === "generate-ephemeral")).toBe(true);
      expect(auditLog.some((entry) => entry.action === "encrypt")).toBe(true);
    });

    it("should handle multiple sequential requests from same client", async () => {
      for (let i = 0; i < 5; i++) {
        const signedHeaders = clientSigner.signRequest({
          method: "POST",
          path: "/api/test",
          body: { requestId: i },
        });

        const authResult = await serverAuthorizer.authorize({
          method: "POST",
          path: "/api/test",
          body: { requestId: i },
          headers: signedHeaders,
        });

        expect(authResult.authorized).toBe(true);
        expect(authResult.identity).toBe(clientSigner.getIdentityKey());

        // Small delay between requests to avoid timing issues
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      // Check identity stats
      const metadata = serverAuthorizer.getIdentityMetadata(clientSigner.getIdentityKey());
      expect(metadata).toBeDefined();
      expect(metadata!.authCount).toBe(5);
    });
  });

  describe("Security: Expired Requests", () => {
    it("should reject requests with expired timestamps", async () => {
      // Create request with timestamp 1 minute in the past
      const expiredTimestamp = Date.now() - 60000;

      const signedHeaders = clientSigner.signRequest({
        method: "POST",
        path: "/api/test",
        timestamp: expiredTimestamp,
      });

      const authResult = await serverAuthorizer.authorize({
        method: "POST",
        path: "/api/test",
        headers: signedHeaders,
      });

      expect(authResult.authorized).toBe(false);
      expect(authResult.reason).toContain("expired");
    });

    it("should reject requests with future timestamps", async () => {
      // Create request with timestamp 1 minute in the future
      const futureTimestamp = Date.now() + 60000;

      const signedHeaders = clientSigner.signRequest({
        method: "POST",
        path: "/api/test",
        timestamp: futureTimestamp,
      });

      const authResult = await serverAuthorizer.authorize({
        method: "POST",
        path: "/api/test",
        headers: signedHeaders,
      });

      expect(authResult.authorized).toBe(false);
      expect(authResult.reason).toContain("expired");
    });
  });

  describe("Security: Invalid Signatures", () => {
    it("should reject requests with tampered signatures", async () => {
      const signedHeaders = clientSigner.signRequest({
        method: "POST",
        path: "/api/test",
        body: { message: "original" },
      });

      // Tamper with the signature
      signedHeaders["x-bsv-signature"] = signedHeaders["x-bsv-signature"].replace(/a/g, "b");

      const authResult = await serverAuthorizer.authorize({
        method: "POST",
        path: "/api/test",
        body: { message: "original" },
        headers: signedHeaders,
      });

      expect(authResult.authorized).toBe(false);
      expect(authResult.reason).toContain("Invalid signature");
    });

    it("should reject requests with tampered body", async () => {
      const originalBody = { message: "original" };
      const signedHeaders = clientSigner.signRequest({
        method: "POST",
        path: "/api/test",
        body: originalBody,
      });

      // Tamper with the body
      const tamperedBody = { message: "tampered" };

      const authResult = await serverAuthorizer.authorize({
        method: "POST",
        path: "/api/test",
        body: tamperedBody,
        headers: signedHeaders,
      });

      expect(authResult.authorized).toBe(false);
      expect(authResult.reason).toContain("Invalid signature");
    });

    it("should reject requests signed by wrong key", async () => {
      // Create a different key
      const attackerKey = BSVCrypto.privateKeyFromRandom();
      const attackerSigner = new RequestSigner(attackerKey);

      const signedHeaders = attackerSigner.signRequest({
        method: "POST",
        path: "/api/test",
      });

      // But claim to be the legitimate client
      signedHeaders["x-bsv-identity-key"] = clientSigner.getIdentityKey();

      const authResult = await serverAuthorizer.authorize({
        method: "POST",
        path: "/api/test",
        headers: signedHeaders,
      });

      expect(authResult.authorized).toBe(false);
      expect(authResult.reason).toContain("Invalid signature");
    });
  });

  describe("Security: Replay Protection", () => {
    it("should reject replayed requests (same nonce)", async () => {
      const signedHeaders = clientSigner.signRequest({
        method: "POST",
        path: "/api/test",
        nonce: "test-nonce-123",
      });

      // First request should succeed
      const firstResult = await serverAuthorizer.authorize({
        method: "POST",
        path: "/api/test",
        headers: signedHeaders,
      });

      expect(firstResult.authorized).toBe(true);

      // Second request with same nonce should fail
      const secondResult = await serverAuthorizer.authorize({
        method: "POST",
        path: "/api/test",
        headers: signedHeaders,
      });

      expect(secondResult.authorized).toBe(false);
      expect(secondResult.reason).toContain("Replay detected");
      expect(secondResult.anomalyScore).toBe(1.0);
    });
  });

  describe("Security: Timing Anomalies", () => {
    it("should detect concurrent requests from same identity", async () => {
      const timestamp = Date.now();

      const headers1 = clientSigner.signRequest({
        method: "POST",
        path: "/api/test1",
        timestamp,
        nonce: "nonce-1",
      });

      const headers2 = clientSigner.signRequest({
        method: "POST",
        path: "/api/test2",
        timestamp: timestamp + 50, // 50ms later (within 100ms concurrency window)
        nonce: "nonce-2",
      });

      // First request should succeed
      const result1 = await serverAuthorizer.authorize({
        method: "POST",
        path: "/api/test1",
        headers: headers1,
      });

      expect(result1.authorized).toBe(true);

      // Second concurrent request should be rejected
      const result2 = await serverAuthorizer.authorize({
        method: "POST",
        path: "/api/test2",
        headers: headers2,
      });

      expect(result2.authorized).toBe(false);
      expect(result2.reason).toContain("Concurrent action detected");
    });

    it("should allow sequential requests with sufficient delay", async () => {
      const timestamp1 = Date.now();

      const headers1 = clientSigner.signRequest({
        method: "POST",
        path: "/api/test1",
        timestamp: timestamp1,
        nonce: "nonce-1",
      });

      const result1 = await serverAuthorizer.authorize({
        method: "POST",
        path: "/api/test1",
        headers: headers1,
      });

      expect(result1.authorized).toBe(true);

      // Wait 200ms to clear concurrency window
      await new Promise((resolve) => setTimeout(resolve, 200));

      const timestamp2 = Date.now();
      const headers2 = clientSigner.signRequest({
        method: "POST",
        path: "/api/test2",
        timestamp: timestamp2,
        nonce: "nonce-2",
      });

      const result2 = await serverAuthorizer.authorize({
        method: "POST",
        path: "/api/test2",
        headers: headers2,
      });

      expect(result2.authorized).toBe(true);
    });
  });

  describe("Security: Key Rotation Mid-Flow", () => {
    it("should handle client key rotation gracefully", async () => {
      // Initial request with first key
      const headers1 = clientSigner.signRequest({
        method: "POST",
        path: "/api/test1",
      });

      const result1 = await serverAuthorizer.authorize({
        method: "POST",
        path: "/api/test1",
        headers: headers1,
      });

      expect(result1.authorized).toBe(true);

      // Client rotates key
      const newClientKey = BSVCrypto.privateKeyFromRandom();
      const newClientSigner = new RequestSigner(newClientKey);

      // Register new key with server
      serverAuthorizer.registerIdentity(newClientSigner.getIdentityKey(), {
        name: "Test Client (Rotated)",
        trustLevel: 80,
      });

      // Wait to avoid concurrency detection
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Request with new key should succeed
      const headers2 = newClientSigner.signRequest({
        method: "POST",
        path: "/api/test2",
      });

      const result2 = await serverAuthorizer.authorize({
        method: "POST",
        path: "/api/test2",
        headers: headers2,
      });

      expect(result2.authorized).toBe(true);
      expect(result2.identity).toBe(newClientSigner.getIdentityKey());
      expect(result2.identity).not.toBe(clientSigner.getIdentityKey());
    });

    it("should handle server key rotation with encrypted response", async () => {
      // Generate encrypted response with first server key
      const serverKeyResult1 = await serverCryptoService.execute({
        action: "generate-ephemeral",
        ttlMs: 60000,
      });

      const keyRef1 = serverKeyResult1.result!.keyRefId;
      const payload1 = Buffer.from("message 1", "utf-8");

      const encryptResult1 = await serverCryptoService.execute({
        action: "encrypt",
        keyRefId: keyRef1,
        plaintextHex: payload1.toString("hex"),
        recipientPublicKey: clientSigner.getPublicKey().toHex(),
      });

      expect(encryptResult1.success).toBe(true);

      // Rotate server key (generate new ephemeral)
      const serverKeyResult2 = await serverCryptoService.execute({
        action: "generate-ephemeral",
        ttlMs: 60000,
      });

      const keyRef2 = serverKeyResult2.result!.keyRefId;
      const payload2 = Buffer.from("message 2", "utf-8");

      const encryptResult2 = await serverCryptoService.execute({
        action: "encrypt",
        keyRefId: keyRef2,
        plaintextHex: payload2.toString("hex"),
        recipientPublicKey: clientSigner.getPublicKey().toHex(),
      });

      expect(encryptResult2.success).toBe(true);

      // Both encryptions should use different ephemeral keys
      expect(keyRef1).not.toBe(keyRef2);

      // Client should be able to decrypt both
      const ciphertext1 = Buffer.from(encryptResult1.result!.ciphertext, "hex");
      const ciphertext2 = Buffer.from(encryptResult2.result!.ciphertext, "hex");

      const serverPubKey1 = serverKeyResult1.result!.publicKey;
      const serverPubKey2 = serverKeyResult2.result!.publicKey;

      const decrypted1 = clientECIES.decrypt(ciphertext1, serverPubKey1);
      const decrypted2 = clientECIES.decrypt(ciphertext2, serverPubKey2);

      expect(decrypted1.toString("utf-8")).toBe("message 1");
      expect(decrypted2.toString("utf-8")).toBe("message 2");
    });
  });

  describe("Performance: Large Payload Handling", () => {
    it("should handle large JSON payloads (1MB)", async () => {
      // Generate 1MB payload
      const largeArray = Array.from({ length: 50000 }, (_, i) => ({
        id: i,
        data: "x".repeat(20),
      }));

      const largePayload = { items: largeArray };

      const signedHeaders = clientSigner.signRequest({
        method: "POST",
        path: "/api/bulk",
        body: largePayload,
      });

      const authResult = await serverAuthorizer.authorize({
        method: "POST",
        path: "/api/bulk",
        body: largePayload,
        headers: signedHeaders,
      });

      expect(authResult.authorized).toBe(true);
      expect(authResult.latencyMs).toBeLessThan(5000); // Should complete within 5s
    });

    it("should encrypt and decrypt large binary payloads (1MB)", async () => {
      // Generate 1MB random data
      const largeBinaryData = Buffer.alloc(1024 * 1024);
      for (let i = 0; i < largeBinaryData.length; i++) {
        largeBinaryData[i] = i % 256;
      }

      // Server encrypts large payload
      const serverKeyResult = await serverCryptoService.execute({
        action: "generate-ephemeral",
        ttlMs: 60000,
      });

      const encryptResult = await serverCryptoService.execute({
        action: "encrypt",
        keyRefId: serverKeyResult.result!.keyRefId,
        plaintextHex: largeBinaryData.toString("hex"),
        recipientPublicKey: clientSigner.getPublicKey().toHex(),
      });

      expect(encryptResult.success).toBe(true);

      // Client decrypts
      const encryptedBuffer = Buffer.from(encryptResult.result!.ciphertext, "hex");
      const serverPubKey = serverKeyResult.result!.publicKey;

      const decrypted = clientECIES.decrypt(encryptedBuffer, serverPubKey);

      // Verify data integrity
      expect(decrypted.length).toBe(largeBinaryData.length);
      expect(decrypted.equals(largeBinaryData)).toBe(true);
    });
  });

  describe("E2E: Key Derivation Integration", () => {
    it("should use derived keys for signing and encryption", async () => {
      // Client derives a child key for this specific protocol
      const clientKDS = new KeyDerivationService(
        BSVCrypto.privateKeyFromHex(
          "6a1751169c111b4667a6539ee1be6b7cd9f6e9c8fe011a5f2fe31e03a15e0ede",
        ),
      );

      const derivedClientKey = clientKDS.derivePrivateKey(serverECIES.getPublicKey(), {
        protocolID: StandardProtocols.AUTH,
        keyID: "session-123",
      });

      // Create signer with derived key
      const derivedSigner = new RequestSigner(derivedClientKey);

      // Sign request with derived key
      const signedHeaders = derivedSigner.signRequest({
        method: "POST",
        path: "/api/derived",
      });

      // Server should accept but see a different identity key
      const authResult = await serverAuthorizer.authorize({
        method: "POST",
        path: "/api/derived",
        headers: signedHeaders,
      });

      expect(authResult.authorized).toBe(true);
      expect(authResult.identity).not.toBe(clientSigner.getIdentityKey());
      expect(authResult.identity).toBe(derivedSigner.getIdentityKey());
    });
  });

  describe("CryptoService Isolation Boundary", () => {
    it("should never expose private keys through the isolation boundary", async () => {
      const generateResult = await serverCryptoService.execute({
        action: "generate-ephemeral",
      });

      expect(generateResult.success).toBe(true);
      expect(generateResult.result!.keyRefId).toBeDefined();
      expect(generateResult.result!.publicKey).toBeDefined();

      // Private key should never be in the result
      expect(JSON.stringify(generateResult)).not.toContain("privateKey");
      expect(JSON.stringify(generateResult)).not.toContain("private");

      // Should only be able to get public key
      const pubKeyResult = await serverCryptoService.execute({
        action: "get-public-key",
        keyRefId: generateResult.result!.keyRefId,
      });

      expect(pubKeyResult.success).toBe(true);
      expect(pubKeyResult.result!.publicKey).toBeDefined();
      expect(JSON.stringify(pubKeyResult)).not.toContain("privateKey");
    });

    it("should validate all inputs through TypeBox schemas", async () => {
      // Invalid action
      const invalidAction = await serverCryptoService.execute({
        action: "invalid-action" as unknown,
      });

      expect(invalidAction.success).toBe(false);
      expect(invalidAction.errorCode).toBe("VALIDATION_FAILED");

      // Invalid key reference format
      const invalidKeyRef = await serverCryptoService.execute({
        action: "sign",
        keyRefId: "not-a-uuid",
        messageHash: "a".repeat(64),
      });

      expect(invalidKeyRef.success).toBe(false);
      expect(invalidKeyRef.errorCode).toBe("VALIDATION_FAILED");

      // Invalid message hash (wrong length)
      const validKeyResult = await serverCryptoService.execute({
        action: "generate-ephemeral",
      });

      const invalidHash = await serverCryptoService.execute({
        action: "sign",
        keyRefId: validKeyResult.result!.keyRefId,
        messageHash: "abc", // Too short
      });

      expect(invalidHash.success).toBe(false);
      expect(invalidHash.errorCode).toBe("VALIDATION_FAILED");
    });

    it("should maintain audit log for all crypto operations", async () => {
      serverCryptoService.clearAuditLog();

      // Perform several operations
      const genResult = await serverCryptoService.execute({
        action: "generate-ephemeral",
      });

      const keyRef = genResult.result!.keyRefId;

      await serverCryptoService.execute({
        action: "sign",
        keyRefId: keyRef,
        messageHash: "a".repeat(64),
      });

      await serverCryptoService.execute({
        action: "get-public-key",
        keyRefId: keyRef,
      });

      await serverCryptoService.execute({
        action: "wipe-key",
        keyRefId: keyRef,
      });

      // Check audit log
      const auditLog = serverCryptoService.getAuditLog(10);

      expect(auditLog.length).toBe(4);
      expect(auditLog.some((e) => e.action === "generate-ephemeral")).toBe(true);
      expect(auditLog.some((e) => e.action === "sign")).toBe(true);
      expect(auditLog.some((e) => e.action === "get-public-key")).toBe(true);
      expect(auditLog.some((e) => e.action === "wipe-key")).toBe(true);

      // All operations should have succeeded
      expect(auditLog.every((e) => e.success)).toBe(true);

      // Audit log should never contain key material
      const auditLogJson = JSON.stringify(auditLog);
      expect(auditLogJson).not.toContain("privateKey");
      expect(auditLogJson.length).toBeLessThan(10000); // Reasonable size
    });
  });

  describe("Complete Multi-Round Trip Flow", () => {
    it("should handle request → response → acknowledgment cycle", async () => {
      // ==================================================================
      // Round 1: Client → Server (Request)
      // ==================================================================
      const requestHeaders = clientSigner.signRequest({
        method: "POST",
        path: "/api/action",
        body: { action: "createInvoice", amount: 100 },
      });

      const authResult = await serverAuthorizer.authorize({
        method: "POST",
        path: "/api/action",
        body: { action: "createInvoice", amount: 100 },
        headers: requestHeaders,
      });

      expect(authResult.authorized).toBe(true);

      // ==================================================================
      // Round 2: Server → Client (Encrypted Response)
      // ==================================================================
      const serverKeyResult = await serverCryptoService.execute({
        action: "generate-ephemeral",
      });

      const invoiceResponse = { invoiceId: "inv-123", amount: 100, status: "pending" };
      const encryptResult = await serverCryptoService.execute({
        action: "encrypt",
        keyRefId: serverKeyResult.result!.keyRefId,
        plaintextHex: Buffer.from(JSON.stringify(invoiceResponse)).toString("hex"),
        recipientPublicKey: clientSigner.getPublicKey().toHex(),
      });

      expect(encryptResult.success).toBe(true);

      const decryptedResponse = clientECIES.decrypt(
        Buffer.from(encryptResult.result!.ciphertext, "hex"),
        serverKeyResult.result!.publicKey,
      );

      const invoice = JSON.parse(decryptedResponse.toString("utf-8"));
      expect(invoice.invoiceId).toBe("inv-123");

      // Wait to avoid concurrency detection
      await new Promise((resolve) => setTimeout(resolve, 150));

      // ==================================================================
      // Round 3: Client → Server (Acknowledgment)
      // ==================================================================
      const ackHeaders = clientSigner.signRequest({
        method: "POST",
        path: "/api/ack",
        body: { invoiceId: invoice.invoiceId, confirmed: true },
      });

      const ackAuthResult = await serverAuthorizer.authorize({
        method: "POST",
        path: "/api/ack",
        body: { invoiceId: invoice.invoiceId, confirmed: true },
        headers: ackHeaders,
      });

      expect(ackAuthResult.authorized).toBe(true);

      // Verify the full cycle completed
      const clientMetadata = serverAuthorizer.getIdentityMetadata(clientSigner.getIdentityKey());
      expect(clientMetadata!.authCount).toBe(2); // Initial request + ack
    });
  });
});
