/**
 * Encrypted Key Store Tests
 *
 * Tests for encrypted-at-rest key storage functionality.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SecurePrivateKey } from "../bsv-sdk-wrapper.js";
import { EncryptedKeyStore, KeyStoreConfig } from "../key-store.js";

/**
 * Create a temporary keystore path
 */
function createTempPath(): string {
  const tmpDir = os.tmpdir();
  const uniqueId = crypto.randomBytes(8).toString("hex");
  return path.join(tmpDir, `edwinpai-keystore-test-${uniqueId}.json`);
}

/**
 * Create test config with password source
 */
function createTestConfig(
  storagePath: string,
  password: string = "test-master-password",
): KeyStoreConfig {
  return {
    storagePath,
    masterKeySource: "password",
    masterPassword: password,
  };
}

/**
 * Clean up test file
 */
function cleanup(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    // Also clean up temp file if it exists
    const tempPath = `${filePath}.tmp`;
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  } catch {
    // Ignore cleanup errors
  }
}

describe("EncryptedKeyStore", () => {
  let testPath: string;

  beforeEach(() => {
    testPath = createTempPath();
  });

  afterEach(() => {
    cleanup(testPath);
  });

  describe("basic operations", () => {
    it("should create new keystore, store a key, and load it back", async () => {
      const config = createTestConfig(testPath);
      const store = await EncryptedKeyStore.open(config);

      // Generate a random key
      const originalKey = SecurePrivateKey.fromRandom();
      const keyId = "test-key-1";
      const label = "Test Key";

      // Store it
      const entry = await store.store(keyId, label, originalKey);

      expect(entry.keyId).toBe(keyId);
      expect(entry.label).toBe(label);
      expect(entry.publicKey).toBe(originalKey.toPublicKey().toHex());
      expect(entry.encryptedPrivateKey).toBeTruthy();
      expect(entry.iv).toBeTruthy();
      expect(entry.authTag).toBeTruthy();
      expect(entry.salt).toBeTruthy();
      expect(entry.createdAt).toBeLessThanOrEqual(Date.now());

      // Load it back
      const loadedKey = await store.load(keyId);

      // Verify it matches
      expect(loadedKey.toHex()).toBe(originalKey.toHex());
      expect(loadedKey.toPublicKey().toHex()).toBe(originalKey.toPublicKey().toHex());
    });

    it("should verify loaded key matches original by signing", async () => {
      const config = createTestConfig(testPath);
      const store = await EncryptedKeyStore.open(config);

      const originalKey = SecurePrivateKey.fromRandom();
      await store.store("sign-test", "Sign Test Key", originalKey);

      const loadedKey = await store.load("sign-test");

      // Sign a message with both keys
      const messageHash = crypto.randomBytes(32).toString("hex");
      const sig1 = originalKey.sign(messageHash);
      const sig2 = loadedKey.sign(messageHash);

      // Signatures should be identical (deterministic via RFC 6979)
      expect(sig1.toString("hex")).toBe(sig2.toString("hex"));
    });

    it("should list keys returning public info without needing decryption", async () => {
      const config = createTestConfig(testPath);
      const store = await EncryptedKeyStore.open(config);

      const key1 = SecurePrivateKey.fromRandom();
      const key2 = SecurePrivateKey.fromRandom();

      await store.store("key-1", "First Key", key1);
      await store.store("key-2", "Second Key", key2);

      const list = await store.list();

      expect(list).toHaveLength(2);
      expect(list.map((k) => k.keyId).toSorted()).toEqual(["key-1", "key-2"]);

      const entry1 = list.find((k) => k.keyId === "key-1")!;
      expect(entry1.label).toBe("First Key");
      expect(entry1.publicKey).toBe(key1.toPublicKey().toHex());
      expect(entry1.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it("should delete key and remove from store and disk", async () => {
      const config = createTestConfig(testPath);
      const store = await EncryptedKeyStore.open(config);

      const key = SecurePrivateKey.fromRandom();
      await store.store("delete-me", "Delete Test", key);

      expect(store.has("delete-me")).toBe(true);

      await store.delete("delete-me");

      expect(store.has("delete-me")).toBe(false);

      // Verify it's gone from disk too
      const store2 = await EncryptedKeyStore.open(config);
      expect(store2.has("delete-me")).toBe(false);
    });

    it("should throw error when deleting non-existent key", async () => {
      const config = createTestConfig(testPath);
      const store = await EncryptedKeyStore.open(config);

      await expect(store.delete("non-existent")).rejects.toThrow('Key not found: "non-existent"');
    });

    it("should throw error when loading non-existent key", async () => {
      const config = createTestConfig(testPath);
      const store = await EncryptedKeyStore.open(config);

      await expect(store.load("non-existent")).rejects.toThrow('Key not found: "non-existent"');
    });

    it("should throw error when storing duplicate keyId", async () => {
      const config = createTestConfig(testPath);
      const store = await EncryptedKeyStore.open(config);

      const key1 = SecurePrivateKey.fromRandom();
      const key2 = SecurePrivateKey.fromRandom();

      await store.store("duplicate", "First", key1);

      await expect(store.store("duplicate", "Second", key2)).rejects.toThrow(
        'Key with ID "duplicate" already exists',
      );
    });
  });

  describe("wrong master key", () => {
    it("should fail to decrypt with wrong master key (auth tag mismatch)", async () => {
      // Store with one password
      const config1 = createTestConfig(testPath, "correct-password");
      const store1 = await EncryptedKeyStore.open(config1);

      const key = SecurePrivateKey.fromRandom();
      await store1.store("secret-key", "Secret", key);

      // Try to load with different password
      const config2 = createTestConfig(testPath, "wrong-password");
      const store2 = await EncryptedKeyStore.open(config2);

      await expect(store2.load("secret-key")).rejects.toThrow(
        "Decryption failed: invalid master key or data corruption",
      );
    });
  });

  describe("persistence", () => {
    it("should persist across open/close cycles", async () => {
      const config = createTestConfig(testPath);

      // Open, store, close
      const store1 = await EncryptedKeyStore.open(config);
      const originalKey = SecurePrivateKey.fromRandom();
      await store1.store("persistent-key", "Persistent", originalKey);

      // Open again and verify
      const store2 = await EncryptedKeyStore.open(config);
      expect(store2.has("persistent-key")).toBe(true);

      const loadedKey = await store2.load("persistent-key");
      expect(loadedKey.toHex()).toBe(originalKey.toHex());
    });

    it("should handle file existence check correctly", () => {
      expect(EncryptedKeyStore.exists(testPath)).toBe(false);

      fs.writeFileSync(testPath, "{}");
      expect(EncryptedKeyStore.exists(testPath)).toBe(true);
    });
  });

  describe("multiple keys", () => {
    it("should handle multiple keys in same store", async () => {
      const config = createTestConfig(testPath);
      const store = await EncryptedKeyStore.open(config);

      const keys: { id: string; key: SecurePrivateKey }[] = [];

      // Store 5 keys
      for (let i = 0; i < 5; i++) {
        const key = SecurePrivateKey.fromRandom();
        await store.store(`key-${i}`, `Key ${i}`, key);
        keys.push({ id: `key-${i}`, key });
      }

      expect(store.size).toBe(5);

      // Verify all can be loaded
      for (const { id, key } of keys) {
        const loaded = await store.load(id);
        expect(loaded.toHex()).toBe(key.toHex());
      }
    });
  });

  describe("PBKDF2 salt uniqueness", () => {
    it("should use unique salt per key entry", async () => {
      const config = createTestConfig(testPath);
      const store = await EncryptedKeyStore.open(config);

      // Store two keys
      const key1 = SecurePrivateKey.fromRandom();
      const key2 = SecurePrivateKey.fromRandom();

      const entry1 = await store.store("key-1", "Key 1", key1);
      const entry2 = await store.store("key-2", "Key 2", key2);

      // Salts should be different
      expect(entry1.salt).not.toBe(entry2.salt);

      // Decode and verify lengths
      const salt1 = Buffer.from(entry1.salt, "base64");
      const salt2 = Buffer.from(entry2.salt, "base64");

      expect(salt1.length).toBe(32); // 256 bits
      expect(salt2.length).toBe(32);
      expect(salt1.equals(salt2)).toBe(false);
    });

    it("should use unique IV per key entry", async () => {
      const config = createTestConfig(testPath);
      const store = await EncryptedKeyStore.open(config);

      const key1 = SecurePrivateKey.fromRandom();
      const key2 = SecurePrivateKey.fromRandom();

      const entry1 = await store.store("iv-test-1", "Key 1", key1);
      const entry2 = await store.store("iv-test-2", "Key 2", key2);

      // IVs should be different
      expect(entry1.iv).not.toBe(entry2.iv);

      const iv1 = Buffer.from(entry1.iv, "base64");
      const iv2 = Buffer.from(entry2.iv, "base64");

      expect(iv1.length).toBe(12); // 96 bits per NIST
      expect(iv2.length).toBe(12);
    });
  });

  describe("missing keystore file", () => {
    it("should handle missing keystore file gracefully (creates new)", async () => {
      const config = createTestConfig(testPath);

      // File doesn't exist yet
      expect(fs.existsSync(testPath)).toBe(false);

      const store = await EncryptedKeyStore.open(config);

      // Should work with empty store
      expect(store.size).toBe(0);
      expect(await store.list()).toEqual([]);

      // Should be able to add keys
      const key = SecurePrivateKey.fromRandom();
      await store.store("new-key", "New Key", key);

      // Now file should exist
      expect(fs.existsSync(testPath)).toBe(true);
    });
  });

  describe("corrupt keystore file", () => {
    it("should throw clear error for invalid JSON", async () => {
      // Write corrupt JSON
      fs.writeFileSync(testPath, "{ invalid json }", "utf8");

      const config = createTestConfig(testPath);

      await expect(EncryptedKeyStore.open(config)).rejects.toThrow(
        "Corrupt keystore file: invalid JSON",
      );
    });

    it("should throw clear error for wrong version", async () => {
      fs.writeFileSync(testPath, JSON.stringify({ version: 999, entries: [] }), "utf8");

      const config = createTestConfig(testPath);

      await expect(EncryptedKeyStore.open(config)).rejects.toThrow(
        "Unsupported keystore version: 999",
      );
    });

    it("should throw clear error for missing entries array", async () => {
      fs.writeFileSync(testPath, JSON.stringify({ version: 1 }), "utf8");

      const config = createTestConfig(testPath);

      await expect(EncryptedKeyStore.open(config)).rejects.toThrow(
        "Invalid keystore format: entries is not an array",
      );
    });

    it("should throw clear error for invalid entry structure", async () => {
      fs.writeFileSync(
        testPath,
        JSON.stringify({
          version: 1,
          entries: [{ keyId: "test" }], // Missing required fields
        }),
        "utf8",
      );

      const config = createTestConfig(testPath);

      await expect(EncryptedKeyStore.open(config)).rejects.toThrow(
        'Invalid keystore entry: missing field "label"',
      );
    });
  });

  describe("master key validation", () => {
    it("should throw error when master key is not provided (env mode)", async () => {
      // Clear the env var if set
      const originalEnv = process.env.EDWINPAI_VAULT_MASTER_KEY;
      delete process.env.EDWINPAI_VAULT_MASTER_KEY;

      try {
        const config: KeyStoreConfig = {
          storagePath: testPath,
          masterKeySource: "env",
        };

        await expect(EncryptedKeyStore.open(config)).rejects.toThrow(
          "Master key is required but not provided",
        );
      } finally {
        // Restore
        if (originalEnv !== undefined) {
          process.env.EDWINPAI_VAULT_MASTER_KEY = originalEnv;
        }
      }
    });

    it("should read master key from custom env var", async () => {
      process.env.CUSTOM_VAULT_KEY = "custom-secret-password";

      try {
        const config: KeyStoreConfig = {
          storagePath: testPath,
          masterKeySource: "env",
          masterKeyEnvVar: "CUSTOM_VAULT_KEY",
        };

        const store = await EncryptedKeyStore.open(config);
        const key = SecurePrivateKey.fromRandom();
        await store.store("env-test", "Env Test", key);

        // Verify we can load it
        const loaded = await store.load("env-test");
        expect(loaded.toHex()).toBe(key.toHex());
      } finally {
        delete process.env.CUSTOM_VAULT_KEY;
      }
    });
  });

  describe("edge cases", () => {
    it("should handle empty label", async () => {
      const config = createTestConfig(testPath);
      const store = await EncryptedKeyStore.open(config);

      const key = SecurePrivateKey.fromRandom();
      const entry = await store.store("empty-label", "", key);

      expect(entry.label).toBe("");

      const list = await store.list();
      expect(list[0].label).toBe("");
    });

    it("should handle very long keyId and label", async () => {
      const config = createTestConfig(testPath);
      const store = await EncryptedKeyStore.open(config);

      const longId = "k".repeat(1000);
      const longLabel = "L".repeat(1000);
      const key = SecurePrivateKey.fromRandom();

      const entry = await store.store(longId, longLabel, key);
      expect(entry.keyId).toBe(longId);
      expect(entry.label).toBe(longLabel);

      const loaded = await store.load(longId);
      expect(loaded.toHex()).toBe(key.toHex());
    });

    it("should handle special characters in keyId and label", async () => {
      const config = createTestConfig(testPath);
      const store = await EncryptedKeyStore.open(config);

      const specialId = "key/with:special@chars#!$%";
      const specialLabel = "Label with émojis 🔑 and üñíçødé";
      const key = SecurePrivateKey.fromRandom();

      await store.store(specialId, specialLabel, key);

      const list = await store.list();
      expect(list[0].keyId).toBe(specialId);
      expect(list[0].label).toBe(specialLabel);
    });
  });

  describe("crypto parameters", () => {
    it("should use correct crypto parameters", async () => {
      const config = createTestConfig(testPath);
      const store = await EncryptedKeyStore.open(config);

      const key = SecurePrivateKey.fromRandom();
      const entry = await store.store("params-test", "Params Test", key);

      // Verify IV length (12 bytes = 16 base64 chars)
      const iv = Buffer.from(entry.iv, "base64");
      expect(iv.length).toBe(12);

      // Verify salt length (32 bytes = 44 base64 chars with padding)
      const salt = Buffer.from(entry.salt, "base64");
      expect(salt.length).toBe(32);

      // Verify auth tag length (16 bytes = 24 base64 chars with padding)
      const authTag = Buffer.from(entry.authTag, "base64");
      expect(authTag.length).toBe(16);
    });
  });
});
