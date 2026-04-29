/**
 * SecureVault Tests
 *
 * Tests for the AI-Crypto isolation boundary implementation.
 * Verifies that:
 * - Keys are never exposed through the API
 * - All operations work correctly through the vault boundary
 * - Error handling is robust
 * - Audit logging captures all operations
 */

import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BSVCrypto } from "../bsv-sdk-wrapper.js";
import { SecureVault, VaultError } from "../vault.js";

describe("SecureVault", () => {
  let vault: SecureVault;

  beforeEach(async () => {
    vault = await SecureVault.create({
      autoLockMs: 0, // Disable auto-lock for tests
      enableAuditLog: true,
    });
  });

  afterEach(() => {
    // Clean up any timers
    vi.useRealTimers();
  });

  describe("create()", () => {
    it("should create a vault with default configuration", async () => {
      const v = await SecureVault.create();
      expect(v).toBeInstanceOf(SecureVault);
      expect(v.isLocked()).toBe(false);
    });

    it("should create a vault with custom configuration", async () => {
      const v = await SecureVault.create({
        autoLockMs: 60000,
        maxOperationsPerMinute: 500,
      });
      expect(v).toBeInstanceOf(SecureVault);
    });
  });

  describe("generateKey()", () => {
    it("should generate a new key and return an opaque ID", async () => {
      const keyId = await vault.generateKey("test-key");

      expect(keyId).toBeDefined();
      expect(typeof keyId).toBe("string");
      // UUID format
      expect(keyId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it("should create keys with unique IDs", async () => {
      const keyId1 = await vault.generateKey("key-1");
      const keyId2 = await vault.generateKey("key-2");

      expect(keyId1).not.toBe(keyId2);
    });

    it("should generate valid secp256k1 keys", async () => {
      const keyId = await vault.generateKey("test-key");
      const publicKey = await vault.getPublicKey(keyId);

      // Compressed public key is 33 bytes = 66 hex chars
      expect(publicKey).toMatch(/^0[23][0-9a-fA-F]{64}$/);
    });

    it("should NOT expose private key through any API", async () => {
      const keyId = await vault.generateKey("test-key");

      // The vault type should not have any public methods to extract private keys
      // We verify this by checking that no such methods exist in the TypeScript type
      type VaultPublicMethods = keyof SecureVault;
      const _methodsThatDontExist: VaultPublicMethods[] = [];

      // These would cause TypeScript errors if we tried to add them:
      // 'getPrivateKey', 'exportKey', 'dumpKeys' are not valid methods

      // At runtime, even if someone casts away types, the API doesn't expose keys
      const vaultAny = vault as unknown;

      // No method to get private key
      expect(typeof vaultAny.getPrivateKey).toBe("undefined");
      expect(typeof vaultAny.exportKey).toBe("undefined");
      expect(typeof vaultAny.dumpKeys).toBe("undefined");

      // The only thing we can get is the public key and metadata
      const publicKey = await vault.getPublicKey(keyId);
      expect(publicKey).toBeDefined();

      // Verify we can only get public key, not private
      const keys = await vault.listKeys();
      expect(keys[0]).not.toHaveProperty("privateKey");
      expect(keys[0]).toHaveProperty("publicKey");
    });
  });

  describe("importKey()", () => {
    it("should import a valid private key", async () => {
      // Generate a key outside the vault for testing
      const externalKey = BSVCrypto.privateKeyFromRandom();
      const externalPublicKey = externalKey.toPublicKey().toHex();

      const keyId = await vault.importKey("imported-key", externalKey.toHex());

      expect(keyId).toBeDefined();
      const vaultPublicKey = await vault.getPublicKey(keyId);
      expect(vaultPublicKey).toBe(externalPublicKey);
    });

    it("should reject invalid private key format", async () => {
      await expect(vault.importKey("bad-key", "not-a-valid-hex")).rejects.toThrow();
    });

    it("should reject invalid private key (wrong length)", async () => {
      await expect(vault.importKey("bad-key", "abcd1234")).rejects.toThrow();
    });
  });

  describe("deleteKey()", () => {
    it("should delete an existing key", async () => {
      const keyId = await vault.generateKey("to-delete");

      await vault.deleteKey(keyId);

      await expect(vault.getPublicKey(keyId)).rejects.toThrow(VaultError);
    });

    it("should throw for non-existent key", async () => {
      await expect(vault.deleteKey("non-existent-id")).rejects.toThrow(VaultError);
    });
  });

  describe("getPublicKey()", () => {
    it("should return compressed public key", async () => {
      const keyId = await vault.generateKey("test-key");
      const publicKey = await vault.getPublicKey(keyId);

      expect(publicKey.length).toBe(66);
      expect(publicKey).toMatch(/^0[23]/);
    });

    it("should throw for invalid key ID", async () => {
      await expect(vault.getPublicKey("invalid-id")).rejects.toThrow(VaultError);
      await expect(vault.getPublicKey("")).rejects.toThrow(VaultError);
    });
  });

  describe("listKeys()", () => {
    it("should list all keys with metadata", async () => {
      await vault.generateKey("key-1");
      await vault.generateKey("key-2");
      await vault.generateKey("key-3");

      const keys = await vault.listKeys();

      expect(keys).toHaveLength(3);
      expect(keys[0]).toHaveProperty("keyId");
      expect(keys[0]).toHaveProperty("label");
      expect(keys[0]).toHaveProperty("publicKey");
      expect(keys[0]).toHaveProperty("createdAt");
      expect(keys[0]).toHaveProperty("operationCount");
    });

    it("should NOT include private key in metadata", async () => {
      await vault.generateKey("test-key");
      const keys = await vault.listKeys();

      // @ts-expect-error - Testing that privateKey is not in metadata
      expect(keys[0].privateKey).toBeUndefined();
      // @ts-expect-error - Testing that key is not in metadata
      expect(keys[0].key).toBeUndefined();
    });

    it("should return empty array for empty vault", async () => {
      const keys = await vault.listKeys();
      expect(keys).toHaveLength(0);
    });
  });

  describe("sign() / verify()", () => {
    it("should sign a message hash through vault", async () => {
      const keyId = await vault.generateKey("signing-key");
      const message = "Hello, world!";
      const messageHash = createHash("sha256").update(message).digest("hex");

      const signature = await vault.sign(keyId, messageHash);

      expect(signature).toBeInstanceOf(Buffer);
      expect(signature.length).toBeGreaterThan(0);
    });

    it("should verify a valid signature", async () => {
      const keyId = await vault.generateKey("signing-key");
      const publicKey = await vault.getPublicKey(keyId);
      const message = "Hello, world!";
      const messageHash = createHash("sha256").update(message).digest("hex");

      const signature = await vault.sign(keyId, messageHash);
      const isValid = await vault.verify(publicKey, messageHash, signature);

      expect(isValid).toBe(true);
    });

    it("should reject signature from different key", async () => {
      const keyId1 = await vault.generateKey("key-1");
      const keyId2 = await vault.generateKey("key-2");
      const publicKey2 = await vault.getPublicKey(keyId2);
      const message = "Hello, world!";
      const messageHash = createHash("sha256").update(message).digest("hex");

      const signature = await vault.sign(keyId1, messageHash);
      const isValid = await vault.verify(publicKey2, messageHash, signature);

      expect(isValid).toBe(false);
    });

    it("should reject invalid message hash format", async () => {
      const keyId = await vault.generateKey("signing-key");

      await expect(vault.sign(keyId, "not-a-hash")).rejects.toThrow(VaultError);
      await expect(vault.sign(keyId, "abcd")).rejects.toThrow(VaultError);
    });

    it("should produce deterministic signatures (RFC 6979)", async () => {
      const keyId = await vault.generateKey("deterministic-key");
      const messageHash = createHash("sha256").update("test message").digest("hex");

      const sig1 = await vault.sign(keyId, messageHash);
      const sig2 = await vault.sign(keyId, messageHash);

      expect(sig1.toString("hex")).toBe(sig2.toString("hex"));
    });
  });

  describe("deriveChildKey()", () => {
    it("should derive a child key and return new key ID", async () => {
      const parentKeyId = await vault.generateKey("parent-key");
      const counterpartyKey = BSVCrypto.privateKeyFromRandom();
      const counterpartyPublicKey = counterpartyKey.toPublicKey().toHex();

      const childKeyId = await vault.deriveChildKey(parentKeyId, counterpartyPublicKey, {
        protocolID: [2, "message encryption"],
        keyID: "test-message-1",
      });

      expect(childKeyId).toBeDefined();
      expect(childKeyId).not.toBe(parentKeyId);

      // Child key should have a different public key
      const parentPubKey = await vault.getPublicKey(parentKeyId);
      const childPubKey = await vault.getPublicKey(childKeyId);
      expect(childPubKey).not.toBe(parentPubKey);
    });

    it("should derive deterministic keys for same params", async () => {
      const parentKeyId = await vault.generateKey("parent-key");
      const counterpartyKey = BSVCrypto.privateKeyFromRandom();
      const counterpartyPublicKey = counterpartyKey.toPublicKey().toHex();

      const params = {
        protocolID: [2, "auth"] as [0 | 1 | 2, string],
        keyID: "session-123",
      };

      const childKeyId1 = await vault.deriveChildKey(parentKeyId, counterpartyPublicKey, params);
      const childKeyId2 = await vault.deriveChildKey(parentKeyId, counterpartyPublicKey, params);

      // Key IDs are different (UUIDs)
      expect(childKeyId1).not.toBe(childKeyId2);

      // But the derived keys should have the same public key (deterministic)
      const pubKey1 = await vault.getPublicKey(childKeyId1);
      const pubKey2 = await vault.getPublicKey(childKeyId2);
      expect(pubKey1).toBe(pubKey2);
    });

    it("should reject invalid counterparty public key", async () => {
      const keyId = await vault.generateKey("test-key");

      await expect(
        vault.deriveChildKey(keyId, "invalid-pubkey", {
          protocolID: [2, "test"],
          keyID: "test-1",
        }),
      ).rejects.toThrow(VaultError);
    });
  });

  describe("encrypt() / decrypt()", () => {
    it("should encrypt and decrypt through vault", async () => {
      const aliceKeyId = await vault.generateKey("alice");
      const bobKeyId = await vault.generateKey("bob");

      const alicePubKey = await vault.getPublicKey(aliceKeyId);
      const bobPubKey = await vault.getPublicKey(bobKeyId);

      const plaintext = Buffer.from("Secret message from Alice to Bob");

      // Alice encrypts for Bob
      const ciphertext = await vault.encrypt(aliceKeyId, bobPubKey, plaintext);

      // Bob decrypts from Alice
      const decrypted = await vault.decrypt(bobKeyId, alicePubKey, ciphertext);

      expect(decrypted.toString()).toBe(plaintext.toString());
    });

    it("should fail decryption with wrong key", async () => {
      const aliceKeyId = await vault.generateKey("alice");
      const bobKeyId = await vault.generateKey("bob");
      const eveKeyId = await vault.generateKey("eve");

      const alicePubKey = await vault.getPublicKey(aliceKeyId);
      const bobPubKey = await vault.getPublicKey(bobKeyId);

      const plaintext = Buffer.from("Secret message");
      const ciphertext = await vault.encrypt(aliceKeyId, bobPubKey, plaintext);

      // Eve tries to decrypt (should fail)
      await expect(vault.decrypt(eveKeyId, alicePubKey, ciphertext)).rejects.toThrow();
    });

    it("should handle empty plaintext", async () => {
      const keyId = await vault.generateKey("test-key");
      const otherKeyId = await vault.generateKey("other-key");
      const otherPubKey = await vault.getPublicKey(otherKeyId);
      const selfPubKey = await vault.getPublicKey(keyId);

      const plaintext = Buffer.from("");
      const ciphertext = await vault.encrypt(keyId, otherPubKey, plaintext);
      const decrypted = await vault.decrypt(otherKeyId, selfPubKey, ciphertext);

      expect(decrypted.toString()).toBe("");
    });
  });

  describe("deriveSharedSecret()", () => {
    it("should derive symmetric shared secrets", async () => {
      const aliceKeyId = await vault.generateKey("alice");
      const bobKeyId = await vault.generateKey("bob");

      const alicePubKey = await vault.getPublicKey(aliceKeyId);
      const bobPubKey = await vault.getPublicKey(bobKeyId);

      // Alice derives shared secret with Bob
      const aliceSecret = await vault.deriveSharedSecret(aliceKeyId, bobPubKey);

      // Bob derives shared secret with Alice
      const bobSecret = await vault.deriveSharedSecret(bobKeyId, alicePubKey);

      // They should be the same (ECDH symmetry)
      expect(aliceSecret.toString("hex")).toBe(bobSecret.toString("hex"));
    });

    it("should return 32-byte secret", async () => {
      const keyId = await vault.generateKey("test");
      const otherKey = BSVCrypto.privateKeyFromRandom();
      const otherPubKey = otherKey.toPublicKey().toHex();

      const secret = await vault.deriveSharedSecret(keyId, otherPubKey);

      expect(secret.length).toBe(32);
    });

    it("should derive different secrets with different context", async () => {
      const keyId = await vault.generateKey("test");
      const otherKey = BSVCrypto.privateKeyFromRandom();
      const otherPubKey = otherKey.toPublicKey().toHex();

      const secret1 = await vault.deriveSharedSecret(keyId, otherPubKey, "context-1");
      const secret2 = await vault.deriveSharedSecret(keyId, otherPubKey, "context-2");

      expect(secret1.toString("hex")).not.toBe(secret2.toString("hex"));
    });
  });

  describe("signRequest()", () => {
    it("should return BRC-103 auth headers", async () => {
      const keyId = await vault.generateKey("identity");

      const headers = await vault.signRequest(keyId, {
        method: "POST",
        path: "/api/agent/run",
        body: { prompt: "hello" },
      });

      expect(headers).toHaveProperty("x-bsv-identity-key");
      expect(headers).toHaveProperty("x-bsv-signature");
      expect(headers).toHaveProperty("x-bsv-timestamp");
      expect(headers).toHaveProperty("x-bsv-nonce");

      // Identity key should match
      const publicKey = await vault.getPublicKey(keyId);
      expect(headers["x-bsv-identity-key"]).toBe(publicKey);

      // Signature should be hex
      expect(headers["x-bsv-signature"]).toMatch(/^[0-9a-fA-F]+$/);

      // Timestamp should be valid
      const timestamp = parseInt(headers["x-bsv-timestamp"]);
      expect(timestamp).toBeGreaterThan(Date.now() - 10000);
      expect(timestamp).toBeLessThanOrEqual(Date.now());

      // Nonce should be UUID
      expect(headers["x-bsv-nonce"]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it("should produce verifiable signatures", async () => {
      const keyId = await vault.generateKey("identity");
      const publicKey = await vault.getPublicKey(keyId);

      const params = {
        method: "GET",
        path: "/api/status",
      };

      const headers = await vault.signRequest(keyId, params);

      // Reconstruct the canonical request and verify
      const bodyHash = "";
      const canonicalRequest = `${params.method.toUpperCase()}\n${params.path}\n${headers["x-bsv-timestamp"]}\n${headers["x-bsv-nonce"]}\n${bodyHash}`;
      const messageHash = createHash("sha256").update(canonicalRequest).digest("hex");
      const signature = Buffer.from(headers["x-bsv-signature"], "hex");

      const isValid = await vault.verify(publicKey, messageHash, signature);
      expect(isValid).toBe(true);
    });
  });

  describe("lock() / unlock()", () => {
    it("should lock vault and block operations", async () => {
      const keyId = await vault.generateKey("test-key");

      vault.lock();

      expect(vault.isLocked()).toBe(true);
      await expect(vault.generateKey("new-key")).rejects.toThrow(VaultError);
      await expect(vault.getPublicKey(keyId)).rejects.toThrow(VaultError);
    });

    it("should unlock vault and allow operations", async () => {
      const keyId = await vault.generateKey("test-key");

      vault.lock();
      vault.unlock();

      expect(vault.isLocked()).toBe(false);
      const publicKey = await vault.getPublicKey(keyId);
      expect(publicKey).toBeDefined();
    });

    it("should throw VAULT_LOCKED error with correct code", async () => {
      vault.lock();

      try {
        await vault.generateKey("test");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(VaultError);
        expect((error as VaultError).code).toBe("VAULT_LOCKED");
        expect((error as VaultError).httpCode).toBe(403);
      }
    });
  });

  describe("auto-lock", () => {
    it("should auto-lock after configured timeout", async () => {
      vi.useFakeTimers();

      const autoLockVault = await SecureVault.create({
        autoLockMs: 5000, // 5 seconds
      });

      expect(autoLockVault.isLocked()).toBe(false);

      // Advance time past the auto-lock threshold
      vi.advanceTimersByTime(6000);

      expect(autoLockVault.isLocked()).toBe(true);
    });

    it("should reset auto-lock timer on activity", async () => {
      vi.useFakeTimers();

      const autoLockVault = await SecureVault.create({
        autoLockMs: 5000,
      });

      // Generate a key after 3 seconds
      vi.advanceTimersByTime(3000);
      await autoLockVault.generateKey("test");

      // Advance another 3 seconds (total 6, but only 3 since last activity)
      vi.advanceTimersByTime(3000);
      expect(autoLockVault.isLocked()).toBe(false);

      // Advance another 3 seconds (6 since last activity)
      vi.advanceTimersByTime(3000);
      expect(autoLockVault.isLocked()).toBe(true);
    });
  });

  describe("audit logging", () => {
    it("should log all operations", async () => {
      const keyId = await vault.generateKey("test-key");
      await vault.getPublicKey(keyId);
      await vault.listKeys();

      const log = vault.getAuditLog();

      expect(log.length).toBeGreaterThanOrEqual(3);

      const operations = log.map((e) => e.operation);
      expect(operations).toContain("generate_key");
      expect(operations).toContain("get_public_key");
      expect(operations).toContain("list_keys");
    });

    it("should include key ID in log entries", async () => {
      const keyId = await vault.generateKey("test-key");
      const log = vault.getAuditLog();

      const generateEntry = log.find((e) => e.operation === "generate_key");
      expect(generateEntry?.keyId).toBe(keyId);
      expect(generateEntry?.keyLabel).toBe("test-key");
    });

    it("should log failures", async () => {
      try {
        await vault.getPublicKey("non-existent");
      } catch {
        // Expected
      }

      const log = vault.getAuditLog();
      const failedEntry = log.find((e) => !e.success);

      expect(failedEntry).toBeDefined();
      expect(failedEntry?.error).toBeDefined();
    });

    it("should NOT log key material", async () => {
      // Import a key
      const privateKey = BSVCrypto.privateKeyFromRandom();
      await vault.importKey("imported", privateKey.toHex());

      const log = vault.getAuditLog();

      // Check that no log entry contains the private key
      const privateKeyHex = privateKey.toHex();
      for (const entry of log) {
        expect(JSON.stringify(entry)).not.toContain(privateKeyHex);
      }
    });

    it("should respect maxAuditLogSize", async () => {
      const smallLogVault = await SecureVault.create({
        maxAuditLogSize: 5,
        autoLockMs: 0,
      });

      // Generate more keys than the log can hold
      for (let i = 0; i < 10; i++) {
        await smallLogVault.generateKey(`key-${i}`);
      }

      const log = smallLogVault.getAuditLog();
      expect(log.length).toBeLessThanOrEqual(5);
    });
  });

  describe("rate limiting", () => {
    it("should enforce rate limits", async () => {
      const rateLimitedVault = await SecureVault.create({
        maxOperationsPerMinute: 3,
        autoLockMs: 0,
      });

      const keyId = await rateLimitedVault.generateKey("test-key");
      const messageHash = createHash("sha256").update("test").digest("hex");

      // First 3 operations should succeed
      await rateLimitedVault.sign(keyId, messageHash);
      await rateLimitedVault.sign(keyId, messageHash);
      await rateLimitedVault.sign(keyId, messageHash);

      // 4th should fail
      await expect(rateLimitedVault.sign(keyId, messageHash)).rejects.toThrow(VaultError);
    });
  });

  describe("error handling", () => {
    it("should throw VaultError with correct codes", async () => {
      // KEY_NOT_FOUND
      try {
        await vault.getPublicKey("non-existent");
      } catch (error) {
        expect(error).toBeInstanceOf(VaultError);
        expect((error as VaultError).code).toBe("KEY_NOT_FOUND");
      }

      // INVALID_PUBLIC_KEY
      const keyId = await vault.generateKey("test");
      try {
        await vault.deriveChildKey(keyId, "bad-key", {
          protocolID: [2, "test"],
          keyID: "test",
        });
      } catch (error) {
        expect(error).toBeInstanceOf(VaultError);
        expect((error as VaultError).code).toBe("INVALID_PUBLIC_KEY");
      }

      // INVALID_MESSAGE_HASH
      try {
        await vault.sign(keyId, "not-a-hash");
      } catch (error) {
        expect(error).toBeInstanceOf(VaultError);
        expect((error as VaultError).code).toBe("INVALID_MESSAGE_HASH");
      }
    });
  });
});
