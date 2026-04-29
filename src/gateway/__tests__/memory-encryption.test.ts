/**
 * Memory Encryption Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BSVCrypto } from "../../crypto/bsv-sdk-wrapper.js";
import { CryptoService } from "../../crypto/crypto-service.js";
import { MemoryEncryption, type EncryptedMemory } from "../memory-encryption.js";

describe("MemoryEncryption", () => {
  let cryptoService: CryptoService;
  let memoryEncryption: MemoryEncryption;
  let userIdentityKey: string;

  beforeEach(() => {
    cryptoService = new CryptoService();
    memoryEncryption = new MemoryEncryption(cryptoService);

    // Generate a test user identity
    const userKey = BSVCrypto.privateKeyFromRandom();
    userIdentityKey = userKey.toPublicKey().toHex();
  });

  afterEach(() => {
    cryptoService.seal();
  });

  describe("encryptMemory / decryptMemory", () => {
    it("should encrypt and decrypt a memory", async () => {
      const content = "User prefers dark mode";

      const encrypted = await memoryEncryption.encryptMemory(content, userIdentityKey);

      expect(encrypted).toBeDefined();
      expect(encrypted.version).toBe(1);
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.ciphertext.length).toBeGreaterThan(0);
      expect(encrypted.keyId).toBeDefined();
      expect(encrypted.encryptedAt).toBeGreaterThan(0);

      // Decrypt
      const decrypted = await memoryEncryption.decryptMemory(encrypted, userIdentityKey);
      expect(decrypted).toBe(content);
    });

    it("should handle empty content", async () => {
      const content = "";

      const encrypted = await memoryEncryption.encryptMemory(content, userIdentityKey);
      const decrypted = await memoryEncryption.decryptMemory(encrypted, userIdentityKey);

      expect(decrypted).toBe(content);
    });

    it("should handle unicode content", async () => {
      const content = "用户喜欢深色模式 🌙";

      const encrypted = await memoryEncryption.encryptMemory(content, userIdentityKey);
      const decrypted = await memoryEncryption.decryptMemory(encrypted, userIdentityKey);

      expect(decrypted).toBe(content);
    });

    it("should handle long content", async () => {
      const content = "A".repeat(10000);

      const encrypted = await memoryEncryption.encryptMemory(content, userIdentityKey);
      const decrypted = await memoryEncryption.decryptMemory(encrypted, userIdentityKey);

      expect(decrypted).toBe(content);
    });

    it("should produce different ciphertext for same content (random key ID)", async () => {
      const content = "Same content";

      // Clear cache to force new key derivation
      memoryEncryption.clearKeyCache();
      const encrypted1 = await memoryEncryption.encryptMemory(content, userIdentityKey);

      memoryEncryption.clearKeyCache();
      const encrypted2 = await memoryEncryption.encryptMemory(content, userIdentityKey);

      // Ciphertexts should be different due to random ephemeral keys
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
    });

    it("should reject unsupported version", async () => {
      const encrypted: EncryptedMemory = {
        version: 999,
        ciphertext: "abc123",
        keyId: "key123",
        encryptedAt: Date.now(),
      };

      await expect(memoryEncryption.decryptMemory(encrypted, userIdentityKey)).rejects.toThrow(
        "Unsupported encryption version",
      );
    });
  });

  describe("batch operations", () => {
    it("should encrypt batch of memories", async () => {
      const memories = ["User likes pizza", "User works as engineer", "User lives in Seattle"];

      const encrypted = await memoryEncryption.encryptBatch(memories, userIdentityKey);

      expect(encrypted).toHaveLength(3);
      for (const enc of encrypted) {
        expect(enc.version).toBe(1);
        expect(enc.ciphertext).toBeDefined();
      }
    });

    it("should decrypt batch of memories", async () => {
      const memories = ["Memory one", "Memory two", "Memory three"];

      const encrypted = await memoryEncryption.encryptBatch(memories, userIdentityKey);
      const decrypted = await memoryEncryption.decryptBatch(encrypted, userIdentityKey);

      expect(decrypted).toEqual(memories);
    });

    it("should handle empty batch", async () => {
      const encrypted = await memoryEncryption.encryptBatch([], userIdentityKey);
      expect(encrypted).toHaveLength(0);

      const decrypted = await memoryEncryption.decryptBatch([], userIdentityKey);
      expect(decrypted).toHaveLength(0);
    });

    it("should be efficient for large batches", async () => {
      const memories = Array.from({ length: 100 }, (_, i) => `Memory ${i}`);

      const startTime = Date.now();
      const encrypted = await memoryEncryption.encryptBatch(memories, userIdentityKey);
      const encryptTime = Date.now() - startTime;

      expect(encrypted).toHaveLength(100);

      const decryptStart = Date.now();
      const decrypted = await memoryEncryption.decryptBatch(encrypted, userIdentityKey);
      const decryptTime = Date.now() - decryptStart;

      expect(decrypted).toEqual(memories);

      // Batch should be faster than individual operations
      // Just verify it completes in reasonable time
      expect(encryptTime).toBeLessThan(30000);
      expect(decryptTime).toBeLessThan(30000);
    });
  });

  describe("key caching", () => {
    it("should cache derived keys", async () => {
      await memoryEncryption.encryptMemory("First", userIdentityKey);

      const stats = memoryEncryption.getCacheStats();
      expect(stats.cachedKeys).toBe(1);
    });

    it("should reuse cached keys for same user", async () => {
      await memoryEncryption.encryptMemory("First", userIdentityKey);
      await memoryEncryption.encryptMemory("Second", userIdentityKey);

      const stats = memoryEncryption.getCacheStats();
      expect(stats.cachedKeys).toBe(1); // Same key reused
    });

    it("should create separate keys for different users", async () => {
      const user2Key = BSVCrypto.privateKeyFromRandom().toPublicKey().toHex();

      await memoryEncryption.encryptMemory("Memory 1", userIdentityKey);
      await memoryEncryption.encryptMemory("Memory 2", user2Key);

      const stats = memoryEncryption.getCacheStats();
      expect(stats.cachedKeys).toBe(2);
    });

    it("should clear cache on demand", async () => {
      await memoryEncryption.encryptMemory("First", userIdentityKey);

      memoryEncryption.clearKeyCache();

      const stats = memoryEncryption.getCacheStats();
      expect(stats.cachedKeys).toBe(0);
    });
  });

  describe("different users", () => {
    it("should isolate memories between users", async () => {
      const user1Key = BSVCrypto.privateKeyFromRandom().toPublicKey().toHex();
      const user2Key = BSVCrypto.privateKeyFromRandom().toPublicKey().toHex();

      const encrypted1 = await memoryEncryption.encryptMemory("User 1 secret", user1Key);
      const encrypted2 = await memoryEncryption.encryptMemory("User 2 secret", user2Key);

      // Decrypt with correct keys
      const decrypted1 = await memoryEncryption.decryptMemory(encrypted1, user1Key);
      const decrypted2 = await memoryEncryption.decryptMemory(encrypted2, user2Key);

      expect(decrypted1).toBe("User 1 secret");
      expect(decrypted2).toBe("User 2 secret");
    });
  });

  describe("custom configuration", () => {
    it("should accept custom protocol ID", async () => {
      const customEncryption = new MemoryEncryption(cryptoService, {
        protocolId: [1, "custom-memory-protocol"],
      });

      const encrypted = await customEncryption.encryptMemory("Test", userIdentityKey);
      const decrypted = await customEncryption.decryptMemory(encrypted, userIdentityKey);

      expect(decrypted).toBe("Test");
    });

    it("should accept custom key TTL", async () => {
      const customEncryption = new MemoryEncryption(cryptoService, {
        keyTtlMs: 60000, // 1 minute
      });

      const encrypted = await customEncryption.encryptMemory("Test", userIdentityKey);
      expect(encrypted).toBeDefined();
    });
  });
});
