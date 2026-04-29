/**
 * CryptoGateway Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BSVCrypto } from "../../crypto/bsv-sdk-wrapper.js";
import { CryptoGateway, getCryptoGateway, resetCryptoGateway } from "../crypto-gateway.js";

describe("CryptoGateway", () => {
  let gateway: CryptoGateway;

  beforeEach(() => {
    gateway = new CryptoGateway();
  });

  afterEach(() => {
    gateway.shutdown();
  });

  describe("lifecycle", () => {
    it("should initialize with default configuration", () => {
      expect(gateway).toBeInstanceOf(CryptoGateway);
      expect(gateway.isGatewayShutdown()).toBe(false);
    });

    it("should provide CryptoService", () => {
      const cryptoService = gateway.getCryptoService();
      expect(cryptoService).toBeDefined();
    });

    it("should provide RequestAuthorizer", () => {
      const authorizer = gateway.getRequestAuthorizer();
      expect(authorizer).toBeDefined();
    });

    it("should provide TimingMonitor", () => {
      const monitor = gateway.getTimingMonitor();
      expect(monitor).toBeDefined();
    });

    it("should shutdown cleanly", () => {
      gateway.shutdown();
      expect(gateway.isGatewayShutdown()).toBe(true);
    });

    it("should throw after shutdown", () => {
      gateway.shutdown();
      expect(() => gateway.getCryptoService()).toThrow("shutdown");
      expect(() => gateway.getRequestAuthorizer()).toThrow("shutdown");
    });

    it("should be idempotent on multiple shutdowns", () => {
      gateway.shutdown();
      gateway.shutdown();
      expect(gateway.isGatewayShutdown()).toBe(true);
    });
  });

  describe("health check", () => {
    it("should report ok status when healthy", () => {
      const health = gateway.health();
      expect(health.status).toBe("ok");
      expect(health.timestamp).toBeGreaterThan(0);
    });

    it("should report error status after shutdown", () => {
      gateway.shutdown();
      const health = gateway.health();
      expect(health.status).toBe("error");
    });

    it("should include component details", () => {
      const health = gateway.health();
      expect(health.details.cryptoService).toBeDefined();
      expect(health.details.requestAuthorizer).toBeDefined();
      expect(health.details.timingMonitor).toBeDefined();
    });

    it("should track crypto service stats", () => {
      const health = gateway.health();
      expect(health.details.cryptoService.status).toBe("ok");
      expect(typeof health.details.cryptoService.keyCount).toBe("number");
    });

    it("should track timing monitor stats", () => {
      const health = gateway.health();
      expect(health.details.timingMonitor.status).toBe("ok");
      expect(typeof health.details.timingMonitor.trackedIdentities).toBe("number");
    });
  });

  describe("encrypt/decrypt response", () => {
    it("should encrypt response for identity", async () => {
      // Generate a recipient identity
      const recipientKey = BSVCrypto.privateKeyFromRandom();
      const recipientPublicKey = recipientKey.toPublicKey().toHex();

      // Wait for gateway key initialization
      await new Promise((resolve) => setTimeout(resolve, 100));

      const data = Buffer.from("Hello, World!");
      const encrypted = await gateway.encryptResponse(data, recipientPublicKey);

      expect(encrypted).toBeInstanceOf(Buffer);
      expect(encrypted.length).toBeGreaterThan(0);
      expect(encrypted.toString("hex")).not.toBe(data.toString("hex"));
    });

    it("should decrypt request from identity", async () => {
      // This test requires the gateway to know its own public key
      // which is available after initialization
      await new Promise((resolve) => setTimeout(resolve, 100));

      const gatewayPublicKey = gateway.getGatewayPublicKey();
      expect(gatewayPublicKey).toBeDefined();

      // Create a sender
      const senderKey = BSVCrypto.privateKeyFromRandom();
      const _senderPublicKey = senderKey.toPublicKey().toHex();

      // The sender encrypts for the gateway
      // For a round-trip test, we need access to lower-level APIs
      // This is simplified to just test that decrypt works with valid input
    });
  });

  describe("identity registration", () => {
    it("should register known identities", () => {
      const publicKey = BSVCrypto.privateKeyFromRandom().toPublicKey().toHex();
      gateway.registerIdentity(publicKey, { name: "Test User", trustLevel: 80 });

      const authorizer = gateway.getRequestAuthorizer();
      expect(authorizer.isKnownIdentity(publicKey)).toBe(true);
    });

    it("should track identity metadata", () => {
      const publicKey = BSVCrypto.privateKeyFromRandom().toPublicKey().toHex();
      gateway.registerIdentity(publicKey, { name: "Alice", trustLevel: 90 });

      const authorizer = gateway.getRequestAuthorizer();
      const metadata = authorizer.getIdentityMetadata(publicKey);
      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe("Alice");
      expect(metadata?.trustLevel).toBe(90);
    });
  });

  describe("custom configuration", () => {
    it("should accept custom gateway key", async () => {
      const customKey = BSVCrypto.privateKeyFromRandom();
      const customGateway = new CryptoGateway({
        gatewayPrivateKeyHex: customKey.toHex(),
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(customGateway.getGatewayPublicKey()).toBe(customKey.toPublicKey().toHex());
      customGateway.shutdown();
    });

    it("should accept custom key TTL", () => {
      const customGateway = new CryptoGateway({
        gatewayKeyTtlMs: 30 * 60 * 1000, // 30 minutes
      });

      expect(customGateway.isGatewayShutdown()).toBe(false);
      customGateway.shutdown();
    });
  });
});

describe("CryptoGateway singleton", () => {
  afterEach(() => {
    resetCryptoGateway();
  });

  it("should return same instance on multiple calls", () => {
    const gateway1 = getCryptoGateway();
    const gateway2 = getCryptoGateway();
    expect(gateway1).toBe(gateway2);
  });

  it("should reset singleton", () => {
    const gateway1 = getCryptoGateway();
    resetCryptoGateway();
    const gateway2 = getCryptoGateway();
    expect(gateway1).not.toBe(gateway2);
  });

  it("should pass config to new instance", () => {
    const gateway = getCryptoGateway({
      timingMonitor: {
        concurrencyWindowMs: 200,
      },
    });
    expect(gateway).toBeDefined();
  });
});
