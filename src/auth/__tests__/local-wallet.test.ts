/**
 * LocalWallet Tests
 *
 * Tests for the LocalWallet implementation (BRC-100 compliant).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LocalWallet } from "../local-wallet.js";

describe("LocalWallet", () => {
  let wallet: LocalWallet;

  beforeEach(() => {
    wallet = new LocalWallet();
  });

  afterEach(() => {
    wallet.seal();
  });

  describe("Identity Methods", () => {
    it("should return root public key when no params provided", async () => {
      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 50));

      const result = await wallet.getPublicKey();
      expect(result.success).toBe(true);
      expect(result.result?.publicKey).toBeDefined();
      expect(result.result?.publicKey).toMatch(/^0[23][0-9a-fA-F]{64}$/);
    });

    it("should derive child key for protocol/keyID", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      const result = await wallet.getPublicKey({
        protocolID: [2, "test-protocol"],
        keyID: "test-key-1",
        counterparty: "self",
      });

      expect(result.success).toBe(true);
      expect(result.result?.publicKey).toBeDefined();
      expect(result.result?.publicKey).toMatch(/^0[23][0-9a-fA-F]{64}$/);
    });

    it("should report authenticated when initialized", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      const result = await wallet.isAuthenticated();
      expect(result.success).toBe(true);
      expect(result.result?.authenticated).toBe(true);
    });

    it("should report not authenticated after sealing", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      wallet.seal();

      const result = await wallet.isAuthenticated();
      expect(result.success).toBe(true);
      expect(result.result?.authenticated).toBe(false);
    });

    it("should wait for authentication", async () => {
      const result = await wallet.waitForAuthentication({ timeout: 1000 });
      expect(result.success).toBe(true);
      expect(result.result?.authenticated).toBe(true);
    });
  });

  describe("Signing Methods", () => {
    it("should create signature with root key", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      const data = "Hello, world!";
      const result = await wallet.createSignature({
        data,
      });

      expect(result.success).toBe(true);
      expect(result.result?.signature).toBeDefined();
      expect(result.result?.publicKey).toBeDefined();
      expect(result.result?.signature).toMatch(/^[0-9a-fA-F]+$/);
    });

    it("should create signature with derived key", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      const data = "Test message";
      const result = await wallet.createSignature({
        data,
        protocolID: [2, "test-protocol"],
        keyID: "sig-key-1",
        counterparty: "self",
      });

      expect(result.success).toBe(true);
      expect(result.result?.signature).toBeDefined();
      expect(result.result?.publicKey).toBeDefined();
    });

    it("should verify valid signature", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      const data = "Test message";
      const signResult = await wallet.createSignature({ data });
      expect(signResult.success).toBe(true);

      const verifyResult = await wallet.verifySignature({
        data,
        signature: signResult.result!.signature,
        publicKey: signResult.result!.publicKey,
      });

      expect(verifyResult.success).toBe(true);
      expect(verifyResult.result?.valid).toBe(true);
    });

    it("should reject invalid signature", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      const data = "Test message";
      const signResult = await wallet.createSignature({ data });
      expect(signResult.success).toBe(true);

      // Verify with different data
      const verifyResult = await wallet.verifySignature({
        data: "Different message",
        signature: signResult.result!.signature,
        publicKey: signResult.result!.publicKey,
      });

      expect(verifyResult.success).toBe(true);
      expect(verifyResult.result?.valid).toBe(false);
    });
  });

  describe("Encryption Methods", () => {
    it("should encrypt and decrypt data", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      const plaintext = "Secret message";
      const protocolID: [number, string] = [2, "test-protocol"];
      const keyID = "enc-key-1";

      // Encrypt
      const encryptResult = await wallet.encrypt({
        plaintext,
        protocolID,
        keyID,
        counterparty: "self",
      });

      expect(encryptResult.success).toBe(true);
      expect(encryptResult.result?.ciphertext).toBeDefined();

      // Decrypt
      const decryptResult = await wallet.decrypt({
        ciphertext: encryptResult.result!.ciphertext,
        protocolID,
        keyID,
        counterparty: "self",
      });

      expect(decryptResult.success).toBe(true);
      expect(decryptResult.result?.plaintext).toBe(plaintext);
    });

    it("should encrypt with Uint8Array plaintext", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const protocolID: [number, string] = [2, "test-protocol"];
      const keyID = "enc-key-2";

      const encryptResult = await wallet.encrypt({
        plaintext,
        protocolID,
        keyID,
        counterparty: "self",
      });

      expect(encryptResult.success).toBe(true);
      expect(encryptResult.result?.ciphertext).toBeDefined();
    });

    it("should fail to decrypt with wrong keyID", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      const plaintext = "Secret message";
      const protocolID: [number, string] = [2, "test-protocol"];

      // Encrypt with one keyID
      const encryptResult = await wallet.encrypt({
        plaintext,
        protocolID,
        keyID: "enc-key-1",
        counterparty: "self",
      });

      expect(encryptResult.success).toBe(true);

      // Try to decrypt with different keyID
      const decryptResult = await wallet.decrypt({
        ciphertext: encryptResult.result!.ciphertext,
        protocolID,
        keyID: "enc-key-2", // Wrong key!
        counterparty: "self",
      });

      expect(decryptResult.success).toBe(false);
    });
  });

  describe("Certificate Methods", () => {
    it("should return NOT_IMPLEMENTED for acquireCertificate", async () => {
      const result = await wallet.acquireCertificate({
        type: "test-cert",
        certifier: "test-certifier",
        fields: { name: "Test" },
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("NOT_IMPLEMENTED");
    });

    it("should return empty list for listCertificates", async () => {
      const result = await wallet.listCertificates();

      expect(result.success).toBe(true);
      expect(result.result?.certificates).toEqual([]);
    });

    it("should return NOT_IMPLEMENTED for proveCertificate", async () => {
      const result = await wallet.proveCertificate({
        certificate: {
          type: "test",
          serialNumber: "123",
          certifier: "test-certifier",
          subject: "test-subject",
          fields: {},
          signature: "test-sig",
          issuedAt: Date.now(),
        },
        fieldsToReveal: ["name"],
        verifier: "test-verifier",
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("NOT_IMPLEMENTED");
    });

    it("should return NOT_IMPLEMENTED for relinquishCertificate", async () => {
      const result = await wallet.relinquishCertificate({
        type: "test",
        serialNumber: "123",
        certifier: "test-certifier",
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("NOT_IMPLEMENTED");
    });
  });

  describe("Discovery Methods", () => {
    it("should discover self by identity key", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      const rootPubKey = wallet.getRootPublicKey();
      expect(rootPubKey).toBeDefined();

      const result = await wallet.discoverByIdentityKey({
        identityKey: rootPubKey!,
      });

      expect(result.success).toBe(true);
      expect(result.result?.results).toHaveLength(1);
      expect(result.result?.results[0].identityKey).toBe(rootPubKey);
      expect(result.result?.results[0].name).toBe("LocalWallet");
    });

    it("should return empty results for unknown identity key", async () => {
      const result = await wallet.discoverByIdentityKey({
        identityKey: "020000000000000000000000000000000000000000000000000000000000000001",
      });

      expect(result.success).toBe(true);
      expect(result.result?.results).toEqual([]);
    });

    it("should return empty results for attribute discovery", async () => {
      const result = await wallet.discoverByAttributes({
        attributes: { name: "test" },
      });

      expect(result.success).toBe(true);
      expect(result.result?.results).toEqual([]);
    });
  });

  describe("Wallet Management", () => {
    it("should seal wallet and clear keys", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(wallet.getRootPublicKey()).toBeDefined();

      wallet.seal();

      expect(wallet.getRootPublicKey()).toBeNull();

      const authResult = await wallet.isAuthenticated();
      expect(authResult.result?.authenticated).toBe(false);
    });

    it("should fail operations after sealing", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      wallet.seal();

      const result = await wallet.getPublicKey();
      expect(result.success).toBe(false);
      expect(result.error).toContain("sealed");
    });
  });

  describe("Integration", () => {
    it("should use consistent keys for same protocol/keyID", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      const protocolID: [number, string] = [2, "test-protocol"];
      const keyID = "consistent-key";

      const result1 = await wallet.getPublicKey({
        protocolID,
        keyID,
        counterparty: "self",
      });

      const result2 = await wallet.getPublicKey({
        protocolID,
        keyID,
        counterparty: "self",
      });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.result?.publicKey).toBe(result2.result?.publicKey);
    });

    it("should derive different keys for different keyIDs", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      const protocolID: [number, string] = [2, "test-protocol"];

      const result1 = await wallet.getPublicKey({
        protocolID,
        keyID: "key-1",
        counterparty: "self",
      });

      const result2 = await wallet.getPublicKey({
        protocolID,
        keyID: "key-2",
        counterparty: "self",
      });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.result?.publicKey).not.toBe(result2.result?.publicKey);
    });
  });
});
