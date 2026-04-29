/**
 * KeyVault Tests
 *
 * Tests for the TTL-based ephemeral key storage.
 * Verifies:
 * - Reference-based key access
 * - TTL expiration
 * - Secure wiping
 * - Usage tracking
 */

import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BSVCrypto } from "../bsv-sdk-wrapper.js";
import { KeyVault, KeyVaultError } from "../key-vault.js";

describe("KeyVault", () => {
  let vault: KeyVault;

  beforeEach(() => {
    vi.useFakeTimers();
    vault = new KeyVault();
  });

  afterEach(() => {
    vault.seal();
    vi.useRealTimers();
  });

  describe("store()", () => {
    it("should store a key and return a reference ID", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const refId = vault.store(privateKey);

      expect(refId).toBeDefined();
      expect(refId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it("should accept custom TTL", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const refId = vault.store(privateKey, 60000); // 1 minute

      expect(refId).toBeDefined();
      expect(vault.has(refId)).toBe(true);
    });

    it("should reject TTL below minimum", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();

      expect(() => vault.store(privateKey, 1000)).toThrow(KeyVaultError);
      expect(() => vault.store(privateKey, 1000)).toThrow("TTL must be between");
    });

    it("should reject TTL above maximum", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();

      expect(() => vault.store(privateKey, 10 * 60 * 60 * 1000)).toThrow(KeyVaultError);
    });
  });

  describe("storeFromHex()", () => {
    it("should store a key from hex string", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const refId = vault.storeFromHex(privateKey.toHex());

      expect(refId).toBeDefined();
      expect(vault.has(refId)).toBe(true);
    });

    it("should reject invalid hex", () => {
      expect(() => vault.storeFromHex("not-hex")).toThrow(KeyVaultError);
      expect(() => vault.storeFromHex("not-hex")).toThrow("Invalid private key format");
    });
  });

  describe("getPublicKey()", () => {
    it("should return the public key for a stored key", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const expectedPublicKey = privateKey.toPublicKey();
      const refId = vault.store(privateKey);

      const publicKey = vault.getPublicKey(refId);

      expect(publicKey.toHex()).toBe(expectedPublicKey.toHex());
    });

    it("should throw for non-existent key", () => {
      expect(() => vault.getPublicKey("00000000-0000-0000-0000-000000000000")).toThrow(
        KeyVaultError,
      );
    });
  });

  describe("sign()", () => {
    it("should sign a message hash using the stored key", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const refId = vault.store(privateKey);

      const message = "Hello, world!";
      const messageHash = Buffer.from(createHash("sha256").update(message).digest());

      const signature = vault.sign(refId, messageHash);

      expect(signature).toBeInstanceOf(Buffer);
      expect(signature.length).toBeGreaterThan(0);
    });

    it("should produce deterministic signatures", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const refId = vault.store(privateKey);
      const messageHash = Buffer.from(createHash("sha256").update("test").digest());

      const sig1 = vault.sign(refId, messageHash);
      const sig2 = vault.sign(refId, messageHash);

      expect(sig1.toString("hex")).toBe(sig2.toString("hex"));
    });

    it("should reject invalid message hash length", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const refId = vault.store(privateKey);

      expect(() => vault.sign(refId, Buffer.from("short"))).toThrow(KeyVaultError);
      expect(() => vault.sign(refId, Buffer.from("short"))).toThrow("must be 32 bytes");
    });

    it("should track usage count", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const refId = vault.store(privateKey);
      const messageHash = Buffer.from(createHash("sha256").update("test").digest());

      vault.sign(refId, messageHash);
      vault.sign(refId, messageHash);
      vault.sign(refId, messageHash);

      const stats = vault.stats();
      expect(stats.keyCount).toBe(1);
    });
  });

  describe("TTL Expiration", () => {
    it("should expire keys after TTL", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const refId = vault.store(privateKey, 10000); // 10 seconds

      expect(vault.has(refId)).toBe(true);

      // Advance time past TTL
      vi.advanceTimersByTime(11000);

      expect(vault.has(refId)).toBe(false);
    });

    it("should track expired keys in stats", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      vault.store(privateKey, 10000);

      vi.advanceTimersByTime(11000);

      const stats = vault.stats();
      expect(stats.totalKeysExpired).toBe(1);
      expect(stats.keyCount).toBe(0);
    });

    it("should throw when accessing expired key", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const refId = vault.store(privateKey, 10000);
      const messageHash = Buffer.from(createHash("sha256").update("test").digest());

      vi.advanceTimersByTime(11000);

      expect(() => vault.sign(refId, messageHash)).toThrow(KeyVaultError);
      expect(() => vault.sign(refId, messageHash)).toThrow(/not found|expired/i);
    });
  });

  describe("wipe()", () => {
    it("should wipe a key from the vault", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const refId = vault.store(privateKey);

      expect(vault.has(refId)).toBe(true);

      vault.wipe(refId);

      expect(vault.has(refId)).toBe(false);
    });

    it("should throw for non-existent key", () => {
      expect(() => vault.wipe("00000000-0000-0000-0000-000000000000")).toThrow(KeyVaultError);
    });

    it("should track wiped keys in stats", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const refId = vault.store(privateKey);

      vault.wipe(refId);

      const stats = vault.stats();
      expect(stats.totalKeysWiped).toBe(1);
    });
  });

  describe("wipeAll()", () => {
    it("should wipe all keys from the vault", () => {
      vault.store(BSVCrypto.privateKeyFromRandom());
      vault.store(BSVCrypto.privateKeyFromRandom());
      vault.store(BSVCrypto.privateKeyFromRandom());

      expect(vault.stats().keyCount).toBe(3);

      vault.wipeAll();

      expect(vault.stats().keyCount).toBe(0);
    });
  });

  describe("extendTtl()", () => {
    it("should extend the TTL of a key", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const refId = vault.store(privateKey, 10000); // 10 seconds

      // Advance 5 seconds
      vi.advanceTimersByTime(5000);

      // Extend by 10 seconds
      vault.extendTtl(refId, 10000);

      // Advance another 10 seconds (15 total, should still exist)
      vi.advanceTimersByTime(10000);

      expect(vault.has(refId)).toBe(true);

      // Advance another 6 seconds (should expire now)
      vi.advanceTimersByTime(6000);

      expect(vault.has(refId)).toBe(false);
    });

    it("should reject extension that exceeds maximum TTL", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const refId = vault.store(privateKey, 30 * 60 * 1000); // 30 minutes

      // Try to extend by another 45 minutes (would exceed 1 hour max)
      expect(() => vault.extendTtl(refId, 45 * 60 * 1000)).toThrow(KeyVaultError);
    });
  });

  describe("seal()", () => {
    it("should seal the vault and prevent operations", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const refId = vault.store(privateKey);

      vault.seal();

      expect(vault.isSealed()).toBe(true);
      expect(() => vault.store(BSVCrypto.privateKeyFromRandom())).toThrow(KeyVaultError);
      expect(() => vault.sign(refId, Buffer.alloc(32))).toThrow(KeyVaultError);
    });

    it("should wipe all keys when sealing", () => {
      vault.store(BSVCrypto.privateKeyFromRandom());
      vault.store(BSVCrypto.privateKeyFromRandom());

      vault.seal();

      expect(vault.stats().keyCount).toBe(0);
    });
  });

  describe("stats()", () => {
    it("should return accurate statistics", () => {
      vault.store(BSVCrypto.privateKeyFromRandom());
      vault.store(BSVCrypto.privateKeyFromRandom());

      const stats = vault.stats();

      expect(stats.keyCount).toBe(2);
      expect(stats.totalKeysStored).toBe(2);
      expect(stats.oldestKeyTimestamp).toBeDefined();
      expect(stats.newestKeyTimestamp).toBeDefined();
    });

    it("should NOT include key material", () => {
      const privateKey = BSVCrypto.privateKeyFromRandom();
      vault.store(privateKey);

      const stats = vault.stats();
      const statsStr = JSON.stringify(stats);

      expect(statsStr).not.toContain(privateKey.toHex());
      expect(statsStr).not.toContain("privateKey");
      expect(statsStr).not.toContain("keyBuffer");
    });
  });

  describe("encrypt() / decrypt()", () => {
    it("should encrypt and decrypt data", () => {
      const aliceKey = BSVCrypto.privateKeyFromRandom();
      const bobKey = BSVCrypto.privateKeyFromRandom();

      const aliceRefId = vault.store(aliceKey);
      const bobRefId = vault.store(bobKey);

      const alicePubKey = vault.getPublicKey(aliceRefId);
      const bobPubKey = vault.getPublicKey(bobRefId);

      const plaintext = Buffer.from("Secret message");

      // Alice encrypts for Bob
      const ciphertext = vault.encrypt(aliceRefId, plaintext, bobPubKey);

      // Bob decrypts from Alice
      const decrypted = vault.decrypt(bobRefId, ciphertext, alicePubKey);

      expect(decrypted.toString()).toBe(plaintext.toString());
    });
  });

  describe("deriveChildKey()", () => {
    it("should derive a child key and return new reference", () => {
      const parentKey = BSVCrypto.privateKeyFromRandom();
      const counterpartyKey = BSVCrypto.privateKeyFromRandom();

      const parentRefId = vault.store(parentKey);
      const counterpartyPubKey = counterpartyKey.toPublicKey();

      const childRefId = vault.deriveChildKey(parentRefId, counterpartyPubKey, "2 test test-key");

      expect(childRefId).toBeDefined();
      expect(childRefId).not.toBe(parentRefId);
      expect(vault.has(childRefId)).toBe(true);

      // Child should have different public key
      const parentPubKey = vault.getPublicKey(parentRefId);
      const childPubKey = vault.getPublicKey(childRefId);
      expect(childPubKey.toHex()).not.toBe(parentPubKey.toHex());
    });

    it("should derive deterministic keys", () => {
      const parentKey = BSVCrypto.privateKeyFromRandom();
      const counterpartyKey = BSVCrypto.privateKeyFromRandom();

      const parentRefId = vault.store(parentKey);
      const counterpartyPubKey = counterpartyKey.toPublicKey();

      const childRefId1 = vault.deriveChildKey(parentRefId, counterpartyPubKey, "2 test test-key");
      const childRefId2 = vault.deriveChildKey(parentRefId, counterpartyPubKey, "2 test test-key");

      // Different refs but same derived public key
      const childPubKey1 = vault.getPublicKey(childRefId1);
      const childPubKey2 = vault.getPublicKey(childRefId2);

      expect(childPubKey1.toHex()).toBe(childPubKey2.toHex());
    });
  });
});
