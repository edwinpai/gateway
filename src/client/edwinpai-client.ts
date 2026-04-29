/**
 * EdwinPAI Client SDK - Client-Side Identity and Request Signing
 *
 * A minimal client library that handles:
 * - Key generation and management
 * - BRC-103 request signing
 * - ECIES encryption/decryption
 *
 * @see https://github.com/bitcoin-sv/BRCs/blob/master/peer-to-peer/0103.md
 */

import type { IdentityCore, SignMessageInput, SignedMessage } from "@edwinpai/identity-core";
import {
  createNodeIdentityCoreBinding,
  type NodeIdentityCoreTransport,
} from "@edwinpai/identity-core";
import { createHash } from "node:crypto";
import { RequestSigner, type SignedRequestHeaders } from "../auth/request-signer.js";
import { BSVCrypto, SecurePrivateKey, SecurePublicKey } from "../crypto/bsv-sdk-wrapper.js";
import { ECIES } from "../crypto/ecies.js";

/**
 * Client configuration
 */
export interface EdwinPAIClientConfig {
  /** EdwinPAI server URL */
  serverUrl: string;
  /** Private key in hex format (optional - generates new if not provided) */
  privateKeyHex?: string;
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number;
  /** Custom fetch implementation (for Node.js < 18) */
  fetch?: typeof globalThis.fetch;
}

/**
 * Identity keypair
 */
export interface IdentityKeypair {
  /** Private key as hex string (64 characters) */
  privateKeyHex: string;
  /** Public key as hex string (66 characters, compressed) */
  publicKeyHex: string;
}

/**
 * Chat response
 */
export interface ChatResponse {
  /** Response message */
  message: string;
  /** Session ID (if any) */
  sessionId?: string;
  /** Token usage (if provided) */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Memory entry
 */
export interface Memory {
  /** Memory ID */
  id: string;
  /** Memory content */
  content: string;
  /** When the memory was created */
  createdAt: number;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * EdwinPAI Client
 *
 * Handles identity management and secure communication with an EdwinPAI server.
 *
 * @example
 * ```typescript
 * // Create a new identity
 * const identity = EdwinPAIClient.generateIdentity();
 * console.log("Save this private key:", identity.privateKeyHex);
 *
 * // Connect to EdwinPAI with the identity
 * const client = new EdwinPAIClient({
 *   serverUrl: "https://edwinpai.example.com",
 *   privateKeyHex: identity.privateKeyHex
 * });
 *
 * // Chat with EdwinPAI
 * const response = await client.chat("Hello, EdwinPAI!");
 * console.log(response);
 *
 * // Store a memory
 * await client.storeMemory("User's favorite color is blue");
 *
 * // Recall memories
 * const memories = await client.recallMemory("favorite color");
 * ```
 */
export class EdwinPAIClient {
  private readonly privateKey: SecurePrivateKey;
  private readonly publicKey: SecurePublicKey;
  private readonly publicKeyHex: string;
  private readonly serverUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly requestSigningTransport: NodeIdentityCoreTransport = {
    getPublicKey: async (): Promise<string> => this.publicKeyHex,
    signHttpRequest: async ({
      method,
      path,
      body,
      timestamp,
      nonce,
    }): Promise<SignedRequestHeaders> => {
      return this.signRequestHeaders(method, path, body, timestamp, nonce);
    },
    signMessage: async ({ message }: SignMessageInput): Promise<SignedMessage> => {
      return this.signMessageViaTransport(message);
    },
    verifySignature: async ({ data, signature, publicKey }) => {
      const message = typeof data === "string" ? data : Buffer.from(data).toString("utf-8");
      return {
        valid: this.verifyMessageViaTransport(message, signature, publicKey),
      };
    },
  };
  private readonly identityCore: IdentityCore;
  private readonly ecies: ECIES;

  /**
   * Create a new EdwinPAIClient
   *
   * @param config - Client configuration
   */
  constructor(config: EdwinPAIClientConfig) {
    this.serverUrl = config.serverUrl.replace(/\/$/, ""); // Remove trailing slash
    this.timeoutMs = config.timeoutMs ?? 30000;
    this.fetchFn = config.fetch ?? globalThis.fetch;

    // Initialize identity
    if (config.privateKeyHex) {
      this.privateKey = BSVCrypto.privateKeyFromHex(config.privateKeyHex);
    } else {
      this.privateKey = BSVCrypto.privateKeyFromRandom();
    }

    this.publicKey = this.privateKey.toPublicKey();
    this.publicKeyHex = this.publicKey.toHex();

    // Initialize identity-backed helpers
    this.identityCore = createNodeIdentityCoreBinding(this.requestSigningTransport);
    this.ecies = new ECIES(this.privateKey);
  }

  /**
   * Generate a new identity keypair
   *
   * @returns New identity keypair
   */
  static generateIdentity(): IdentityKeypair {
    const privateKey = BSVCrypto.privateKeyFromRandom();
    const publicKey = privateKey.toPublicKey();

    return {
      privateKeyHex: privateKey.toHex(),
      publicKeyHex: publicKey.toHex(),
    };
  }

  /**
   * Get the client's public key (identity)
   *
   * @returns Compressed public key as hex string
   */
  getPublicKey(): string {
    return this.publicKeyHex;
  }

  /**
   * Get the client's private key (USE WITH CAUTION)
   *
   * @returns Private key as hex string
   */
  getPrivateKeyHex(): string {
    return this.privateKey.toHex();
  }

  /**
   * Sign and send a request to EdwinPAI
   *
   * @param method - HTTP method (GET, POST, etc.)
   * @param path - Request path (e.g., /api/chat)
   * @param body - Optional request body
   * @returns Response object
   */
  async request(method: string, path: string, body?: object): Promise<Response> {
    const url = `${this.serverUrl}${path}`;

    // Sign the request
    const signedHeaders = await this.identityCore.signHttpRequest({
      method,
      path,
      body,
    });

    // Build headers
    const headers: Record<string, string> = {
      ...signedHeaders,
      "Content-Type": "application/json",
    };

    // Build fetch options
    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    };

    if (body && method !== "GET" && method !== "HEAD") {
      fetchOptions.body = JSON.stringify(body);
    }

    // Send request
    const response = await this.fetchFn(url, fetchOptions);

    return response;
  }

  /**
   * Chat with EdwinPAI
   *
   * @param message - Message to send
   * @param options - Optional chat options
   * @returns Chat response
   */
  async chat(message: string, options?: { sessionId?: string }): Promise<string> {
    const body: Record<string, unknown> = {
      message,
    };

    if (options?.sessionId) {
      body.sessionId = options.sessionId;
    }

    const response = await this.request("POST", "/api/chat", body);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Chat failed: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as { message?: string; response?: string };
    return data.message ?? data.response ?? "";
  }

  /**
   * Store a memory
   *
   * @param content - Memory content to store
   * @param metadata - Optional metadata
   */
  async storeMemory(content: string, metadata?: Record<string, unknown>): Promise<void> {
    const body: Record<string, unknown> = {
      content,
    };

    if (metadata) {
      body.metadata = metadata;
    }

    const response = await this.request("POST", "/api/memories", body);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Store memory failed: ${response.status} - ${error}`);
    }
  }

  /**
   * Recall memories by query
   *
   * @param query - Search query
   * @param limit - Maximum number of results (default: 10)
   * @returns Array of matching memories
   */
  async recallMemory(query: string, limit: number = 10): Promise<string[]> {
    const response = await this.request("POST", "/api/memories/recall", {
      query,
      limit,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Recall memory failed: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as { memories?: Array<{ content: string }> };
    return (data.memories ?? []).map((m) => m.content);
  }

  /**
   * Encrypt a message for another EdwinPAI user
   *
   * @param recipientPublicKey - Recipient's public key (hex)
   * @param plaintext - Message to encrypt
   * @returns Encrypted message as hex string
   */
  async encryptFor(recipientPublicKey: string, plaintext: string): Promise<string> {
    const plaintextBuffer = Buffer.from(plaintext, "utf-8");
    const ciphertext = this.ecies.encrypt(plaintextBuffer, recipientPublicKey);
    return ciphertext.toString("hex");
  }

  /**
   * Decrypt a message from another EdwinPAI user
   *
   * @param senderPublicKey - Sender's public key (hex)
   * @param ciphertextHex - Encrypted message as hex string
   * @returns Decrypted message
   */
  async decryptFrom(senderPublicKey: string, ciphertextHex: string): Promise<string> {
    const ciphertext = Buffer.from(ciphertextHex, "hex");
    const plaintext = this.ecies.decrypt(ciphertext, senderPublicKey);
    return plaintext.toString("utf-8");
  }

  /**
   * Get signed headers for a request
   *
   * Useful when you need to make requests with a different HTTP client.
   *
   * @param method - HTTP method
   * @param path - Request path
   * @param body - Optional request body
   * @returns Signed headers
   */
  getSignedHeaders(method: string, path: string, body?: object): SignedRequestHeaders {
    return this.signRequestHeaders(method, path, body);
  }

  private signRequestHeaders(
    method: string,
    path: string,
    body?: string | object,
    timestamp?: number,
    nonce?: string,
  ): SignedRequestHeaders {
    const signer = new RequestSigner(this.privateKey);
    return signer.signRequest({ method, path, body, timestamp, nonce });
  }

  /**
   * Verify a message from another identity
   *
   * @param message - Original message
   * @param signature - Signature to verify (hex)
   * @param signerPublicKey - Signer's public key (hex)
   * @returns true if signature is valid
   */
  async verifyMessage(
    message: string,
    signature: string,
    signerPublicKey: string,
  ): Promise<boolean> {
    const verification = await this.identityCore.verifySignature({
      data: message,
      signature,
      publicKey: signerPublicKey,
    });

    return verification.valid;
  }

  /**
   * Sign a message
   *
   * @param message - Message to sign
   * @returns Signature as hex string
   */
  async signMessage(message: string): Promise<string> {
    return (await this.identityCore.signMessage({ message })).signature;
  }

  private signMessageViaTransport(message: string): SignedMessage {
    const messageHash = createHash("sha256").update(message).digest("hex");
    const signature = BSVCrypto.sign(this.privateKey, messageHash);
    return {
      signature: signature.toString("hex"),
    };
  }

  private verifyMessageViaTransport(
    message: string,
    signature: string,
    signerPublicKey: string,
  ): boolean {
    try {
      const messageHash = createHash("sha256").update(message).digest("hex");
      const publicKey = BSVCrypto.publicKeyFromHex(signerPublicKey);
      const signatureBuffer = Buffer.from(signature, "hex");
      return BSVCrypto.verify(publicKey, messageHash, signatureBuffer);
    } catch {
      return false;
    }
  }
}

/**
 * Create a simple EdwinPAI client for one-off requests
 *
 * @param serverUrl - EdwinPAI server URL
 * @param privateKeyHex - Optional private key (generates new if not provided)
 * @returns Configured EdwinPAIClient
 */
export function createClient(serverUrl: string, privateKeyHex?: string): EdwinPAIClient {
  return new EdwinPAIClient({
    serverUrl,
    privateKeyHex,
  });
}

// Re-export types for convenience
export type { SignedRequestHeaders } from "../auth/request-signer.js";
export { SecurePrivateKey, SecurePublicKey } from "../crypto/bsv-sdk-wrapper.js";
