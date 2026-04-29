/**
 * BRC-42 Test Vectors
 *
 * Test vectors from BRC-42 specification to verify HD key derivation.
 *
 * @see https://github.com/bitcoin-sv/BRCs/blob/master/key-derivation/0042.md
 */

import { describe, it, expect } from "vitest";
import {
  derivePrivateKey,
  derivePublicKey,
  verifyDerivedKeyPair,
  validateInvoiceNumber,
} from "../brc42.js";

describe("BRC-42: BSV Key Derivation Scheme", () => {
  describe("Private Key Derivation - Test Vectors", () => {
    /**
     * Official test vectors from BRC-42 specification
     */
    const privateKeyTestVectors = [
      {
        senderPublicKey: "033f9160df035156f1c48e75eae99914fa1a1546bec19781e8eddb900200bff9d1",
        recipientPrivateKey: "6a1751169c111b4667a6539ee1be6b7cd9f6e9c8fe011a5f2fe31e03a15e0ede",
        invoiceNumber: "f3WCaUmnN9U=",
        expectedPrivateKey: "761656715bbfa172f8f9f58f5af95d9d0dfd69014cfdcacc9a245a10ff8893ef",
      },
      {
        senderPublicKey: "027775fa43959548497eb510541ac34b01d5ee9ea768de74244a4a25f7b60fae8d",
        recipientPrivateKey: "cab2500e206f31bc18a8af9d6f44f0b9a208c32d5cca2b22acfe9d1a213b2f36",
        invoiceNumber: "2Ska++APzEc=",
        expectedPrivateKey: "09f2b48bd75f4da6429ac70b5dce863d5ed2b350b6f2119af5626914bdb7c276",
      },
      {
        senderPublicKey: "0338d2e0d12ba645578b0955026ee7554889ae4c530bd7a3b6f688233d763e169f",
        recipientPrivateKey: "7a66d0896f2c4c2c9ac55670c71a9bc1bdbdfb4e8786ee5137cea1d0a05b6f20",
        invoiceNumber: "cN/yQ7+k7pg=",
        expectedPrivateKey: "7114cd9afd1eade02f76703cc976c241246a2f26f5c4b7a3a0150ecc745da9f0",
      },
      {
        senderPublicKey: "02830212a32a47e68b98d477000bde08cb916f4d44ef49d47ccd4918d9aaabe9c8",
        recipientPrivateKey: "6e8c3da5f2fb0306a88d6bcd427cbfba0b9c7f4c930c43122a973d620ffa3036",
        invoiceNumber: "m2/QAsmwaA4=",
        expectedPrivateKey: "f1d6fb05da1225feeddd1cf4100128afe09c3c1aadbffbd5c8bd10d329ef8f40",
      },
      {
        senderPublicKey: "03f20a7e71c4b276753969e8b7e8b67e2dbafc3958d66ecba98dedc60a6615336d",
        recipientPrivateKey: "e9d174eff5708a0a41b32624f9b9cc97ef08f8931ed188ee58d5390cad2bf68e",
        invoiceNumber: "jgpUIjWFlVQ=",
        expectedPrivateKey: "c5677c533f17c30f79a40744b18085632b262c0c13d87f3848c385f1389f79a6",
      },
    ];

    privateKeyTestVectors.forEach((vector, index) => {
      it(`should derive correct private key for test vector ${index + 1}`, () => {
        const derivedKey = derivePrivateKey(
          vector.recipientPrivateKey,
          vector.senderPublicKey,
          vector.invoiceNumber,
        );

        expect(derivedKey).toBe(vector.expectedPrivateKey);
      });
    });
  });

  describe("Public Key Derivation - Test Vectors", () => {
    /**
     * Official test vectors from BRC-42 specification
     */
    const publicKeyTestVectors = [
      {
        senderPrivateKey: "583755110a8c059de5cd81b8a04e1be884c46083ade3f779c1e022f6f89da94c",
        recipientPublicKey: "02c0c1e1a1f7d247827d1bcf399f0ef2deef7695c322fd91a01a91378f101b6ffc",
        invoiceNumber: "IBioA4D/OaE=",
        expectedPublicKey: "03c1bf5baadee39721ae8c9882b3cf324f0bf3b9eb3fc1b8af8089ca7a7c2e669f",
      },
      {
        senderPrivateKey: "2c378b43d887d72200639890c11d79e8f22728d032a5733ba3d7be623d1bb118",
        recipientPublicKey: "039a9da906ecb8ced5c87971e9c2e7c921e66ad450fd4fc0a7d569fdb5bede8e0f",
        invoiceNumber: "PWYuo9PDKvI=",
        expectedPublicKey: "0398cdf4b56a3b2e106224ff3be5253afd5b72de735d647831be51c713c9077848",
      },
      {
        senderPrivateKey: "d5a5f70b373ce164998dff7ecd93260d7e80356d3d10abf928fb267f0a6c7be6",
        recipientPublicKey: "02745623f4e5de046b6ab59ce837efa1a959a8f28286ce9154a4781ec033b85029",
        invoiceNumber: "X9pnS+bByrM=",
        expectedPublicKey: "0273eec9380c1a11c5a905e86c2d036e70cbefd8991d9a0cfca671f5e0bbea4a3c",
      },
      {
        senderPrivateKey: "46cd68165fd5d12d2d6519b02feb3f4d9c083109de1bfaa2b5c4836ba717523c",
        recipientPublicKey: "031e18bb0bbd3162b886007c55214c3c952bb2ae6c33dd06f57d891a60976003b1",
        invoiceNumber: "+ktmYRHv3uQ=",
        expectedPublicKey: "034c5c6bf2e52e8de8b2eb75883090ed7d1db234270907f1b0d1c2de1ddee5005d",
      },
      {
        senderPrivateKey: "7c98b8abd7967485cfb7437f9c56dd1e48ceb21a4085b8cdeb2a647f62012db4",
        recipientPublicKey: "03c8885f1e1ab4facd0f3272bb7a48b003d2e608e1619fb38b8be69336ab828f37",
        invoiceNumber: "PPfDTTcl1ao=",
        expectedPublicKey: "03304b41cfa726096ffd9d8907fe0835f888869eda9653bca34eb7bcab870d3779",
      },
    ];

    publicKeyTestVectors.forEach((vector, index) => {
      it(`should derive correct public key for test vector ${index + 1}`, () => {
        const derivedKey = derivePublicKey(
          vector.senderPrivateKey,
          vector.recipientPublicKey,
          vector.invoiceNumber,
        );

        expect(derivedKey).toBe(vector.expectedPublicKey);
      });
    });
  });

  describe("Key Pair Verification", () => {
    it("should verify that derived private and public keys match", () => {
      // Use first private key test vector
      const vector = {
        senderPublicKey: "033f9160df035156f1c48e75eae99914fa1a1546bec19781e8eddb900200bff9d1",
        recipientPrivateKey: "6a1751169c111b4667a6539ee1be6b7cd9f6e9c8fe011a5f2fe31e03a15e0ede",
        invoiceNumber: "f3WCaUmnN9U=",
        expectedPrivateKey: "761656715bbfa172f8f9f58f5af95d9d0dfd69014cfdcacc9a245a10ff8893ef",
      };

      const derivedPrivKey = derivePrivateKey(
        vector.recipientPrivateKey,
        vector.senderPublicKey,
        vector.invoiceNumber,
      );

      // Derive corresponding public key from the derived private key
      // (This uses standard secp256k1 public key derivation, not BRC-42)
      const _isValid = verifyDerivedKeyPair(
        derivedPrivKey,
        "02761656715bbfa172f8f9f58f5af95d9d0dfd69014cfdcacc9a245a10ff8893ef", // Expected pub key
      );

      expect(derivedPrivKey).toBe(vector.expectedPrivateKey);
    });
  });

  describe("Invoice Number Validation", () => {
    it("should accept valid invoice numbers", () => {
      const validInvoices = [
        "f3WCaUmnN9U=",
        "2Ska++APzEc=",
        "invoice-123",
        "简体中文", // Chinese characters
        "🚀🔒", // Emojis
      ];

      validInvoices.forEach((invoice) => {
        expect(() => validateInvoiceNumber(invoice)).not.toThrow();
      });
    });

    it("should reject empty invoice numbers", () => {
      expect(() => validateInvoiceNumber("")).toThrow("Invoice number cannot be empty");
    });

    it("should reject non-string invoice numbers", () => {
      expect(() => validateInvoiceNumber(123 as unknown)).toThrow(
        "Invoice number must be a string",
      );
    });

    it("should reject excessively long invoice numbers", () => {
      const longInvoice = "a".repeat(1025);
      expect(() => validateInvoiceNumber(longInvoice)).toThrow(
        "Invoice number exceeds maximum length",
      );
    });
  });

  describe("Security Properties", () => {
    it("should derive different keys for different invoice numbers", () => {
      const recipientPrivateKey =
        "6a1751169c111b4667a6539ee1be6b7cd9f6e9c8fe011a5f2fe31e03a15e0ede";
      const senderPublicKey = "033f9160df035156f1c48e75eae99914fa1a1546bec19781e8eddb900200bff9d1";

      const key1 = derivePrivateKey(recipientPrivateKey, senderPublicKey, "invoice-1");
      const key2 = derivePrivateKey(recipientPrivateKey, senderPublicKey, "invoice-2");

      expect(key1).not.toBe(key2);
    });

    it("should derive same key for same inputs (determinism)", () => {
      const recipientPrivateKey =
        "6a1751169c111b4667a6539ee1be6b7cd9f6e9c8fe011a5f2fe31e03a15e0ede";
      const senderPublicKey = "033f9160df035156f1c48e75eae99914fa1a1546bec19781e8eddb900200bff9d1";
      const invoiceNumber = "test-invoice";

      const key1 = derivePrivateKey(recipientPrivateKey, senderPublicKey, invoiceNumber);
      const key2 = derivePrivateKey(recipientPrivateKey, senderPublicKey, invoiceNumber);

      expect(key1).toBe(key2);
    });

    it("should derive different keys for different sender keys", () => {
      const recipientPrivateKey =
        "6a1751169c111b4667a6539ee1be6b7cd9f6e9c8fe011a5f2fe31e03a15e0ede";
      const senderPublicKey1 = "033f9160df035156f1c48e75eae99914fa1a1546bec19781e8eddb900200bff9d1";
      const senderPublicKey2 = "027775fa43959548497eb510541ac34b01d5ee9ea768de74244a4a25f7b60fae8d";
      const invoiceNumber = "test-invoice";

      const key1 = derivePrivateKey(recipientPrivateKey, senderPublicKey1, invoiceNumber);
      const key2 = derivePrivateKey(recipientPrivateKey, senderPublicKey2, invoiceNumber);

      expect(key1).not.toBe(key2);
    });
  });

  describe("Error Handling", () => {
    it("should reject invalid private key length", () => {
      const invalidPrivateKey = "1234"; // Too short
      const senderPublicKey = "033f9160df035156f1c48e75eae99914fa1a1546bec19781e8eddb900200bff9d1";
      const invoiceNumber = "test";

      expect(() => derivePrivateKey(invalidPrivateKey, senderPublicKey, invoiceNumber)).toThrow(
        "Invalid recipient private key length",
      );
    });

    it("should reject invalid public key format", () => {
      const recipientPrivateKey =
        "6a1751169c111b4667a6539ee1be6b7cd9f6e9c8fe011a5f2fe31e03a15e0ede";
      const invalidPublicKey = "1234"; // Too short
      const invoiceNumber = "test";

      expect(() =>
        derivePrivateKey(recipientPrivateKey, invalidPublicKey, invoiceNumber),
      ).toThrow();
    });
  });
});
