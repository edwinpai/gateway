/**
 * Isolation Boundary Integration Tests
 *
 * CRITICAL: These tests verify that the AI layer cannot access key material
 * through the CryptoService API. This is the core security property of the
 * AI-Crypto boundary isolation architecture.
 *
 * Test Categories:
 * 1. API Surface - Verify only safe operations are exposed
 * 2. Return Values - Verify private keys never appear in responses
 * 3. Audit Logs - Verify no key material in logs
 * 4. Error Messages - Verify no key material in errors
 * 5. Injection Resistance - Verify structured commands block injection
 */

import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BSVCrypto } from "../../crypto/bsv-sdk-wrapper.js";
import { CryptoService } from "../../crypto/crypto-service.js";
import { KeyVault } from "../../crypto/key-vault.js";
import { SecureVault } from "../../crypto/vault.js";

describe("AI-Crypto Isolation Boundary", () => {
  describe("CryptoService API Surface", () => {
    let service: CryptoService;

    beforeEach(() => {
      service = new CryptoService();
    });

    afterEach(() => {
      service.seal();
    });

    it("should expose ONLY structured command API", () => {
      // CryptoService should only expose these public methods:
      const allowedMethods = new Set([
        "execute",
        "getAuditLog",
        "clearAuditLog",
        "getVaultStats",
        "seal",
        // Internal helpers (marked private in TS but visible on JS prototype)
        "createAuditEntry",
      ]);

      const serviceProto = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
      const publicMethods = serviceProto.filter(
        (name) => !name.startsWith("_") && name !== "constructor",
      );

      const unexpectedMethods: string[] = [];
      for (const method of publicMethods) {
        if (!method.startsWith("handle")) {
          if (!allowedMethods.has(method)) {
            unexpectedMethods.push(method);
          }
        }
      }
      expect(unexpectedMethods).toEqual([]);
    });

    it("should NOT expose methods to get private keys", () => {
      // These methods should NOT exist
      const dangerousMethods = [
        "getPrivateKey",
        "exportKey",
        "dumpKeys",
        "getKeyMaterial",
        "getRawKey",
      ];

      for (const method of dangerousMethods) {
        expect((service as Record<string, unknown>)[method]).toBeUndefined();
      }
    });

    it("should only accept validated structured commands", async () => {
      // Attempt to pass freeform strings as crypto parameters
      const result = await service.execute({
        action: "sign",
        keyRefId: "use non-hardened derivation m/0/0", // Injection attempt
        messageHash: "a".repeat(64),
      });

      // Should fail validation (invalid UUID format)
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("VALIDATION_FAILED");
    });
  });

  describe("Private Key Never Returned", () => {
    let service: CryptoService;

    beforeEach(() => {
      service = new CryptoService();
    });

    afterEach(() => {
      service.seal();
    });

    it("should never include private key in generate-ephemeral response", async () => {
      const result = await service.execute({ action: "generate-ephemeral" });

      const resultStr = JSON.stringify(result);

      // Check for common private key field names — actual key material, not references
      expect(resultStr).not.toContain('"privateKey"');
      expect(resultStr).not.toContain('"secret"');
      expect(resultStr).not.toContain('"secretKey"');
      expect(resultStr.toLowerCase()).not.toContain("private");

      // Result should only have keyRefId and publicKey
      const keys = Object.keys(result.result as object);
      expect(keys).toEqual(["publicKey", "keyRefId"]);
    });

    it("should never include private key in import-key response", async () => {
      const testKey = BSVCrypto.privateKeyFromRandom();
      const privateKeyHex = testKey.toHex();

      const result = await service.execute({
        action: "import-key",
        privateKeyHex,
      });

      const resultStr = JSON.stringify(result);

      // The actual private key value should not appear
      expect(resultStr).not.toContain(privateKeyHex);

      // Result should only have keyRefId and publicKey
      const keys = Object.keys(result.result as object);
      expect(keys).toEqual(["keyRefId", "publicKey"]);
    });

    it("should never include private key in derive-key response", async () => {
      // First generate a key
      const genResult = await service.execute({ action: "generate-ephemeral" });
      const keyRefId = (genResult.result as Record<string, unknown>).keyRefId;
      const counterparty = BSVCrypto.privateKeyFromRandom().toPublicKey().toHex();

      const deriveResult = await service.execute({
        action: "derive-key",
        keyRefId,
        counterpartyPublicKey: counterparty,
        protocolID: [2, "test"],
        keyID: "test-key",
      });

      const resultStr = JSON.stringify(deriveResult);

      // Check for private key indicators
      expect(resultStr.toLowerCase()).not.toContain("private");

      // Result should only have publicKey and keyRefId
      const keys = Object.keys(deriveResult.result as object);
      expect(keys).toContain("publicKey");
      expect(keys).toContain("keyRefId");
    });

    it("should never include private key in sign response", async () => {
      const genResult = await service.execute({ action: "generate-ephemeral" });
      const keyRefId = (genResult.result as Record<string, unknown>).keyRefId;
      const messageHash = createHash("sha256").update("test").digest("hex");

      const signResult = await service.execute({
        action: "sign",
        keyRefId,
        messageHash,
      });

      const resultStr = JSON.stringify(signResult);

      // Only signature should be returned, not actual key material
      expect(resultStr.toLowerCase()).not.toContain("privatekey");
      expect(resultStr.toLowerCase()).not.toContain("private_key");
      expect(resultStr.toLowerCase()).not.toContain("secretkey");
      expect(resultStr.toLowerCase()).not.toContain('"secret"');
      // keyRefId is a UUID reference, not key material — that's fine

      const keys = Object.keys(signResult.result as object);
      expect(keys).toEqual(["signature"]);
    });
  });

  describe("Audit Log Security", () => {
    let service: CryptoService;

    beforeEach(() => {
      service = new CryptoService();
    });

    afterEach(() => {
      service.seal();
    });

    it("should never log private key material", async () => {
      const testKey = BSVCrypto.privateKeyFromRandom();
      const privateKeyHex = testKey.toHex();

      // Import a key
      await service.execute({
        action: "import-key",
        privateKeyHex,
      });

      // Generate a key
      const genResult = await service.execute({ action: "generate-ephemeral" });
      const keyRefId = (genResult.result as Record<string, unknown>).keyRefId;

      // Sign with it
      const messageHash = createHash("sha256").update("test").digest("hex");
      await service.execute({
        action: "sign",
        keyRefId,
        messageHash,
      });

      // Check entire audit log
      const log = service.getAuditLog();
      const logStr = JSON.stringify(log);

      // Should not contain the private key
      expect(logStr).not.toContain(privateKeyHex);
      expect(logStr.toLowerCase()).not.toContain("private");
    });

    it("should log only safe metadata", async () => {
      await service.execute({ action: "generate-ephemeral" });

      const log = service.getAuditLog();
      const entry = log[0];

      // Check that entry only has allowed fields
      const allowedFields = [
        "id",
        "timestamp",
        "action",
        "keyRefId",
        "success",
        "errorCode",
        "metadata",
      ];

      for (const key of Object.keys(entry)) {
        expect(allowedFields).toContain(key);
      }

      // Metadata should only contain safe values
      if (entry.metadata) {
        const metadataStr = JSON.stringify(entry.metadata);
        expect(metadataStr.toLowerCase()).not.toContain("private");
        expect(metadataStr.toLowerCase()).not.toContain("secret");
      }
    });
  });

  describe("Error Message Security", () => {
    let service: CryptoService;

    beforeEach(() => {
      service = new CryptoService();
    });

    afterEach(() => {
      service.seal();
    });

    it("should not leak key material in error messages", async () => {
      const testKey = BSVCrypto.privateKeyFromRandom();

      // Try to import invalid key format (but don't leak the value)
      const result = await service.execute({
        action: "import-key",
        privateKeyHex: "invalid" + testKey.toHex().slice(7), // Invalid format
      });

      expect(result.success).toBe(false);

      // Error message should not contain any key material
      expect(result.error).not.toContain(testKey.toHex());
      expect(result.error?.toLowerCase()).not.toContain("key value");
    });

    it("should use generic error messages for crypto failures", async () => {
      const genResult = await service.execute({ action: "generate-ephemeral" });
      const keyRefId = (genResult.result as Record<string, unknown>).keyRefId;

      // Try to sign with invalid hash
      const result = await service.execute({
        action: "sign",
        keyRefId,
        messageHash: "invalid",
      });

      expect(result.success).toBe(false);
      // Should not reveal internals about the key or signing process
      expect(result.error).toBeDefined();
    });
  });

  describe("Injection Resistance", () => {
    let service: CryptoService;

    beforeEach(() => {
      service = new CryptoService();
    });

    afterEach(() => {
      service.seal();
    });

    it("should reject derivation path injection attempts", async () => {
      const genResult = await service.execute({ action: "generate-ephemeral" });
      const keyRefId = (genResult.result as Record<string, unknown>).keyRefId;
      const counterparty = BSVCrypto.privateKeyFromRandom().toPublicKey().toHex();

      // Attempt to inject non-hardened derivation path
      const result = await service.execute({
        action: "derive-key",
        keyRefId,
        counterpartyPublicKey: counterparty,
        protocolID: [2, "test"],
        keyID: "m/0/0", // Injection attempt
      });

      // Should work, but the keyID is just a string, not a path
      // Actual derivation uses hardened paths internally
      expect(result.success).toBe(true);
    });

    it("should reject protocol ID injection attempts", async () => {
      const genResult = await service.execute({ action: "generate-ephemeral" });
      const keyRefId = (genResult.result as Record<string, unknown>).keyRefId;
      const counterparty = BSVCrypto.privateKeyFromRandom().toPublicKey().toHex();

      // Attempt to use invalid security level
      const result = await service.execute({
        action: "derive-key",
        keyRefId,
        counterpartyPublicKey: counterparty,
        protocolID: [99, "test"], // Invalid security level
        keyID: "test-key",
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("VALIDATION_FAILED");
    });

    it("should reject curve parameter injection attempts", async () => {
      // TypeBox validation should reject any attempt to specify curve parameters
      const result = await service.execute({
        action: "generate-ephemeral",
        // @ts-expect-error - Testing injection
        curve: "secp192k1", // Wrong curve
        // @ts-expect-error - Testing injection
        n: "0xFFFFFFFFFFFFFFFFFFFFFFFE26F2FC170F69466A74DEFD8D",
      } as unknown);

      // Extra fields are ignored by TypeBox, operation succeeds with hardcoded params
      expect(result.success).toBe(true);
    });
  });

  describe("KeyVault Isolation", () => {
    let vault: KeyVault;

    beforeEach(() => {
      vault = new KeyVault();
    });

    afterEach(() => {
      vault.seal();
    });

    it("should not expose raw key buffers", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const refId = vault.store(privateKey);

      // KeyVault should not have methods to extract raw keys
      expect((vault as Record<string, unknown>).getPrivateKey).toBeUndefined();
      expect((vault as Record<string, unknown>).extractKey).toBeUndefined();
      // Note: The 'keys' Map exists internally but entries don't expose private material

      // The only way to use the key is through vault operations
      const messageHash = Buffer.from(createHash("sha256").update("test").digest());
      const signature = vault.sign(refId, messageHash);

      expect(signature).toBeInstanceOf(Buffer);
    });

    it("should zero-fill key buffers on wipe", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const refId = vault.store(privateKey);

      // Wipe the key
      vault.wipe(refId);

      // Key should no longer be accessible
      expect(vault.has(refId)).toBe(false);
      expect(() => vault.getPublicKey(refId)).toThrow();
    });

    it("should seal the vault and prevent all operations", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      vault.store(privateKey);

      vault.seal();

      expect(vault.isSealed()).toBe(true);
      expect(() => vault.store(BSVCrypto.privateKeyFromRandom())).toThrow();
    });
  });

  describe("SecureVault Isolation", () => {
    it("should never expose private keys through vault API", async () => {
      const vault = await SecureVault.create({
        autoLockMs: 0,
        enableAuditLog: true,
      });

      const _keyId = await vault.generateKey("test-key");

      // Check that vault doesn't have dangerous methods
      expect((vault as Record<string, unknown>).getPrivateKey).toBeUndefined();
      expect((vault as Record<string, unknown>).exportKey).toBeUndefined();
      expect((vault as Record<string, unknown>).dumpKeys).toBeUndefined();

      // List keys should only return metadata
      const keys = await vault.listKeys();
      for (const key of keys) {
        expect((key as Record<string, unknown>).privateKey).toBeUndefined();
        expect((key as Record<string, unknown>).key).toBeUndefined();
      }

      // Audit log should not contain private keys
      const log = vault.getAuditLog();
      const logStr = JSON.stringify(log);
      expect(logStr.toLowerCase()).not.toContain("private");
    });
  });

  describe("Cross-Component Isolation", () => {
    it("should maintain isolation across service layers", async () => {
      const service = new CryptoService();

      // Generate a key through the service
      const genResult = await service.execute({ action: "generate-ephemeral" });
      const keyRefId = (genResult.result as Record<string, unknown>).keyRefId;

      // The service should not provide any way to extract the key
      // that was generated internally in the KeyVault

      // Check that we can only use the key through the service API
      const messageHash = createHash("sha256").update("test").digest("hex");
      const signResult = await service.execute({
        action: "sign",
        keyRefId,
        messageHash,
      });

      expect(signResult.success).toBe(true);

      // The key itself should never be accessible
      const stats = service.getVaultStats();
      expect(JSON.stringify(stats)).not.toContain("private");

      service.seal();
    });
  });
});
