/**
 * Local Wallet Implementation
 *
 * Implements WalletInterface (BRC-100) using the local CryptoService.
 * Provides a gateway-local wallet that:
 * - Wraps CryptoService for cryptographic operations
 * - Uses KeyVault for secure key management
 * - Can be used as the gateway's own wallet identity
 *
 * @see ../types/wallet.ts - WalletInterface specification
 * @see ../crypto/crypto-service.ts - Underlying crypto operations
 */

import type { Certificate, KeyLinkageProof } from "../types/certificates.js";
import type { ProtocolID, Counterparty } from "../types/keys.js";
import type {
  SignatureRequest,
  SignatureResponse,
  VerifySignatureRequest,
  VerifySignatureResponse,
} from "../types/signatures.js";
import type { WalletInterface, WalletResult, WalletErrorCode } from "../types/wallet.js";
import type { DiscoveryResult } from "../types/wallet.js";
import { CryptoService, type CryptoServiceConfig } from "../crypto/crypto-service.js";

/**
 * Configuration for LocalWallet
 */
export interface LocalWalletConfig {
  /** CryptoService configuration (optional, uses defaults if not provided) */
  cryptoService?: CryptoServiceConfig;

  /** Root identity private key (hex). If not provided, generates ephemeral key. */
  rootPrivateKey?: string;

  /** TTL for the root key in milliseconds (default: 1 hour) */
  rootKeyTtlMs?: number;
}

/**
 * Local wallet implementation using CryptoService
 *
 * Provides a BRC-100 compliant wallet backed by EdwinPAI's crypto isolation layer.
 *
 * @example
 * ```typescript
 * const wallet = new LocalWallet({
 *   rootPrivateKey: "...", // optional, generates ephemeral if omitted
 * });
 *
 * const pubKeyResult = await wallet.getPublicKey();
 * if (pubKeyResult.success) {
 *   console.log("Wallet identity:", pubKeyResult.result.publicKey);
 * }
 * ```
 */
export class LocalWallet implements WalletInterface {
  private readonly cryptoService: CryptoService;
  private readonly config: Required<LocalWalletConfig>;
  private rootKeyRefId: string | null = null;
  private rootPublicKey: string | null = null;
  private isSealed = false;

  constructor(config: LocalWalletConfig = {}) {
    this.config = {
      cryptoService: config.cryptoService ?? {},
      rootPrivateKey: config.rootPrivateKey ?? "",
      rootKeyTtlMs: config.rootKeyTtlMs ?? 60 * 60 * 1000, // 1 hour
    };

    this.cryptoService = new CryptoService(this.config.cryptoService);
    void this.initializeRootKey();
  }

  /**
   * Initialize the wallet's root identity key
   */
  private async initializeRootKey(): Promise<void> {
    if (this.config.rootPrivateKey) {
      // Import provided key
      const result = await this.cryptoService.execute({
        action: "import-key",
        privateKeyHex: this.config.rootPrivateKey,
        ttlMs: this.config.rootKeyTtlMs,
      });
      if (result.success && result.result) {
        const importResult = result.result as { keyRefId: string; publicKey: string };
        this.rootKeyRefId = importResult.keyRefId;
        this.rootPublicKey = importResult.publicKey;
      }
    } else {
      // Generate ephemeral key
      const result = await this.cryptoService.execute({
        action: "generate-ephemeral",
        ttlMs: this.config.rootKeyTtlMs,
      });
      if (result.success && result.result) {
        const genResult = result.result as { keyRefId: string; publicKey: string };
        this.rootKeyRefId = genResult.keyRefId;
        this.rootPublicKey = genResult.publicKey;
      }
    }
  }

  /**
   * Ensure wallet is initialized and not sealed
   */
  private ensureInitialized(): void {
    if (this.isSealed) {
      throw new Error("Wallet is sealed");
    }
    if (!this.rootKeyRefId || !this.rootPublicKey) {
      throw new Error("Wallet not initialized");
    }
  }

  /**
   * Convert an error to a WalletResult
   */
  private errorResult<T>(
    error: unknown,
    code: WalletErrorCode = "INTERNAL_ERROR",
  ): WalletResult<T> {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      errorCode: code,
    };
  }

  // ==========================================================================
  // Identity Methods
  // ==========================================================================

  async getPublicKey(params?: {
    protocolID?: ProtocolID;
    keyID?: string;
    counterparty?: Counterparty;
    forSelf?: boolean;
  }): Promise<WalletResult<{ publicKey: string }>> {
    try {
      this.ensureInitialized();

      // If no protocol/keyID specified, return root identity key
      if (!params?.protocolID || !params?.keyID) {
        return {
          success: true,
          result: { publicKey: this.rootPublicKey! },
        };
      }

      // Derive child key for the specified protocol/keyID
      const counterpartyPubKey = this.resolveCounterparty(params.counterparty ?? "self");
      const result = await this.cryptoService.execute({
        action: "derive-key",
        keyRefId: this.rootKeyRefId!,
        counterpartyPublicKey: counterpartyPubKey,
        protocolID: params.protocolID,
        keyID: params.keyID,
      });

      if (!result.success || !result.result) {
        return this.errorResult(result.error ?? "Key derivation failed");
      }

      const derivedResult = result.result as { publicKey: string };
      return {
        success: true,
        result: { publicKey: derivedResult.publicKey },
      };
    } catch (error) {
      return this.errorResult(error);
    }
  }

  async isAuthenticated(): Promise<WalletResult<{ authenticated: boolean }>> {
    return {
      success: true,
      result: { authenticated: !this.isSealed && this.rootKeyRefId !== null },
    };
  }

  async waitForAuthentication(params?: {
    timeout?: number;
  }): Promise<WalletResult<{ authenticated: boolean }>> {
    // LocalWallet is always authenticated (or sealed)
    // For compatibility, we just check current status
    const timeout = params?.timeout ?? 5000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      if (!this.isSealed && this.rootKeyRefId !== null) {
        return {
          success: true,
          result: { authenticated: true },
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return {
      success: false,
      error: "Authentication timeout",
      errorCode: "TIMEOUT",
    };
  }

  // ==========================================================================
  // Signing Methods (BRC-3)
  // ==========================================================================

  async createSignature(params: SignatureRequest): Promise<WalletResult<SignatureResponse>> {
    try {
      this.ensureInitialized();

      // Get the key reference to use for signing
      let keyRefId = this.rootKeyRefId!;

      // If protocol/keyID specified, derive child key first
      if (params.protocolID && params.keyID) {
        const counterpartyPubKey = this.resolveCounterparty(params.counterparty ?? "self");
        const deriveResult = await this.cryptoService.execute({
          action: "derive-key",
          keyRefId: this.rootKeyRefId!,
          counterpartyPublicKey: counterpartyPubKey,
          protocolID: params.protocolID,
          keyID: params.keyID,
        });

        if (!deriveResult.success || !deriveResult.result) {
          return this.errorResult(deriveResult.error ?? "Key derivation failed");
        }

        const derived = deriveResult.result as { keyRefId: string };
        keyRefId = derived.keyRefId;
      }

      // Convert data to hash
      const messageHash = this.dataToHash(params.data);

      // Sign the hash
      const signResult = await this.cryptoService.execute({
        action: "sign",
        keyRefId,
        messageHash,
      });

      if (!signResult.success || !signResult.result) {
        return this.errorResult(signResult.error ?? "Signing failed");
      }

      const signed = signResult.result as { signature: string };

      // Get the public key for the key that was used to sign
      const pubKeyResult = await this.cryptoService.execute({
        action: "get-public-key",
        keyRefId,
      });

      if (!pubKeyResult.success || !pubKeyResult.result) {
        return this.errorResult(pubKeyResult.error ?? "Failed to get public key");
      }

      const pubKey = pubKeyResult.result as { publicKey: string };

      return {
        success: true,
        result: {
          signature: signed.signature,
          publicKey: pubKey.publicKey,
        },
      };
    } catch (error) {
      return this.errorResult(error);
    }
  }

  async verifySignature(
    params: VerifySignatureRequest,
  ): Promise<WalletResult<VerifySignatureResponse>> {
    try {
      const messageHash = this.dataToHash(params.data);

      const result = await this.cryptoService.execute({
        action: "verify",
        messageHash,
        signature: params.signature,
        publicKey: params.publicKey,
      });

      if (!result.success) {
        return this.errorResult(result.error ?? "Verification failed");
      }

      const verified = result.result as { valid: boolean };

      return {
        success: true,
        result: { valid: verified.valid },
      };
    } catch (error) {
      return this.errorResult(error);
    }
  }

  // ==========================================================================
  // Encryption Methods
  // ==========================================================================

  async encrypt(params: {
    plaintext: string | Uint8Array;
    protocolID: ProtocolID;
    keyID: string;
    counterparty?: Counterparty;
  }): Promise<WalletResult<{ ciphertext: string }>> {
    try {
      this.ensureInitialized();

      // Derive key for the protocol/keyID
      const counterpartyPubKey = this.resolveCounterparty(params.counterparty ?? "self");
      const deriveResult = await this.cryptoService.execute({
        action: "derive-key",
        keyRefId: this.rootKeyRefId!,
        counterpartyPublicKey: counterpartyPubKey,
        protocolID: params.protocolID,
        keyID: params.keyID,
      });

      if (!deriveResult.success || !deriveResult.result) {
        return this.errorResult(deriveResult.error ?? "Key derivation failed");
      }

      const derived = deriveResult.result as { keyRefId: string };

      // Convert plaintext to hex
      const plaintextHex =
        typeof params.plaintext === "string"
          ? Buffer.from(params.plaintext, "utf-8").toString("hex")
          : Buffer.from(params.plaintext).toString("hex");

      // Encrypt
      const encryptResult = await this.cryptoService.execute({
        action: "encrypt",
        keyRefId: derived.keyRefId,
        plaintextHex,
        recipientPublicKey: counterpartyPubKey,
      });

      if (!encryptResult.success || !encryptResult.result) {
        return this.errorResult(encryptResult.error ?? "Encryption failed");
      }

      const encrypted = encryptResult.result as { ciphertext: string };

      return {
        success: true,
        result: { ciphertext: encrypted.ciphertext },
      };
    } catch (error) {
      return this.errorResult(error);
    }
  }

  async decrypt(params: {
    ciphertext: string | Uint8Array;
    protocolID: ProtocolID;
    keyID: string;
    counterparty?: Counterparty;
  }): Promise<WalletResult<{ plaintext: string }>> {
    try {
      this.ensureInitialized();

      // Derive key for the protocol/keyID
      const counterpartyPubKey = this.resolveCounterparty(params.counterparty ?? "self");
      const deriveResult = await this.cryptoService.execute({
        action: "derive-key",
        keyRefId: this.rootKeyRefId!,
        counterpartyPublicKey: counterpartyPubKey,
        protocolID: params.protocolID,
        keyID: params.keyID,
      });

      if (!deriveResult.success || !deriveResult.result) {
        return this.errorResult(deriveResult.error ?? "Key derivation failed");
      }

      const derived = deriveResult.result as { keyRefId: string };

      // Convert ciphertext to hex if needed
      const ciphertextHex =
        typeof params.ciphertext === "string"
          ? params.ciphertext
          : Buffer.from(params.ciphertext).toString("hex");

      // Decrypt
      const decryptResult = await this.cryptoService.execute({
        action: "decrypt",
        keyRefId: derived.keyRefId,
        ciphertextHex,
        senderPublicKey: counterpartyPubKey,
      });

      if (!decryptResult.success || !decryptResult.result) {
        return this.errorResult(decryptResult.error ?? "Decryption failed");
      }

      const decrypted = decryptResult.result as { plaintext: string };

      // Convert hex back to UTF-8 string
      const plaintext = Buffer.from(decrypted.plaintext, "hex").toString("utf-8");

      return {
        success: true,
        result: { plaintext },
      };
    } catch (error) {
      return this.errorResult(error);
    }
  }

  // ==========================================================================
  // Certificate Methods (BRC-52/107/108)
  // ==========================================================================

  async acquireCertificate(_params: {
    type: string;
    certifier: string;
    fields: Record<string, string>;
    acquisitionProtocol?: string;
  }): Promise<WalletResult<{ certificate: Certificate }>> {
    return {
      success: false,
      error: "Certificate acquisition not implemented in LocalWallet",
      errorCode: "NOT_IMPLEMENTED",
    };
  }

  async listCertificates(_params?: {
    types?: string[];
    certifiers?: string[];
  }): Promise<WalletResult<{ certificates: Certificate[] }>> {
    return {
      success: true,
      result: { certificates: [] },
    };
  }

  async proveCertificate(_params: {
    certificate: Certificate;
    fieldsToReveal: string[];
    verifier: string;
  }): Promise<WalletResult<{ keyLinkageProof: KeyLinkageProof }>> {
    return {
      success: false,
      error: "Certificate proving not implemented in LocalWallet",
      errorCode: "NOT_IMPLEMENTED",
    };
  }

  async relinquishCertificate(_params: {
    type: string;
    serialNumber: string;
    certifier: string;
  }): Promise<WalletResult<{ relinquished: boolean }>> {
    return {
      success: false,
      error: "Certificate relinquishment not implemented in LocalWallet",
      errorCode: "NOT_IMPLEMENTED",
    };
  }

  // ==========================================================================
  // Discovery Methods
  // ==========================================================================

  async discoverByIdentityKey(params: {
    identityKey: string;
    limit?: number;
  }): Promise<WalletResult<{ results: DiscoveryResult[] }>> {
    // Simple local discovery - only knows about self
    if (params.identityKey === this.rootPublicKey) {
      return {
        success: true,
        result: {
          results: [
            {
              identityKey: this.rootPublicKey,
              name: "LocalWallet",
              source: "local",
              confidence: 1.0,
            },
          ],
        },
      };
    }

    return {
      success: true,
      result: { results: [] },
    };
  }

  async discoverByAttributes(_params: {
    attributes: Record<string, string>;
    limit?: number;
  }): Promise<WalletResult<{ results: DiscoveryResult[] }>> {
    return {
      success: true,
      result: { results: [] },
    };
  }

  // ==========================================================================
  // Wallet Management
  // ==========================================================================

  /**
   * Seal the wallet and wipe all keys
   */
  seal(): void {
    this.cryptoService.seal();
    this.isSealed = true;
    this.rootKeyRefId = null;
    this.rootPublicKey = null;
  }

  /**
   * Get the wallet's root public key
   */
  getRootPublicKey(): string | null {
    return this.rootPublicKey;
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Resolve counterparty to public key
   */
  private resolveCounterparty(counterparty: Counterparty): string {
    if (counterparty === "self") {
      return this.rootPublicKey!;
    }
    if (counterparty === "anyone") {
      // Use a deterministic "anyone" public key
      return "020000000000000000000000000000000000000000000000000000000000000001";
    }
    return counterparty;
  }

  /**
   * Convert data to SHA-256 hash
   */
  private dataToHash(data: string | Uint8Array): string {
    const crypto = require("node:crypto");
    const buffer = typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data);
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }
}
