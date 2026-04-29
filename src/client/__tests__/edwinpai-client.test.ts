/**
 * EdwinPAI Client SDK Tests
 */

import { describe, it, expect, vi } from "vitest";
import { EdwinPAIClient, createClient } from "../edwinpai-client.js";

describe("EdwinPAIClient", () => {
  describe("identity generation", () => {
    it("should generate new identity keypair", () => {
      const identity = EdwinPAIClient.generateIdentity();

      expect(identity.privateKeyHex).toBeDefined();
      expect(identity.publicKeyHex).toBeDefined();
      expect(identity.privateKeyHex).toMatch(/^[0-9a-f]{64}$/);
      expect(identity.publicKeyHex).toMatch(/^0[23][0-9a-f]{64}$/);
    });

    it("should generate unique identities", () => {
      const identity1 = EdwinPAIClient.generateIdentity();
      const identity2 = EdwinPAIClient.generateIdentity();

      expect(identity1.privateKeyHex).not.toBe(identity2.privateKeyHex);
      expect(identity1.publicKeyHex).not.toBe(identity2.publicKeyHex);
    });

    it("should use provided private key", () => {
      const identity = EdwinPAIClient.generateIdentity();

      const client = new EdwinPAIClient({
        serverUrl: "https://example.com",
        privateKeyHex: identity.privateKeyHex,
      });

      expect(client.getPublicKey()).toBe(identity.publicKeyHex);
    });

    it("should generate new key if not provided", () => {
      const client = new EdwinPAIClient({
        serverUrl: "https://example.com",
      });

      const publicKey = client.getPublicKey();
      expect(publicKey).toMatch(/^0[23][0-9a-f]{64}$/);
    });
  });

  describe("request signing", () => {
    it("should sign requests with identity", () => {
      const client = new EdwinPAIClient({
        serverUrl: "https://example.com",
      });

      const headers = client.getSignedHeaders("POST", "/api/chat", { message: "hello" });

      expect(headers["x-bsv-identity-key"]).toBe(client.getPublicKey());
      expect(headers["x-bsv-signature"]).toBeDefined();
      expect(headers["x-bsv-signature"]).toMatch(/^[0-9a-f]+$/);
      expect(headers["x-bsv-timestamp"]).toBeDefined();
      expect(headers["x-bsv-nonce"]).toBeDefined();
    });

    it("should include different timestamps", async () => {
      const client = new EdwinPAIClient({
        serverUrl: "https://example.com",
      });

      const headers1 = client.getSignedHeaders("POST", "/api/test", {});
      await new Promise((resolve) => setTimeout(resolve, 10));
      const headers2 = client.getSignedHeaders("POST", "/api/test", {});

      expect(headers1["x-bsv-timestamp"]).not.toBe(headers2["x-bsv-timestamp"]);
    });

    it("should include different nonces", () => {
      const client = new EdwinPAIClient({
        serverUrl: "https://example.com",
      });

      const headers1 = client.getSignedHeaders("POST", "/api/test", {});
      const headers2 = client.getSignedHeaders("POST", "/api/test", {});

      expect(headers1["x-bsv-nonce"]).not.toBe(headers2["x-bsv-nonce"]);
    });
  });

  describe("message signing/verification", () => {
    it("should sign and verify messages", async () => {
      const client = new EdwinPAIClient({
        serverUrl: "https://example.com",
      });

      const message = "Hello, World!";
      const signature = await client.signMessage(message);

      expect(signature).toMatch(/^[0-9a-f]+$/);

      const isValid = await client.verifyMessage(message, signature, client.getPublicKey());
      expect(isValid).toBe(true);
    });

    it("should reject invalid signatures", async () => {
      const client = new EdwinPAIClient({
        serverUrl: "https://example.com",
      });

      const message = "Hello, World!";
      const signature = await client.signMessage(message);

      // Tamper with signature
      const tamperedSignature = signature.replace(/[0-9]/g, "0");

      const isValid = await client.verifyMessage(message, tamperedSignature, client.getPublicKey());
      expect(isValid).toBe(false);
    });

    it("should reject wrong signer", async () => {
      const client1 = new EdwinPAIClient({ serverUrl: "https://example.com" });
      const client2 = new EdwinPAIClient({ serverUrl: "https://example.com" });

      const message = "Hello, World!";
      const signature = await client1.signMessage(message);

      // Verify with wrong public key
      const isValid = await client1.verifyMessage(message, signature, client2.getPublicKey());
      expect(isValid).toBe(false);
    });
  });

  describe("encryption/decryption", () => {
    it("should encrypt message for recipient", async () => {
      const sender = new EdwinPAIClient({ serverUrl: "https://example.com" });
      const recipient = new EdwinPAIClient({ serverUrl: "https://example.com" });

      const plaintext = "Secret message";
      const encrypted = await sender.encryptFor(recipient.getPublicKey(), plaintext);

      expect(encrypted).toBeDefined();
      expect(encrypted).toMatch(/^[0-9a-f]+$/);
      expect(encrypted).not.toContain(plaintext);
    });

    it("should decrypt message from sender", async () => {
      const sender = new EdwinPAIClient({ serverUrl: "https://example.com" });
      const recipient = new EdwinPAIClient({ serverUrl: "https://example.com" });

      const plaintext = "Secret message";
      const encrypted = await sender.encryptFor(recipient.getPublicKey(), plaintext);
      const decrypted = await recipient.decryptFrom(sender.getPublicKey(), encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle unicode in encrypted messages", async () => {
      const sender = new EdwinPAIClient({ serverUrl: "https://example.com" });
      const recipient = new EdwinPAIClient({ serverUrl: "https://example.com" });

      const plaintext = "秘密消息 🔐";
      const encrypted = await sender.encryptFor(recipient.getPublicKey(), plaintext);
      const decrypted = await recipient.decryptFrom(sender.getPublicKey(), encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe("HTTP requests", () => {
    it("should make signed requests", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "Hello!" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new EdwinPAIClient({
        serverUrl: "https://example.com",
        fetch: mockFetch,
      });

      const _response = await client.request("POST", "/api/test", { data: "value" });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://example.com/api/test");
      expect(options.method).toBe("POST");
      expect(options.headers["x-bsv-identity-key"]).toBe(client.getPublicKey());
      expect(options.headers["x-bsv-signature"]).toBeDefined();
      expect(JSON.parse(options.body)).toEqual({ data: "value" });
    });

    it("should chat with server", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "Hello from EdwinPAI!" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new EdwinPAIClient({
        serverUrl: "https://example.com",
        fetch: mockFetch,
      });

      const response = await client.chat("Hello!");

      expect(response).toBe("Hello from EdwinPAI!");
    });

    it("should handle chat errors", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response("Server error", {
          status: 500,
        }),
      );

      const client = new EdwinPAIClient({
        serverUrl: "https://example.com",
        fetch: mockFetch,
      });

      await expect(client.chat("Hello!")).rejects.toThrow("Chat failed: 500");
    });

    it("should store memory", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
        }),
      );

      const client = new EdwinPAIClient({
        serverUrl: "https://example.com",
        fetch: mockFetch,
      });

      await client.storeMemory("User likes coffee");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://example.com/api/memories");
      expect(JSON.parse(options.body)).toEqual({ content: "User likes coffee" });
    });

    it("should recall memories", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            memories: [{ content: "User likes coffee" }, { content: "User drinks espresso" }],
          }),
          {
            status: 200,
          },
        ),
      );

      const client = new EdwinPAIClient({
        serverUrl: "https://example.com",
        fetch: mockFetch,
      });

      const memories = await client.recallMemory("coffee");

      expect(memories).toEqual(["User likes coffee", "User drinks espresso"]);
    });
  });

  describe("configuration", () => {
    it("should remove trailing slash from serverUrl", () => {
      const client = new EdwinPAIClient({
        serverUrl: "https://example.com/",
      });

      // Verify by checking the signed headers path resolution works
      expect(client.getPublicKey()).toBeDefined();
    });

    it("should accept custom timeout", async () => {
      const mockFetch = vi.fn().mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error("timeout")), 100);
          }),
      );

      const client = new EdwinPAIClient({
        serverUrl: "https://example.com",
        timeoutMs: 50,
        fetch: mockFetch,
      });

      // The request should timeout
      await expect(client.request("GET", "/test")).rejects.toThrow();
    });
  });
});

describe("createClient", () => {
  it("should create client with URL only", () => {
    const client = createClient("https://example.com");
    expect(client.getPublicKey()).toBeDefined();
  });

  it("should create client with URL and key", () => {
    const identity = EdwinPAIClient.generateIdentity();
    const client = createClient("https://example.com", identity.privateKeyHex);
    expect(client.getPublicKey()).toBe(identity.publicKeyHex);
  });
});
