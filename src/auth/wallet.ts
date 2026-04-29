/**
 * BRC-56 Wallet Communication
 *
 * Implements wallet interface communication following BRC-56 specification.
 * Provides HTTP substrate for wallet-application communication.
 *
 * @see https://github.com/bitcoin-sv/BRCs/blob/master/wallet/0056.md
 */

import type {
  WalletInterface,
  WalletResult,
  SignatureRequest,
  SignatureResponse,
  VerifySignatureRequest,
  VerifySignatureResponse,
  Certificate,
  KeyLinkageProof,
  DiscoveryResult,
  ProtocolID,
  Counterparty,
  PublicKey,
} from "./types.js";

/**
 * Configuration for HTTP wallet connection
 */
export interface WalletClientConfig {
  /** Base URL of the wallet HTTP substrate */
  baseUrl: string;

  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** Custom headers to include with requests */
  headers?: Record<string, string>;
}

/**
 * HTTP-based wallet client implementing BRC-56 substrate
 *
 * Provides communication channel for:
 * - Creating transactions
 * - Creating/verifying signatures
 * - Managing certificates
 * - Identity discovery
 */
export class WalletClient implements WalletInterface {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly headers: Record<string, string>;

  constructor(config: WalletClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.timeout = config.timeout ?? 30000;
    this.headers = {
      "Content-Type": "application/json",
      ...config.headers,
    };
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
  ): Promise<WalletResult<T>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers: this.headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `HTTP ${response.status}: ${errorText}`,
        };
      }

      const data = await response.json();
      return { success: true, result: data as T };
    } catch (error) {
      clearTimeout(timeoutId);
      const message = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: message };
    }
  }

  // --- Identity Methods ---

  async getPublicKey(params?: {
    protocolID?: ProtocolID;
    keyID?: string;
    counterparty?: Counterparty;
    forSelf?: boolean;
  }): Promise<WalletResult<{ publicKey: string }>> {
    return this.request("POST", "/getPublicKey", params ?? {});
  }

  async isAuthenticated(): Promise<WalletResult<{ authenticated: boolean }>> {
    return this.request("GET", "/isAuthenticated");
  }

  // --- Signing Methods (BRC-3) ---

  async createSignature(params: SignatureRequest): Promise<WalletResult<SignatureResponse>> {
    return this.request("POST", "/createSignature", params);
  }

  async verifySignature(
    params: VerifySignatureRequest,
  ): Promise<WalletResult<VerifySignatureResponse>> {
    return this.request("POST", "/verifySignature", params);
  }

  // --- Encryption Methods ---

  async encrypt(params: {
    plaintext: string | Uint8Array;
    protocolID: ProtocolID;
    keyID: string;
    counterparty?: Counterparty;
  }): Promise<WalletResult<{ ciphertext: string }>> {
    const body = {
      ...params,
      plaintext:
        params.plaintext instanceof Uint8Array
          ? Buffer.from(params.plaintext).toString("hex")
          : params.plaintext,
    };
    return this.request("POST", "/encrypt", body);
  }

  async decrypt(params: {
    ciphertext: string | Uint8Array;
    protocolID: ProtocolID;
    keyID: string;
    counterparty?: Counterparty;
  }): Promise<WalletResult<{ plaintext: string }>> {
    const body = {
      ...params,
      ciphertext:
        params.ciphertext instanceof Uint8Array
          ? Buffer.from(params.ciphertext).toString("hex")
          : params.ciphertext,
    };
    return this.request("POST", "/decrypt", body);
  }

  // --- Certificate Methods (BRC-52/107/108) ---

  async acquireCertificate(params: {
    type: string;
    certifier: string;
    fields: Record<string, string>;
    acquisitionProtocol?: string;
  }): Promise<WalletResult<{ certificate: Certificate }>> {
    return this.request("POST", "/acquireCertificate", params);
  }

  async listCertificates(params?: {
    types?: string[];
    certifiers?: string[];
  }): Promise<WalletResult<{ certificates: Certificate[] }>> {
    return this.request("POST", "/listCertificates", params ?? {});
  }

  async proveCertificate(params: {
    certificate: Certificate;
    fieldsToReveal: string[];
    verifier: string;
  }): Promise<WalletResult<{ keyLinkageProof: KeyLinkageProof }>> {
    return this.request("POST", "/proveCertificate", params);
  }

  async relinquishCertificate(params: {
    type: string;
    serialNumber: string;
    certifier: string;
  }): Promise<WalletResult<{ relinquished: boolean }>> {
    return this.request("POST", "/relinquishCertificate", params);
  }

  // --- Discovery Methods ---

  async discoverByIdentityKey(params: {
    identityKey: string;
    limit?: number;
  }): Promise<WalletResult<{ results: DiscoveryResult[] }>> {
    return this.request("POST", "/discoverByIdentityKey", params);
  }

  async discoverByAttributes(params: {
    attributes: Record<string, string>;
    limit?: number;
  }): Promise<WalletResult<{ results: DiscoveryResult[] }>> {
    return this.request("POST", "/discoverByAttributes", params);
  }
}

/**
 * In-memory wallet implementation for testing/development
 */
export class MockWallet implements WalletInterface {
  private publicKey: PublicKey;
  private certificates: Certificate[] = [];

  constructor(publicKey: PublicKey) {
    this.publicKey = publicKey;
  }

  async getPublicKey(): Promise<WalletResult<{ publicKey: string }>> {
    return { success: true, result: { publicKey: this.publicKey } };
  }

  async isAuthenticated(): Promise<WalletResult<{ authenticated: boolean }>> {
    return { success: true, result: { authenticated: true } };
  }

  async createSignature(_params: SignatureRequest): Promise<WalletResult<SignatureResponse>> {
    // Mock implementation - returns deterministic fake signature
    const mockSignature = "3045022100mock" + "00".repeat(30);
    return {
      success: true,
      result: { signature: mockSignature, publicKey: this.publicKey },
    };
  }

  async verifySignature(
    _params: VerifySignatureRequest,
  ): Promise<WalletResult<VerifySignatureResponse>> {
    // Mock always returns valid
    return { success: true, result: { valid: true } };
  }

  async encrypt(_params: {
    plaintext: string | Uint8Array;
    protocolID: ProtocolID;
    keyID: string;
    counterparty?: Counterparty;
  }): Promise<WalletResult<{ ciphertext: string }>> {
    return { success: true, result: { ciphertext: "mock_encrypted_data" } };
  }

  async decrypt(_params: {
    ciphertext: string | Uint8Array;
    protocolID: ProtocolID;
    keyID: string;
    counterparty?: Counterparty;
  }): Promise<WalletResult<{ plaintext: string }>> {
    return { success: true, result: { plaintext: "mock_decrypted_data" } };
  }

  async acquireCertificate(params: {
    type: string;
    certifier: string;
    fields: Record<string, string>;
  }): Promise<WalletResult<{ certificate: Certificate }>> {
    const cert: Certificate = {
      type: params.type,
      serialNumber: crypto.randomUUID(),
      certifier: params.certifier,
      subject: this.publicKey,
      fields: params.fields,
      signature: "mock_signature",
      issuedAt: Date.now(),
    };
    this.certificates.push(cert);
    return { success: true, result: { certificate: cert } };
  }

  async listCertificates(params?: {
    types?: string[];
    certifiers?: string[];
  }): Promise<WalletResult<{ certificates: Certificate[] }>> {
    let certs = this.certificates;
    if (params?.types) {
      certs = certs.filter((c) => params.types!.includes(c.type));
    }
    if (params?.certifiers) {
      certs = certs.filter((c) => params.certifiers!.includes(c.certifier));
    }
    return { success: true, result: { certificates: certs } };
  }

  async proveCertificate(params: {
    certificate: Certificate;
    fieldsToReveal: string[];
    verifier: string;
  }): Promise<WalletResult<{ keyLinkageProof: KeyLinkageProof }>> {
    const proof: KeyLinkageProof = {
      proofType: "DLEQ",
      proof: "mock_proof",
      protocolID: [2, "certificate"],
      keyID: params.certificate.serialNumber,
      counterparty: params.verifier,
      derivedPublicKey: this.publicKey,
    };
    return { success: true, result: { keyLinkageProof: proof } };
  }

  async relinquishCertificate(params: {
    type: string;
    serialNumber: string;
  }): Promise<WalletResult<{ relinquished: boolean }>> {
    const idx = this.certificates.findIndex(
      (c) => c.type === params.type && c.serialNumber === params.serialNumber,
    );
    if (idx !== -1) {
      this.certificates.splice(idx, 1);
      return { success: true, result: { relinquished: true } };
    }
    return { success: true, result: { relinquished: false } };
  }

  async discoverByIdentityKey(params: {
    identityKey: string;
  }): Promise<WalletResult<{ results: DiscoveryResult[] }>> {
    if (params.identityKey === this.publicKey) {
      return {
        success: true,
        result: { results: [{ identityKey: this.publicKey, name: "Mock User" }] },
      };
    }
    return { success: true, result: { results: [] } };
  }

  async discoverByAttributes(_params: {
    attributes: Record<string, string>;
  }): Promise<WalletResult<{ results: DiscoveryResult[] }>> {
    return { success: true, result: { results: [] } };
  }
}

/**
 * Create a wallet client from environment or config
 */
export function createWalletClient(configOrUrl?: string | WalletClientConfig): WalletClient {
  if (typeof configOrUrl === "string") {
    return new WalletClient({ baseUrl: configOrUrl });
  }
  if (configOrUrl) {
    return new WalletClient(configOrUrl);
  }
  // Default to environment variable or localhost
  const baseUrl = process.env.BSV_WALLET_URL ?? "http://localhost:3301";
  return new WalletClient({ baseUrl });
}
