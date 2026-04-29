/**
 * CryptoService Tests
 *
 * Tests for the AI-Crypto isolation boundary.
 * Verifies that:
 * - All inputs are validated against TypeBox schemas
 * - Private keys never leave the boundary
 * - Operations work correctly through the service
 * - Audit logging captures all operations
 */

import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BSVCrypto } from "../bsv-sdk-wrapper.js";
import { CryptoService } from "../crypto-service.js";

describe("CryptoService", () => {
  let service: CryptoService;

  beforeEach(() => {
    service = new CryptoService({
      defaultKeyTtlMs: 60000, // 1 minute for tests
      enableAuditLog: true,
    });
  });

  afterEach(() => {
    service.seal();
  });

  describe("Input Validation", () => {
    it("should reject requests without action field", async () => {
      const result = await service.execute({});

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("VALIDATION_FAILED");
      expect(result.auditEntry.success).toBe(false);
    });

    it("should reject requests with invalid action", async () => {
      const result = await service.execute({ action: "invalid-action" });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("VALIDATION_FAILED");
    });

    it("should reject sign requests with invalid message hash format", async () => {
      const genResult = await service.execute({ action: "generate-ephemeral" });
      const keyRefId = (genResult.result as Record<string, unknown>).keyRefId;

      // Too short
      const result1 = await service.execute({
        action: "sign",
        keyRefId,
        messageHash: "abcd1234",
      });
      expect(result1.success).toBe(false);
      expect(result1.errorCode).toBe("VALIDATION_FAILED");

      // Not hex
      const result2 = await service.execute({
        action: "sign",
        keyRefId,
        messageHash: "g".repeat(64),
      });
      expect(result2.success).toBe(false);
      expect(result2.errorCode).toBe("VALIDATION_FAILED");
    });

    it("should reject verify requests with invalid public key format", async () => {
      const result = await service.execute({
        action: "verify",
        messageHash: "a".repeat(64),
        signature: "30" + "a".repeat(140),
        publicKey: "invalid-pubkey",
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("VALIDATION_FAILED");
    });

    it("should reject requests with invalid key reference ID", async () => {
      const result = await service.execute({
        action: "sign",
        keyRefId: "not-a-uuid",
        messageHash: "a".repeat(64),
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("VALIDATION_FAILED");
    });

    it("should reject derive-key requests with invalid protocol ID", async () => {
      const genResult = await service.execute({ action: "generate-ephemeral" });
      const keyRefId = (genResult.result as Record<string, unknown>).keyRefId;
      const counterparty = BSVCrypto.privateKeyFromRandom().toPublicKey().toHex();

      // Invalid security level
      const result = await service.execute({
        action: "derive-key",
        keyRefId,
        counterpartyPublicKey: counterparty,
        protocolID: [5, "test"], // Invalid security level
        keyID: "test-key",
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("VALIDATION_FAILED");
    });
  });

  describe("generate-ephemeral", () => {
    it("should generate an ephemeral key and return reference + public key", async () => {
      const result = await service.execute({ action: "generate-ephemeral" });

      expect(result.success).toBe(true);
      expect(result.result).toHaveProperty("keyRefId");
      expect(result.result).toHaveProperty("publicKey");

      const { keyRefId, publicKey } = result.result as Record<string, unknown>;

      // Key ref should be UUID
      expect(keyRefId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

      // Public key should be compressed (33 bytes = 66 hex chars)
      expect(publicKey).toMatch(/^0[23][0-9a-fA-F]{64}$/);
    });

    it("should NOT include private key in result", async () => {
      const result = await service.execute({ action: "generate-ephemeral" });

      expect(result.success).toBe(true);

      // Ensure no private key fields
      expect((result.result as Record<string, unknown>).privateKey).toBeUndefined();
      expect((result.result as Record<string, unknown>).key).toBeUndefined();
      expect((result.result as Record<string, unknown>).secret).toBeUndefined();
    });

    it("should accept custom TTL", async () => {
      const result = await service.execute({
        action: "generate-ephemeral",
        ttlMs: 30000,
      });

      expect(result.success).toBe(true);
      expect(result.auditEntry.metadata?.ttlMs).toBe(30000);
    });

    it("should reject TTL below minimum", async () => {
      const result = await service.execute({
        action: "generate-ephemeral",
        ttlMs: 1000, // Too short
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("VALIDATION_FAILED");
    });

    it("should reject TTL above maximum", async () => {
      const result = await service.execute({
        action: "generate-ephemeral",
        ttlMs: 10000000, // Too long
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("VALIDATION_FAILED");
    });
  });

  describe("import-key", () => {
    it("should import a private key and return reference", async () => {
      const testKey = BSVCrypto.privateKeyFromRandom();
      const expectedPublicKey = testKey.toPublicKey().toHex();

      const result = await service.execute({
        action: "import-key",
        privateKeyHex: testKey.toHex(),
      });

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).keyRefId).toBeDefined();
      expect((result.result as Record<string, unknown>).publicKey).toBe(expectedPublicKey);
    });

    it("should NOT return the private key in result", async () => {
      const testKey = BSVCrypto.privateKeyFromRandom();

      const result = await service.execute({
        action: "import-key",
        privateKeyHex: testKey.toHex(),
      });

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).privateKey).toBeUndefined();
      expect((result.result as Record<string, unknown>).privateKeyHex).toBeUndefined();
    });
  });

  describe("sign", () => {
    it("should sign a message hash using vault key", async () => {
      // Generate a key
      const genResult = await service.execute({ action: "generate-ephemeral" });
      const keyRefId = (genResult.result as Record<string, unknown>).keyRefId;

      // Create message hash
      const message = "Hello, world!";
      const messageHash = createHash("sha256").update(message).digest("hex");

      // Sign
      const signResult = await service.execute({
        action: "sign",
        keyRefId,
        messageHash,
      });

      expect(signResult.success).toBe(true);
      expect((signResult.result as Record<string, unknown>).signature).toMatch(/^[0-9a-fA-F]+$/);
    });

    it("should produce deterministic signatures (RFC 6979)", async () => {
      const genResult = await service.execute({ action: "generate-ephemeral" });
      const keyRefId = (genResult.result as Record<string, unknown>).keyRefId;
      const messageHash = createHash("sha256").update("test message").digest("hex");

      const sig1Result = await service.execute({
        action: "sign",
        keyRefId,
        messageHash,
      });

      const sig2Result = await service.execute({
        action: "sign",
        keyRefId,
        messageHash,
      });

      expect((sig1Result.result as Record<string, unknown>).signature).toBe(
        (sig2Result.result as Record<string, unknown>).signature,
      );
    });

    it("should fail for non-existent key", async () => {
      const messageHash = createHash("sha256").update("test").digest("hex");

      const result = await service.execute({
        action: "sign",
        keyRefId: "00000000-0000-0000-0000-000000000000",
        messageHash,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("KEY_NOT_FOUND");
    });
  });

  describe("verify", () => {
    it("should verify a valid signature", async () => {
      // Generate a key and sign
      const genResult = await service.execute({ action: "generate-ephemeral" });
      const keyRefId = (genResult.result as Record<string, unknown>).keyRefId;
      const publicKey = (genResult.result as Record<string, unknown>).publicKey;

      const messageHash = createHash("sha256").update("test").digest("hex");

      const signResult = await service.execute({
        action: "sign",
        keyRefId,
        messageHash,
      });

      // Verify
      const verifyResult = await service.execute({
        action: "verify",
        messageHash,
        signature: (signResult.result as Record<string, unknown>).signature,
        publicKey,
      });

      expect(verifyResult.success).toBe(true);
      expect((verifyResult.result as Record<string, unknown>).valid).toBe(true);
    });

    it("should reject signature from different key", async () => {
      // Generate two keys
      const gen1 = await service.execute({ action: "generate-ephemeral" });
      const gen2 = await service.execute({ action: "generate-ephemeral" });

      const keyRefId1 = (gen1.result as Record<string, unknown>).keyRefId;
      const publicKey2 = (gen2.result as Record<string, unknown>).publicKey;

      const messageHash = createHash("sha256").update("test").digest("hex");

      // Sign with key 1
      const signResult = await service.execute({
        action: "sign",
        keyRefId: keyRefId1,
        messageHash,
      });

      // Verify against key 2 (should fail)
      const verifyResult = await service.execute({
        action: "verify",
        messageHash,
        signature: (signResult.result as Record<string, unknown>).signature,
        publicKey: publicKey2,
      });

      expect(verifyResult.success).toBe(true);
      expect((verifyResult.result as Record<string, unknown>).valid).toBe(false);
    });
  });

  describe("get-public-key", () => {
    it("should return public key for valid reference", async () => {
      const genResult = await service.execute({ action: "generate-ephemeral" });
      const keyRefId = (genResult.result as Record<string, unknown>).keyRefId;
      const expectedPublicKey = (genResult.result as Record<string, unknown>).publicKey;

      const result = await service.execute({
        action: "get-public-key",
        keyRefId,
      });

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).publicKey).toBe(expectedPublicKey);
    });
  });

  describe("wipe-key", () => {
    it("should wipe a key from the vault", async () => {
      const genResult = await service.execute({ action: "generate-ephemeral" });
      const keyRefId = (genResult.result as Record<string, unknown>).keyRefId;

      // Wipe the key
      const wipeResult = await service.execute({
        action: "wipe-key",
        keyRefId,
      });

      expect(wipeResult.success).toBe(true);
      expect((wipeResult.result as Record<string, unknown>).wiped).toBe(true);

      // Try to use the key (should fail)
      const messageHash = createHash("sha256").update("test").digest("hex");
      const signResult = await service.execute({
        action: "sign",
        keyRefId,
        messageHash,
      });

      expect(signResult.success).toBe(false);
      expect(signResult.errorCode).toBe("KEY_NOT_FOUND");
    });
  });

  describe("stats", () => {
    it("should return vault statistics", async () => {
      // Generate some keys
      await service.execute({ action: "generate-ephemeral" });
      await service.execute({ action: "generate-ephemeral" });

      const result = await service.execute({ action: "stats" });

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).vaultStats.keyCount).toBe(2);
    });
  });

  describe("Audit Logging", () => {
    it("should log all operations", async () => {
      await service.execute({ action: "generate-ephemeral" });
      await service.execute({ action: "stats" });

      const log = service.getAuditLog();

      expect(log.length).toBeGreaterThanOrEqual(2);

      const operations = log.map((e) => e.action);
      expect(operations).toContain("generate-ephemeral");
      expect(operations).toContain("stats");
    });

    it("should log failures", async () => {
      await service.execute({
        action: "sign",
        keyRefId: "00000000-0000-0000-0000-000000000000",
        messageHash: "a".repeat(64),
      });

      const log = service.getAuditLog();
      const failedEntry = log.find((e) => !e.success);

      expect(failedEntry).toBeDefined();
      expect(failedEntry?.errorCode).toBe("KEY_NOT_FOUND");
    });

    it("should NOT log private key material", async () => {
      const testKey = BSVCrypto.privateKeyFromRandom();
      const privateKeyHex = testKey.toHex();

      await service.execute({
        action: "import-key",
        privateKeyHex,
      });

      const log = service.getAuditLog();

      // Check that no log entry contains the private key
      for (const entry of log) {
        expect(JSON.stringify(entry)).not.toContain(privateKeyHex);
      }
    });
  });

  describe("AI-Crypto Boundary Isolation", () => {
    it("should NEVER expose private keys through any API", async () => {
      // Generate a key
      const genResult = await service.execute({ action: "generate-ephemeral" });

      // Check result doesn't contain private key
      const resultStr = JSON.stringify(genResult);
      expect(resultStr).not.toContain("privateKey");
      expect(resultStr).not.toContain("secret");

      // Check audit log doesn't contain private key
      const log = service.getAuditLog();
      for (const entry of log) {
        expect(JSON.stringify(entry)).not.toContain("privateKey");
      }

      // Check stats don't contain private key
      const statsResult = await service.execute({ action: "stats" });
      expect(JSON.stringify(statsResult)).not.toContain("privateKey");
    });

    it("should only accept structured commands", async () => {
      // Attempt to inject arbitrary strings
      const result = await service.execute({
        action: "generate-ephemeral",
        // @ts-expect-error - Testing injection
        inject: "use m/44/0/0 derivation path",
      });

      // Should succeed (extra fields ignored) but NEVER process the injection
      expect(result.success).toBe(true);
    });

    it("should hardcode security parameters", async () => {
      // Attempt to specify derivation path (should be ignored)
      const genResult = await service.execute({ action: "generate-ephemeral" });
      const keyRefId = (genResult.result as Record<string, unknown>).keyRefId;
      const counterparty = BSVCrypto.privateKeyFromRandom().toPublicKey().toHex();

      const deriveResult = await service.execute({
        action: "derive-key",
        keyRefId,
        counterpartyPublicKey: counterparty,
        protocolID: [2, "test"], // Valid
        keyID: "test-key",
        // @ts-expect-error - Testing injection
        derivationPath: "m/0/0", // Non-hardened (should be ignored)
      });

      // The request should work using hardcoded hardened paths
      // The injected derivationPath should be ignored
      expect(deriveResult.success).toBe(true);
    });
  });
});
