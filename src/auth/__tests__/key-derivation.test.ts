/**
 * BRC-42 Key Derivation Service Tests
 *
 * Tests the key derivation service for:
 * - Invoice number construction
 * - Child private key derivation
 * - Child public key derivation
 * - Security constraint enforcement
 * - Cross-verification with BSV SDK
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ProtocolID, KeyDerivationParams } from "../../types/bsv-auth.js";
import { BSVCrypto, SecurePrivateKey, SecurePublicKey } from "../../crypto/bsv-sdk-wrapper.js";
import {
  buildInvoiceNumber,
  deriveChildPrivateKey,
  deriveChildPublicKey,
  KeyDerivationService,
  KeyDerivationError,
  createProtocolID,
  StandardProtocols,
} from "../key-derivation.js";

describe("BRC-42 Key Derivation Service", () => {
  // Test keys
  let alicePrivateKey: SecurePrivateKey;
  let alicePublicKey: SecurePublicKey;
  let bobPrivateKey: SecurePrivateKey;
  let bobPublicKey: SecurePublicKey;

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
  });

  describe("buildInvoiceNumber()", () => {
    it("should construct valid invoice number from protocol ID and key ID", () => {
      const protocolID: ProtocolID = [2, "message encryption"];
      const keyID = "abc123";

      const invoice = buildInvoiceNumber(protocolID, keyID);

      expect(invoice).toBe("2 message encryption abc123");
    });

    it("should handle security level 1", () => {
      const protocolID: ProtocolID = [1, "public"];
      const keyID = "discovery";

      const invoice = buildInvoiceNumber(protocolID, keyID);

      expect(invoice).toBe("1 public discovery");
    });

    it("should handle security level 0", () => {
      const protocolID: ProtocolID = [0, "admin"];
      const keyID = "root";

      const invoice = buildInvoiceNumber(protocolID, keyID);

      expect(invoice).toBe("0 admin root");
    });

    it("should reject invalid security level", () => {
      const invalidProtocolID = [3, "test"] as ProtocolID;

      expect(() => buildInvoiceNumber(invalidProtocolID, "key")).toThrow(KeyDerivationError);
      expect(() => buildInvoiceNumber(invalidProtocolID, "key")).toThrow("Invalid security level");
    });

    it("should reject empty protocol ID string", () => {
      const emptyProtocol: ProtocolID = [2, ""];

      expect(() => buildInvoiceNumber(emptyProtocol, "key")).toThrow(KeyDerivationError);
      expect(() => buildInvoiceNumber(emptyProtocol, "key")).toThrow("non-empty string");
    });

    it("should reject empty key ID", () => {
      const protocolID: ProtocolID = [2, "test"];

      expect(() => buildInvoiceNumber(protocolID, "")).toThrow(KeyDerivationError);
      expect(() => buildInvoiceNumber(protocolID, "")).toThrow("non-empty string");
    });

    it("should reject whitespace-only key ID", () => {
      const protocolID: ProtocolID = [2, "test"];

      expect(() => buildInvoiceNumber(protocolID, "   ")).toThrow(KeyDerivationError);
    });

    it("should handle special characters in key ID", () => {
      const protocolID: ProtocolID = [2, "encryption"];
      const keyID = "key-with_special.chars+123=";

      const invoice = buildInvoiceNumber(protocolID, keyID);

      expect(invoice).toBe("2 encryption key-with_special.chars+123=");
    });

    it("should handle base64 key IDs (BRC-78 style)", () => {
      const protocolID: ProtocolID = [2, "message encryption"];
      const keyID = "f3WCaUmnN9U="; // Base64 encoded

      const invoice = buildInvoiceNumber(protocolID, keyID);

      expect(invoice).toBe("2 message encryption f3WCaUmnN9U=");
    });

    it("should reject invoice number exceeding maximum length", () => {
      const protocolID: ProtocolID = [2, "test"];
      const longKeyID = "a".repeat(1024); // Makes total > 1024

      expect(() => buildInvoiceNumber(protocolID, longKeyID)).toThrow(KeyDerivationError);
      expect(() => buildInvoiceNumber(protocolID, longKeyID)).toThrow("exceeds maximum length");
    });
  });

  describe("deriveChildPrivateKey()", () => {
    it("should derive deterministic private key", () => {
      const params: KeyDerivationParams = {
        protocolID: [2, "test"],
        keyID: "session-1",
      };

      const derived1 = deriveChildPrivateKey(alicePrivateKey, bobPublicKey, params);
      const derived2 = deriveChildPrivateKey(alicePrivateKey, bobPublicKey, params);

      expect(derived1.toHex()).toBe(derived2.toHex());
    });

    it("should derive different keys for different key IDs", () => {
      const params1: KeyDerivationParams = {
        protocolID: [2, "test"],
        keyID: "session-1",
      };
      const params2: KeyDerivationParams = {
        protocolID: [2, "test"],
        keyID: "session-2",
      };

      const derived1 = deriveChildPrivateKey(alicePrivateKey, bobPublicKey, params1);
      const derived2 = deriveChildPrivateKey(alicePrivateKey, bobPublicKey, params2);

      expect(derived1.toHex()).not.toBe(derived2.toHex());
    });

    it("should derive different keys for different counterparties", () => {
      const params: KeyDerivationParams = {
        protocolID: [2, "test"],
        keyID: "session-1",
      };

      const charliePrivateKey = BSVCrypto.privateKeyFromRandom();
      const charliePublicKey = charliePrivateKey.toPublicKey();

      const derivedForBob = deriveChildPrivateKey(alicePrivateKey, bobPublicKey, params);
      const derivedForCharlie = deriveChildPrivateKey(alicePrivateKey, charliePublicKey, params);

      expect(derivedForBob.toHex()).not.toBe(derivedForCharlie.toHex());
    });

    it("should match BSV SDK direct derivation", () => {
      const params: KeyDerivationParams = {
        protocolID: [2, "test"],
        keyID: "verify-sdk",
      };
      const invoiceNumber = buildInvoiceNumber(params.protocolID, params.keyID);

      // Our implementation
      const ourDerived = deriveChildPrivateKey(alicePrivateKey, bobPublicKey, params);

      // Direct BSV SDK
      const sdkDerived = alicePrivateKey.derivePrivateKey(bobPublicKey.toHex(), invoiceNumber);

      expect(ourDerived.toHex()).toBe(sdkDerived.toHex());
    });

    it("should reject 'anyone' counterparty for security level 2", () => {
      const params: KeyDerivationParams = {
        protocolID: [2, "test"],
        keyID: "session-1",
        counterparty: "anyone",
      };

      expect(() => deriveChildPrivateKey(alicePrivateKey, bobPublicKey, params)).toThrow(
        KeyDerivationError,
      );
      expect(() => deriveChildPrivateKey(alicePrivateKey, bobPublicKey, params)).toThrow(
        "specific counterparty",
      );
    });
  });

  describe("deriveChildPublicKey()", () => {
    it("should derive deterministic public key", () => {
      const params: KeyDerivationParams = {
        protocolID: [2, "test"],
        keyID: "session-1",
      };

      const derived1 = deriveChildPublicKey(alicePrivateKey, bobPublicKey, params);
      const derived2 = deriveChildPublicKey(alicePrivateKey, bobPublicKey, params);

      expect(derived1.toHex()).toBe(derived2.toHex());
    });

    it("should derive different public keys for different params", () => {
      const params1: KeyDerivationParams = {
        protocolID: [2, "test"],
        keyID: "session-1",
      };
      const params2: KeyDerivationParams = {
        protocolID: [2, "test"],
        keyID: "session-2",
      };

      const derived1 = deriveChildPublicKey(alicePrivateKey, bobPublicKey, params1);
      const derived2 = deriveChildPublicKey(alicePrivateKey, bobPublicKey, params2);

      expect(derived1.toHex()).not.toBe(derived2.toHex());
    });

    it("should produce valid compressed public key format", () => {
      const params: KeyDerivationParams = {
        protocolID: [2, "test"],
        keyID: "format-check",
      };

      const derived = deriveChildPublicKey(alicePrivateKey, bobPublicKey, params);
      const hex = derived.toHex();

      // Compressed public key is 33 bytes = 66 hex chars
      expect(hex.length).toBe(66);
      // Must start with 02 or 03
      expect(["02", "03"]).toContain(hex.substring(0, 2));
    });
  });

  describe("KeyDerivationService", () => {
    let aliceService: KeyDerivationService;
    let bobService: KeyDerivationService;

    beforeEach(() => {
      aliceService = new KeyDerivationService(alicePrivateKey);
      bobService = new KeyDerivationService(bobPrivateKey);
    });

    it("should maintain consistent identity key", () => {
      expect(aliceService.getIdentityPublicKeyHex()).toBe(alicePublicKey.toHex());
      expect(bobService.getIdentityPublicKeyHex()).toBe(bobPublicKey.toHex());
    });

    it("should create service from hex", () => {
      const service = KeyDerivationService.fromHex(
        "6a1751169c111b4667a6539ee1be6b7cd9f6e9c8fe011a5f2fe31e03a15e0ede",
      );
      expect(service.getIdentityPublicKeyHex()).toBe(alicePublicKey.toHex());
    });

    it("should create service from random", () => {
      const service1 = KeyDerivationService.fromRandom();
      const service2 = KeyDerivationService.fromRandom();

      expect(service1.getIdentityPublicKeyHex()).not.toBe(service2.getIdentityPublicKeyHex());
    });

    it("should derive private key with string public key", () => {
      const params: KeyDerivationParams = {
        protocolID: [2, "test"],
        keyID: "string-pubkey",
      };

      const derived = aliceService.derivePrivateKey(bobPublicKey.toHex(), params);
      const derivedDirect = aliceService.derivePrivateKey(bobPublicKey, params);

      expect(derived.toHex()).toBe(derivedDirect.toHex());
    });

    it("should derive public key with string public key", () => {
      const params: KeyDerivationParams = {
        protocolID: [2, "test"],
        keyID: "string-pubkey",
      };

      const derived = aliceService.derivePublicKey(bobPublicKey.toHex(), params);
      const derivedDirect = aliceService.derivePublicKey(bobPublicKey, params);

      expect(derived.toHex()).toBe(derivedDirect.toHex());
    });

    it("should derive symmetric shared secrets (Alice-Bob = Bob-Alice)", () => {
      const aliceSecret = aliceService.deriveSharedSecret(bobPublicKey);
      const bobSecret = bobService.deriveSharedSecret(alicePublicKey);

      expect(aliceSecret.toString("hex")).toBe(bobSecret.toString("hex"));
    });

    it("should derive different secrets with different contexts", () => {
      const secret1 = aliceService.deriveSharedSecret(bobPublicKey, "context-1");
      const secret2 = aliceService.deriveSharedSecret(bobPublicKey, "context-2");

      expect(secret1.toString("hex")).not.toBe(secret2.toString("hex"));
    });

    it("should derive different secrets for different counterparties", () => {
      const charlie = KeyDerivationService.fromRandom();

      const secretWithBob = aliceService.deriveSharedSecret(bobPublicKey);
      const secretWithCharlie = aliceService.deriveSharedSecret(charlie.getIdentityPublicKey());

      expect(secretWithBob.toString("hex")).not.toBe(secretWithCharlie.toString("hex"));
    });

    it("should return 32-byte shared secrets", () => {
      const secret = aliceService.deriveSharedSecret(bobPublicKey);
      expect(secret.length).toBe(32);
    });

    it("should sign messages", () => {
      // Create a message hash (32 bytes)
      const messageHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

      const signature = aliceService.sign(messageHash);

      // BSV SDK returns a Signature object with toDER() method
      // Check it's defined and can be converted to DER format
      expect(signature).toBeDefined();

      // If it's a Buffer, check length directly
      if (Buffer.isBuffer(signature)) {
        expect(signature.length).toBeGreaterThan(60);
        expect(signature.length).toBeLessThan(80);
      } else if (typeof (signature as unknown as { toDER?: () => number[] }).toDER === "function") {
        // BSV SDK Signature object - convert to DER for length check
        const der = (signature as unknown as { toDER: () => number[] }).toDER();
        expect(der.length).toBeGreaterThan(60);
        expect(der.length).toBeLessThan(80);
      } else {
        // Just check it exists as unknown kind of signature
        expect(signature).toBeTruthy();
      }
    });

    it("should derive and sign with derived key", () => {
      const messageHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      const params: KeyDerivationParams = {
        protocolID: [2, "signing"],
        keyID: "session-1",
      };

      const signature = aliceService.deriveAndSign(messageHash, bobPublicKey, params);

      expect(signature).toBeDefined();

      // Same handling as above for BSV SDK Signature objects
      if (Buffer.isBuffer(signature)) {
        expect(signature.length).toBeGreaterThan(60);
      } else if (typeof (signature as unknown as { toDER?: () => number[] }).toDER === "function") {
        const der = (signature as unknown as { toDER: () => number[] }).toDER();
        expect(der.length).toBeGreaterThan(60);
      } else {
        expect(signature).toBeTruthy();
      }
    });
  });

  describe("createProtocolID()", () => {
    it("should create valid protocol ID", () => {
      const protocolID = createProtocolID(2, "custom");
      expect(protocolID).toEqual([2, "custom"]);
    });

    it("should reject invalid security level", () => {
      expect(() => createProtocolID(5 as unknown as 0, "test")).toThrow(KeyDerivationError);
    });

    it("should reject empty protocol string", () => {
      expect(() => createProtocolID(2, "")).toThrow(KeyDerivationError);
    });
  });

  describe("StandardProtocols", () => {
    it("should have valid MESSAGE_ENCRYPTION protocol", () => {
      const [level, protocol] = StandardProtocols.MESSAGE_ENCRYPTION;
      expect(level).toBe(2);
      expect(protocol).toBe("message encryption");
    });

    it("should have valid AUTH protocol", () => {
      const [level, protocol] = StandardProtocols.AUTH;
      expect(level).toBe(2);
      expect(protocol).toBe("auth");
    });

    it("should have valid CERTIFICATES protocol", () => {
      const [level, protocol] = StandardProtocols.CERTIFICATES;
      expect(level).toBe(2);
      expect(protocol).toBe("certificates");
    });

    it("should have valid PUBLIC_DISCOVERY protocol", () => {
      const [level, protocol] = StandardProtocols.PUBLIC_DISCOVERY;
      expect(level).toBe(1);
      expect(protocol).toBe("public");
    });
  });

  describe("Error handling", () => {
    it("should include error code in KeyDerivationError", () => {
      try {
        buildInvoiceNumber([3 as unknown as 0, "test"], "key");
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(KeyDerivationError);
        expect((e as KeyDerivationError).code).toBe("INVALID_SECURITY_LEVEL");
        expect((e as KeyDerivationError).httpCode).toBe(400);
      }
    });

    it("should include HTTP code for different errors", () => {
      try {
        buildInvoiceNumber([2, ""], "key");
        expect.fail("Should have thrown");
      } catch (e) {
        expect((e as KeyDerivationError).code).toBe("INVALID_PROTOCOL_ID");
        expect((e as KeyDerivationError).httpCode).toBe(400);
      }
    });
  });

  describe("BRC-42 Test Vector Validation", () => {
    /**
     * Official BRC-42 test vectors
     */
    const testVectors = [
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
    ];

    testVectors.forEach((vector, index) => {
      it(`should match BRC-42 test vector ${index + 1}`, () => {
        const recipientKey = BSVCrypto.privateKeyFromHex(vector.recipientPrivateKey);
        const senderPubKey = BSVCrypto.publicKeyFromHex(vector.senderPublicKey);

        // Use direct derivation since invoice number is already provided
        const derived = recipientKey.derivePrivateKey(senderPubKey.toHex(), vector.invoiceNumber);

        expect(derived.toHex()).toBe(vector.expectedPrivateKey);
      });
    });
  });
});
