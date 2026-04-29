/**
 * ECIES Encryption Tests (BRC-78)
 *
 * Tests the ECIES encryption implementation for:
 * - Encryption/decryption roundtrip
 * - BRC-78 serialization format
 * - Security constraints
 * - Cross-party encryption
 * - Error handling
 */

import { randomBytes } from "node:crypto";
import { describe, it, expect, beforeEach } from "vitest";
import { BSVCrypto, SecurePrivateKey, SecurePublicKey } from "../bsv-sdk-wrapper.js";
import {
  encrypt,
  decrypt,
  serializeCiphertext,
  deserializeCiphertext,
  ECIES,
  ECIESError,
  BRC78_VERSION,
  type ECIESCiphertext,
} from "../ecies.js";

describe("ECIES Encryption (BRC-78)", () => {
  // Test keys
  let alicePrivateKey: SecurePrivateKey;
  let alicePublicKey: SecurePublicKey;
  let bobPrivateKey: SecurePrivateKey;
  let bobPublicKey: SecurePublicKey;
  let evePrivateKey: SecurePrivateKey;
  let evePublicKey: SecurePublicKey;

  beforeEach(() => {
    // Use deterministic keys for reproducible tests
    alicePrivateKey = BSVCrypto.privateKeyFromHex(
      "6a1751169c111b4667a6539ee1be6b7cd9f6e9c8fe011a5f2fe31e03a15e0ede",
    );
    alicePublicKey = alicePrivateKey.toPublicKey();

    bobPrivateKey = BSVCrypto.privateKeyFromHex(
      "cab2500e206f31bc18a8af9d6f44f0b9a208c32d5cca2b22acfe9d1a213b2f36",
    );
    bobPublicKey = bobPrivateKey.toPublicKey();

    evePrivateKey = BSVCrypto.privateKeyFromHex(
      "7a66d0896f2c4c2c9ac55670c71a9bc1bdbdfb4e8786ee5137cea1d0a05b6f20",
    );
    evePublicKey = evePrivateKey.toPublicKey();
  });

  describe("encrypt()", () => {
    it("should encrypt plaintext and return valid ciphertext structure", () => {
      const plaintext = Buffer.from("Hello, Bob!");

      const ciphertext = encrypt(plaintext, alicePrivateKey, bobPublicKey);

      expect(ciphertext.version).toBe(BRC78_VERSION);
      expect(ciphertext.senderPublicKey).toBe(alicePublicKey.toHex());
      expect(ciphertext.recipientPublicKey).toBe(bobPublicKey.toHex());
      expect(ciphertext.keyID).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(Buffer.isBuffer(ciphertext.ciphertext)).toBe(true);
    });

    it("should use random IV for each encryption", () => {
      const plaintext = Buffer.from("Same message");

      const ciphertext1 = encrypt(plaintext, alicePrivateKey, bobPublicKey);
      const ciphertext2 = encrypt(plaintext, alicePrivateKey, bobPublicKey);

      // IV is in the first 12 bytes of ciphertext
      const iv1 = ciphertext1.ciphertext.subarray(0, 12);
      const iv2 = ciphertext2.ciphertext.subarray(0, 12);

      expect(iv1.toString("hex")).not.toBe(iv2.toString("hex"));
    });

    it("should use random keyID for each encryption", () => {
      const plaintext = Buffer.from("Same message");

      const ciphertext1 = encrypt(plaintext, alicePrivateKey, bobPublicKey);
      const ciphertext2 = encrypt(plaintext, alicePrivateKey, bobPublicKey);

      expect(ciphertext1.keyID).not.toBe(ciphertext2.keyID);
    });

    it("should set correct version (0x42421033)", () => {
      const plaintext = Buffer.from("Test");
      const ciphertext = encrypt(plaintext, alicePrivateKey, bobPublicKey);

      expect(ciphertext.version).toBe(0x42421033);
    });

    it("should include sender and recipient public keys", () => {
      const plaintext = Buffer.from("Test");
      const ciphertext = encrypt(plaintext, alicePrivateKey, bobPublicKey);

      // Validate public key format
      expect(ciphertext.senderPublicKey).toMatch(/^0[23][0-9a-f]{64}$/i);
      expect(ciphertext.recipientPublicKey).toMatch(/^0[23][0-9a-f]{64}$/i);
    });

    it("should handle empty plaintext", () => {
      const plaintext = Buffer.alloc(0);

      const ciphertext = encrypt(plaintext, alicePrivateKey, bobPublicKey);
      const decrypted = decrypt(ciphertext, bobPrivateKey, alicePublicKey);

      expect(decrypted.toString()).toBe("");
    });

    it("should handle binary data with null bytes", () => {
      const plaintext = Buffer.from([0x00, 0x01, 0x00, 0xff, 0x00]);

      const ciphertext = encrypt(plaintext, alicePrivateKey, bobPublicKey);
      const decrypted = decrypt(ciphertext, bobPrivateKey, alicePublicKey);

      expect(decrypted.equals(plaintext)).toBe(true);
    });
  });

  describe("decrypt()", () => {
    it("should decrypt ciphertext back to original plaintext", () => {
      const plaintext = Buffer.from("Hello, Bob! This is a secret message.");

      const ciphertext = encrypt(plaintext, alicePrivateKey, bobPublicKey);
      const decrypted = decrypt(ciphertext, bobPrivateKey, alicePublicKey);

      expect(decrypted.toString()).toBe(plaintext.toString());
    });

    it("should reject tampered ciphertext", () => {
      const plaintext = Buffer.from("Original message");
      const ciphertext = encrypt(plaintext, alicePrivateKey, bobPublicKey);

      // Tamper with the ciphertext
      const tamperedCiphertext = { ...ciphertext };
      tamperedCiphertext.ciphertext = Buffer.concat([
        ciphertext.ciphertext.subarray(0, -1),
        Buffer.from([ciphertext.ciphertext[ciphertext.ciphertext.length - 1] ^ 0xff]),
      ]);

      try {
        decrypt(tamperedCiphertext, bobPrivateKey, alicePublicKey);
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ECIESError);
        expect((e as ECIESError).code).toBe("DECRYPTION_FAILED");
      }
    });

    it("should reject wrong sender public key", () => {
      const plaintext = Buffer.from("Secret");
      const ciphertext = encrypt(plaintext, alicePrivateKey, bobPublicKey);

      // Try to decrypt with Eve's public key as sender
      expect(() => decrypt(ciphertext, bobPrivateKey, evePublicKey)).toThrow(ECIESError);
    });

    it("should reject wrong recipient private key", () => {
      const plaintext = Buffer.from("Secret");
      const ciphertext = encrypt(plaintext, alicePrivateKey, bobPublicKey);

      // Try to decrypt with Eve's private key
      expect(() => decrypt(ciphertext, evePrivateKey, alicePublicKey)).toThrow(ECIESError);
    });

    it("should reject invalid version", () => {
      const plaintext = Buffer.from("Test");
      const ciphertext = encrypt(plaintext, alicePrivateKey, bobPublicKey);

      const invalidCiphertext = { ...ciphertext, version: 0x12345678 };

      try {
        decrypt(invalidCiphertext, bobPrivateKey, alicePublicKey);
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ECIESError);
        expect((e as ECIESError).code).toBe("INVALID_VERSION");
      }
    });

    it("should reject truncated ciphertext", () => {
      const plaintext = Buffer.from("Test message");
      const ciphertext = encrypt(plaintext, alicePrivateKey, bobPublicKey);

      // Truncate to just 10 bytes (too short)
      const truncatedCiphertext = {
        ...ciphertext,
        ciphertext: ciphertext.ciphertext.subarray(0, 10),
      };

      expect(() => decrypt(truncatedCiphertext, bobPrivateKey, alicePublicKey)).toThrow(ECIESError);
      expect(() => decrypt(truncatedCiphertext, bobPrivateKey, alicePublicKey)).toThrow(
        "too short",
      );
    });

    it("should handle large plaintext (1MB)", () => {
      const plaintext = randomBytes(1024 * 1024); // 1MB

      const ciphertext = encrypt(plaintext, alicePrivateKey, bobPublicKey);
      const decrypted = decrypt(ciphertext, bobPrivateKey, alicePublicKey);

      expect(decrypted.equals(plaintext)).toBe(true);
    });
  });

  describe("serializeCiphertext() / deserializeCiphertext()", () => {
    it("should round-trip serialize and deserialize", () => {
      const plaintext = Buffer.from("Round trip test");
      const original = encrypt(plaintext, alicePrivateKey, bobPublicKey);

      const serialized = serializeCiphertext(original);
      const deserialized = deserializeCiphertext(serialized);

      expect(deserialized.version).toBe(original.version);
      expect(deserialized.senderPublicKey).toBe(original.senderPublicKey);
      expect(deserialized.recipientPublicKey).toBe(original.recipientPublicKey);
      expect(deserialized.keyID).toBe(original.keyID);
      expect(deserialized.ciphertext.equals(original.ciphertext)).toBe(true);
    });

    it("should produce BRC-78 compliant byte format", () => {
      const plaintext = Buffer.from("Format test");
      const ciphertext = encrypt(plaintext, alicePrivateKey, bobPublicKey);

      const serialized = serializeCiphertext(ciphertext);

      // Check header layout
      // Version: 4 bytes
      const version = serialized.readUInt32BE(0);
      expect(version).toBe(BRC78_VERSION);

      // Sender public key: 33 bytes at offset 4
      const senderPubKey = serialized.subarray(4, 37).toString("hex");
      expect(senderPubKey).toBe(ciphertext.senderPublicKey);

      // Recipient public key: 33 bytes at offset 37
      const recipientPubKey = serialized.subarray(37, 70).toString("hex");
      expect(recipientPubKey).toBe(ciphertext.recipientPublicKey);

      // Key ID: 32 bytes at offset 70
      const keyID = serialized.subarray(70, 102).toString("hex");
      expect(keyID).toBe(ciphertext.keyID);

      // Rest is ciphertext (IV + encrypted + auth tag)
      const ciphertextPayload = serialized.subarray(102);
      expect(ciphertextPayload.equals(ciphertext.ciphertext)).toBe(true);
    });

    it("should reject data that is too short", () => {
      const shortData = Buffer.alloc(50); // Header is 102 bytes minimum

      expect(() => deserializeCiphertext(shortData)).toThrow(ECIESError);
      expect(() => deserializeCiphertext(shortData)).toThrow("too short");
    });

    it("should reject invalid version in serialized data", () => {
      const badVersionData = Buffer.alloc(150);
      badVersionData.writeUInt32BE(0xdeadbeef, 0);

      try {
        deserializeCiphertext(badVersionData);
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ECIESError);
        expect((e as ECIESError).code).toBe("INVALID_VERSION");
      }
    });
  });

  describe("ECIES class", () => {
    let alice: ECIES;
    let bob: ECIES;
    let eve: ECIES;

    beforeEach(() => {
      alice = new ECIES(alicePrivateKey);
      bob = new ECIES(bobPrivateKey);
      eve = new ECIES(evePrivateKey);
    });

    it("should provide stateful encryption/decryption", () => {
      const message = Buffer.from("Hello from ECIES class!");

      const encrypted = alice.encrypt(message, bob.getPublicKey());
      const decrypted = bob.decrypt(encrypted, alice.getPublicKey());

      expect(decrypted.toString()).toBe(message.toString());
    });

    it("should handle string public keys", () => {
      const message = Buffer.from("String pubkey test");

      const encrypted = alice.encrypt(message, bob.getPublicKeyHex());
      const decrypted = bob.decrypt(encrypted, alice.getPublicKeyHex());

      expect(decrypted.toString()).toBe(message.toString());
    });

    it("should maintain consistent identity", () => {
      expect(alice.getPublicKeyHex()).toBe(alicePublicKey.toHex());
      expect(bob.getPublicKeyHex()).toBe(bobPublicKey.toHex());
    });

    it("should create from hex", () => {
      const fromHex = ECIES.fromHex(
        "6a1751169c111b4667a6539ee1be6b7cd9f6e9c8fe011a5f2fe31e03a15e0ede",
      );
      expect(fromHex.getPublicKeyHex()).toBe(alicePublicKey.toHex());
    });

    it("should create from random", () => {
      const random1 = ECIES.fromRandom();
      const random2 = ECIES.fromRandom();

      expect(random1.getPublicKeyHex()).not.toBe(random2.getPublicKeyHex());
    });

    it("should validate sender in ciphertext", () => {
      const message = Buffer.from("Validate sender");
      const encrypted = alice.encrypt(message, bob.getPublicKey());

      // Try to decrypt claiming Eve is the sender
      try {
        bob.decrypt(encrypted, eve.getPublicKey());
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ECIESError);
        expect((e as ECIESError).code).toBe("INVALID_SENDER");
      }
    });

    it("should validate recipient in ciphertext", () => {
      const message = Buffer.from("Validate recipient");
      const encrypted = alice.encrypt(message, bob.getPublicKey());

      // Eve tries to decrypt message meant for Bob
      try {
        eve.decrypt(encrypted, alice.getPublicKey());
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ECIESError);
        expect((e as ECIESError).code).toBe("INVALID_RECIPIENT");
      }
    });
  });

  describe("String encryption helpers", () => {
    let alice: ECIES;
    let bob: ECIES;

    beforeEach(() => {
      alice = new ECIES(alicePrivateKey);
      bob = new ECIES(bobPrivateKey);
    });

    it("should encrypt and decrypt strings", () => {
      const message = "Hello, string encryption!";

      const encrypted = alice.encryptString(message, bob.getPublicKey());
      const decrypted = bob.decryptString(encrypted, alice.getPublicKey());

      expect(decrypted).toBe(message);
    });

    it("should handle Unicode strings", () => {
      const message = "Hello 世界! 🌍 Привет мир!";

      const encrypted = alice.encryptString(message, bob.getPublicKey());
      const decrypted = bob.decryptString(encrypted, alice.getPublicKey());

      expect(decrypted).toBe(message);
    });

    it("should return hex-encoded ciphertext", () => {
      const message = "Hex check";
      const encrypted = alice.encryptString(message, bob.getPublicKey());

      // Should be valid hex
      expect(encrypted).toMatch(/^[0-9a-f]+$/i);
    });
  });

  describe("Cross-party encryption", () => {
    it("should allow Alice to encrypt for Bob", () => {
      const message = Buffer.from("Secret for Bob");

      const ciphertext = encrypt(message, alicePrivateKey, bobPublicKey);

      expect(ciphertext.senderPublicKey).toBe(alicePublicKey.toHex());
      expect(ciphertext.recipientPublicKey).toBe(bobPublicKey.toHex());
    });

    it("should allow Bob to decrypt message from Alice", () => {
      const message = Buffer.from("Secret from Alice");

      const ciphertext = encrypt(message, alicePrivateKey, bobPublicKey);
      const decrypted = decrypt(ciphertext, bobPrivateKey, alicePublicKey);

      expect(decrypted.toString()).toBe(message.toString());
    });

    it("should prevent Eve from decrypting message", () => {
      const message = Buffer.from("Private message");
      const ciphertext = encrypt(message, alicePrivateKey, bobPublicKey);

      // Eve can't decrypt with her private key
      expect(() => decrypt(ciphertext, evePrivateKey, alicePublicKey)).toThrow();
    });

    it("should work bidirectionally (Alice→Bob, Bob→Alice)", () => {
      const messageFromAlice = Buffer.from("Hello Bob!");
      const messageFromBob = Buffer.from("Hello Alice!");

      // Alice → Bob
      const ciphertext1 = encrypt(messageFromAlice, alicePrivateKey, bobPublicKey);
      const decrypted1 = decrypt(ciphertext1, bobPrivateKey, alicePublicKey);
      expect(decrypted1.toString()).toBe(messageFromAlice.toString());

      // Bob → Alice
      const ciphertext2 = encrypt(messageFromBob, bobPrivateKey, alicePublicKey);
      const decrypted2 = decrypt(ciphertext2, alicePrivateKey, bobPublicKey);
      expect(decrypted2.toString()).toBe(messageFromBob.toString());
    });
  });

  describe("Edge cases", () => {
    it("should handle message with just null bytes", () => {
      const plaintext = Buffer.alloc(100, 0x00);

      const ciphertext = encrypt(plaintext, alicePrivateKey, bobPublicKey);
      const decrypted = decrypt(ciphertext, bobPrivateKey, alicePublicKey);

      expect(decrypted.equals(plaintext)).toBe(true);
    });

    it("should handle message with all 0xff bytes", () => {
      const plaintext = Buffer.alloc(100, 0xff);

      const ciphertext = encrypt(plaintext, alicePrivateKey, bobPublicKey);
      const decrypted = decrypt(ciphertext, bobPrivateKey, alicePublicKey);

      expect(decrypted.equals(plaintext)).toBe(true);
    });

    it("should handle very short messages (1 byte)", () => {
      const plaintext = Buffer.from([0x42]);

      const ciphertext = encrypt(plaintext, alicePrivateKey, bobPublicKey);
      const decrypted = decrypt(ciphertext, bobPrivateKey, alicePublicKey);

      expect(decrypted.equals(plaintext)).toBe(true);
    });
  });

  describe("Deterministic encryption (same inputs different outputs)", () => {
    it("should produce different ciphertexts for same message", () => {
      const plaintext = Buffer.from("Same message every time");

      const ciphertext1 = serializeCiphertext(encrypt(plaintext, alicePrivateKey, bobPublicKey));
      const ciphertext2 = serializeCiphertext(encrypt(plaintext, alicePrivateKey, bobPublicKey));

      // Must be different due to random IV and keyID
      expect(ciphertext1.equals(ciphertext2)).toBe(false);
    });

    it("should still decrypt to same plaintext", () => {
      const plaintext = Buffer.from("Consistent decryption");

      const ciphertext1 = encrypt(plaintext, alicePrivateKey, bobPublicKey);
      const ciphertext2 = encrypt(plaintext, alicePrivateKey, bobPublicKey);

      const decrypted1 = decrypt(ciphertext1, bobPrivateKey, alicePublicKey);
      const decrypted2 = decrypt(ciphertext2, bobPrivateKey, alicePublicKey);

      expect(decrypted1.toString()).toBe(plaintext.toString());
      expect(decrypted2.toString()).toBe(plaintext.toString());
    });
  });

  describe("Error codes and HTTP codes", () => {
    it("should include error code in ECIESError", () => {
      try {
        const badCiphertext: ECIESCiphertext = {
          version: 0xbad00000,
          senderPublicKey: alicePublicKey.toHex(),
          recipientPublicKey: bobPublicKey.toHex(),
          keyID: "0".repeat(64),
          ciphertext: Buffer.alloc(50),
        };
        decrypt(badCiphertext, bobPrivateKey, alicePublicKey);
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ECIESError);
        expect((e as ECIESError).code).toBe("INVALID_VERSION");
        expect((e as ECIESError).httpCode).toBe(400);
      }
    });

    it("should use correct HTTP codes for different errors", () => {
      // INVALID_CIPHERTEXT -> 400
      try {
        deserializeCiphertext(Buffer.alloc(10));
        expect.fail("Should have thrown");
      } catch (e) {
        expect((e as ECIESError).code).toBe("INVALID_CIPHERTEXT");
        expect((e as ECIESError).httpCode).toBe(400);
      }
    });
  });
});
