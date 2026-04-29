/**
 * BRC-103 Request Signing Client
 *
 * Client-side utility for signing outgoing HTTP requests following
 * the BRC-103 peer-to-peer authentication specification.
 *
 * @see https://github.com/bitcoin-sv/BRCs/blob/master/peer-to-peer/0103.md
 * @see https://github.com/bitcoin-sv/BRCs/blob/master/peer-to-peer/0104.md
 */

import { createHash } from "node:crypto";
import type { PublicKey, Signature } from "../types/bsv-auth.js";
import { BSVCrypto, SecurePrivateKey, SecurePublicKey } from "../crypto/bsv-sdk-wrapper.js";
import { canonicalizeRequest } from "../types/bsv-auth.js";

/**
 * Headers returned by signRequest()
 */
export interface SignedRequestHeaders {
  "x-bsv-identity-key": string;
  "x-bsv-signature": string;
  "x-bsv-timestamp": string;
  "x-bsv-nonce": string;
}

/**
 * Parameters for signing a request
 */
export interface SignRequestParams {
  /** HTTP method (GET, POST, etc.) */
  method: string;
  /** Request path (without host, including query string) */
  path: string;
  /** Request body (optional) */
  body?: string | object;
  /** Custom timestamp (default: Date.now()) */
  timestamp?: number;
  /** Custom nonce (default: crypto.randomUUID()) */
  nonce?: string;
}

/**
 * BRC-103 Request Signer
 *
 * Signs outgoing HTTP requests with the sender's private key for
 * peer-to-peer authentication.
 *
 * @example
 * ```typescript
 * // Create signer with a private key
 * const privateKey = BSVCrypto.privateKeyFromHex("...");
 * const signer = new RequestSigner(privateKey);
 *
 * // Sign a request
 * const headers = signer.signRequest({
 *   method: "POST",
 *   path: "/api/agent/run",
 *   body: { prompt: "hello" }
 * });
 *
 * // Attach headers to fetch request
 * const response = await fetch("https://example.com/api/agent/run", {
 *   method: "POST",
 *   headers: {
 *     "Content-Type": "application/json",
 *     ...headers
 *   },
 *   body: JSON.stringify({ prompt: "hello" })
 * });
 * ```
 */
export class RequestSigner {
  private readonly privateKey: SecurePrivateKey;
  private readonly publicKey: SecurePublicKey;
  private readonly identityKeyHex: string;

  /**
   * Create a new RequestSigner
   *
   * @param privateKey - Identity private key for signing requests
   */
  constructor(privateKey: SecurePrivateKey) {
    this.privateKey = privateKey;
    this.publicKey = privateKey.toPublicKey();
    this.identityKeyHex = this.publicKey.toHex();
  }

  /**
   * Create a RequestSigner from a hex-encoded private key
   *
   * @param privateKeyHex - 64-character hex string
   * @returns RequestSigner instance
   */
  static fromHex(privateKeyHex: string): RequestSigner {
    const privateKey = BSVCrypto.privateKeyFromHex(privateKeyHex);
    return new RequestSigner(privateKey);
  }

  /**
   * Create a RequestSigner with a randomly generated key
   *
   * @returns RequestSigner instance with random key
   */
  static fromRandom(): RequestSigner {
    const privateKey = BSVCrypto.privateKeyFromRandom();
    return new RequestSigner(privateKey);
  }

  /**
   * Sign an HTTP request and return headers to attach
   *
   * Follows BRC-103 canonicalization format:
   * `METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY_OR_EMPTY`
   *
   * @param params - Request parameters to sign
   * @returns Headers object with authentication data
   */
  signRequest(params: SignRequestParams): SignedRequestHeaders {
    const { method, path, body } = params;
    const timestamp = params.timestamp ?? Date.now();
    const nonce = params.nonce ?? crypto.randomUUID();

    // Build the canonical request string
    const canonicalRequest = canonicalizeRequest({
      method,
      path,
      body,
      timestamp,
      nonce,
      identityKey: this.identityKeyHex,
    });

    // SHA-256 hash the canonical string
    const messageHash = createHash("sha256").update(canonicalRequest).digest("hex");

    // Sign the hash with the private key
    const signatureBuffer = BSVCrypto.sign(this.privateKey, messageHash);
    const signatureHex = signatureBuffer.toString("hex");

    return {
      "x-bsv-identity-key": this.identityKeyHex,
      "x-bsv-signature": signatureHex,
      "x-bsv-timestamp": timestamp.toString(),
      "x-bsv-nonce": nonce,
    };
  }

  /**
   * Get the identity public key (hex)
   *
   * This is the key used to identify the signer in BRC-103.
   *
   * @returns Compressed public key as 66-character hex string
   */
  getIdentityKey(): string {
    return this.identityKeyHex;
  }

  /**
   * Get the identity public key as SecurePublicKey
   *
   * @returns SecurePublicKey instance
   */
  getPublicKey(): SecurePublicKey {
    return this.publicKey;
  }

  /**
   * Get the private key (USE WITH CAUTION)
   *
   * @returns SecurePrivateKey instance
   */
  getPrivateKey(): SecurePrivateKey {
    return this.privateKey;
  }
}

/**
 * Convenience function to sign a single request
 *
 * @param privateKey - Private key for signing
 * @param params - Request parameters
 * @returns Signed headers
 */
export function signRequest(
  privateKey: SecurePrivateKey,
  params: SignRequestParams,
): SignedRequestHeaders {
  const signer = new RequestSigner(privateKey);
  return signer.signRequest(params);
}

/**
 * Build headers from pre-computed values (for testing or low-level use)
 *
 * @param identityKey - Signer's public key
 * @param signature - Pre-computed signature
 * @param timestamp - Request timestamp
 * @param nonce - Request nonce
 * @returns Headers object
 */
export function buildAuthHeaders(
  identityKey: PublicKey,
  signature: Signature,
  timestamp: number,
  nonce: string,
): SignedRequestHeaders {
  return {
    "x-bsv-identity-key": identityKey,
    "x-bsv-signature": signature,
    "x-bsv-timestamp": timestamp.toString(),
    "x-bsv-nonce": nonce,
  };
}

// Re-export types for convenience
export type { SecurePrivateKey, SecurePublicKey } from "../crypto/bsv-sdk-wrapper.js";
