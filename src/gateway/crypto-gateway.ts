/**
 * Crypto Gateway - Gateway-Level Crypto Resource Management
 *
 * Manages the gateway-level cryptographic resources:
 * - CryptoService for all crypto operations
 * - RequestAuthorizer for authentication
 * - Response encryption/decryption
 *
 * This is the integration point between the HTTP gateway and the
 * crypto isolation boundary.
 *
 * @see SECURITY-MITIGATIONS-v2.md
 */

import { RequestAuthorizer, type RequestAuthorizerConfig } from "../auth/request-authorizer.js";
import { TimingMonitor, type TimingMonitorConfig } from "../auth/timing-monitor.js";
import { CryptoService, type CryptoServiceConfig } from "../crypto/crypto-service.js";

/**
 * Configuration for CryptoGateway
 */
export interface CryptoGatewayConfig {
  /** CryptoService configuration */
  cryptoService?: CryptoServiceConfig;
  /** RequestAuthorizer configuration */
  requestAuthorizer?: RequestAuthorizerConfig;
  /** TimingMonitor configuration */
  timingMonitor?: TimingMonitorConfig;
  /** Gateway identity private key (hex) - optional, generates ephemeral if not provided */
  gatewayPrivateKeyHex?: string;
  /** TTL for gateway identity key in ms (default: 1 hour) */
  gatewayKeyTtlMs?: number;
}

/**
 * Health check result
 */
export interface CryptoGatewayHealth {
  /** Overall status */
  status: "ok" | "degraded" | "error";
  /** Detailed component status */
  details: {
    cryptoService: {
      status: "ok" | "error";
      keyCount: number;
      sealed: boolean;
    };
    requestAuthorizer: {
      status: "ok" | "error";
      nonceCount: number;
      knownIdentities: number;
    };
    timingMonitor: {
      status: "ok" | "error";
      trackedIdentities: number;
      lockedOutIdentities: number;
    };
  };
  /** Timestamp of health check */
  timestamp: number;
}

/**
 * Crypto Gateway - Central crypto resource manager for the gateway
 *
 * Provides a unified interface for:
 * - Request authorization with timing analysis
 * - Response encryption for specific identities
 * - Request body decryption
 * - Clean shutdown with key wiping
 *
 * @example
 * ```typescript
 * const gateway = new CryptoGateway();
 *
 * // Get shared components
 * const cryptoService = gateway.getCryptoService();
 * const authorizer = gateway.getRequestAuthorizer();
 *
 * // Encrypt a response for a client
 * const encryptedResponse = await gateway.encryptResponse(
 *   responseData,
 *   clientIdentityKey
 * );
 *
 * // Clean shutdown
 * gateway.shutdown();
 * ```
 */
export class CryptoGateway {
  private readonly cryptoService: CryptoService;
  private readonly requestAuthorizer: RequestAuthorizer;
  private readonly timingMonitor: TimingMonitor;
  private readonly config: Required<CryptoGatewayConfig>;
  private gatewayKeyRefId: string | null = null;
  private gatewayPublicKey: string | null = null;
  private isShutdown: boolean = false;

  /**
   * Create a new CryptoGateway
   *
   * @param config - Gateway configuration
   */
  constructor(config: CryptoGatewayConfig = {}) {
    this.config = {
      cryptoService: config.cryptoService ?? {},
      requestAuthorizer: config.requestAuthorizer ?? {},
      timingMonitor: config.timingMonitor ?? {},
      gatewayPrivateKeyHex: config.gatewayPrivateKeyHex ?? "",
      gatewayKeyTtlMs: config.gatewayKeyTtlMs ?? 60 * 60 * 1000, // 1 hour
    };

    // Initialize crypto service
    this.cryptoService = new CryptoService(this.config.cryptoService);

    // Initialize timing monitor
    this.timingMonitor = new TimingMonitor(this.config.timingMonitor);

    // Initialize request authorizer with timing monitor
    this.requestAuthorizer = new RequestAuthorizer({
      ...this.config.requestAuthorizer,
      enableTimingMonitor: true,
      timingMonitor: this.timingMonitor,
    });

    // Initialize gateway identity key
    void this.initializeGatewayKey();
  }

  /**
   * Initialize the gateway's identity key
   */
  private async initializeGatewayKey(): Promise<void> {
    if (this.config.gatewayPrivateKeyHex) {
      // Import provided key
      const result = await this.cryptoService.execute({
        action: "import-key",
        privateKeyHex: this.config.gatewayPrivateKeyHex,
        ttlMs: this.config.gatewayKeyTtlMs,
      });
      if (result.success && result.result) {
        const importResult = result.result as { keyRefId: string; publicKey: string };
        this.gatewayKeyRefId = importResult.keyRefId;
        this.gatewayPublicKey = importResult.publicKey;
      }
    } else {
      // Generate ephemeral key
      const result = await this.cryptoService.execute({
        action: "generate-ephemeral",
        ttlMs: this.config.gatewayKeyTtlMs,
      });
      if (result.success && result.result) {
        const genResult = result.result as { keyRefId: string; publicKey: string };
        this.gatewayKeyRefId = genResult.keyRefId;
        this.gatewayPublicKey = genResult.publicKey;
      }
    }
  }

  /**
   * Get the shared CryptoService instance
   */
  getCryptoService(): CryptoService {
    this.ensureNotShutdown();
    return this.cryptoService;
  }

  /**
   * Get the shared RequestAuthorizer instance
   */
  getRequestAuthorizer(): RequestAuthorizer {
    this.ensureNotShutdown();
    return this.requestAuthorizer;
  }

  /**
   * Get the shared TimingMonitor instance
   */
  getTimingMonitor(): TimingMonitor {
    this.ensureNotShutdown();
    return this.timingMonitor;
  }

  /**
   * Get the gateway's public key
   */
  getGatewayPublicKey(): string | null {
    return this.gatewayPublicKey;
  }

  /**
   * Encrypt a response for a specific identity
   *
   * Uses ECIES encryption with the gateway as sender and the
   * specified identity as recipient.
   *
   * @param data - Data to encrypt
   * @param recipientIdentityKey - Recipient's public key (hex)
   * @returns Encrypted data as Buffer
   */
  async encryptResponse(data: Buffer, recipientIdentityKey: string): Promise<Buffer> {
    this.ensureNotShutdown();

    if (!this.gatewayKeyRefId) {
      throw new Error("Gateway key not initialized");
    }

    const result = await this.cryptoService.execute({
      action: "encrypt",
      keyRefId: this.gatewayKeyRefId,
      plaintextHex: data.toString("hex"),
      recipientPublicKey: recipientIdentityKey,
    });

    if (!result.success || !result.result) {
      throw new Error(`Encryption failed: ${result.error ?? "Unknown error"}`);
    }

    const encryptResult = result.result as { ciphertext: string };
    return Buffer.from(encryptResult.ciphertext, "hex");
  }

  /**
   * Decrypt an incoming encrypted request body
   *
   * Uses ECIES decryption with the gateway as recipient and the
   * specified identity as sender.
   *
   * @param data - Encrypted data
   * @param senderIdentityKey - Sender's public key (hex)
   * @returns Decrypted data as Buffer
   */
  async decryptRequest(data: Buffer, senderIdentityKey: string): Promise<Buffer> {
    this.ensureNotShutdown();

    if (!this.gatewayKeyRefId) {
      throw new Error("Gateway key not initialized");
    }

    const result = await this.cryptoService.execute({
      action: "decrypt",
      keyRefId: this.gatewayKeyRefId,
      ciphertextHex: data.toString("hex"),
      senderPublicKey: senderIdentityKey,
    });

    if (!result.success || !result.result) {
      throw new Error(`Decryption failed: ${result.error ?? "Unknown error"}`);
    }

    const decryptResult = result.result as { plaintext: string };
    return Buffer.from(decryptResult.plaintext, "hex");
  }

  /**
   * Shutdown the gateway cleanly
   *
   * - Wipes all keys from the vault
   * - Stops the request authorizer cleanup timer
   * - Seals the crypto service
   */
  shutdown(): void {
    if (this.isShutdown) {
      return;
    }

    // Stop request authorizer
    this.requestAuthorizer.stop();

    // Seal crypto service (wipes all keys)
    this.cryptoService.seal();

    // Clear gateway key references
    this.gatewayKeyRefId = null;
    this.gatewayPublicKey = null;

    this.isShutdown = true;
  }

  /**
   * Check gateway health
   *
   * @returns Health check result
   */
  health(): CryptoGatewayHealth {
    const timestamp = Date.now();

    if (this.isShutdown) {
      return {
        status: "error",
        details: {
          cryptoService: { status: "error", keyCount: 0, sealed: true },
          requestAuthorizer: { status: "error", nonceCount: 0, knownIdentities: 0 },
          timingMonitor: { status: "error", trackedIdentities: 0, lockedOutIdentities: 0 },
        },
        timestamp,
      };
    }

    try {
      const vaultStats = this.cryptoService.getVaultStats();
      const timingStats = this.timingMonitor.getStats();

      const cryptoServiceStatus = {
        status: "ok" as const,
        keyCount: vaultStats.keyCount,
        sealed: false,
      };

      const requestAuthorizerStatus = {
        status: "ok" as const,
        nonceCount: this.requestAuthorizer.getNonceCount(),
        knownIdentities: 0, // RequestAuthorizer doesn't expose this directly
      };

      const timingMonitorStatus = {
        status: "ok" as const,
        trackedIdentities: timingStats.trackedIdentities,
        lockedOutIdentities: timingStats.lockedOutIdentities,
      };

      // Determine overall status
      let status: "ok" | "degraded" | "error" = "ok";
      if (timingStats.lockedOutIdentities > 0) {
        status = "degraded"; // Some identities are locked out
      }

      return {
        status,
        details: {
          cryptoService: cryptoServiceStatus,
          requestAuthorizer: requestAuthorizerStatus,
          timingMonitor: timingMonitorStatus,
        },
        timestamp,
      };
    } catch {
      return {
        status: "error",
        details: {
          cryptoService: { status: "error", keyCount: 0, sealed: true },
          requestAuthorizer: { status: "error", nonceCount: 0, knownIdentities: 0 },
          timingMonitor: { status: "error", trackedIdentities: 0, lockedOutIdentities: 0 },
        },
        timestamp,
      };
    }
  }

  /**
   * Register a known identity with the authorizer
   *
   * @param publicKey - Identity public key
   * @param metadata - Optional metadata
   */
  registerIdentity(publicKey: string, metadata?: { name?: string; trustLevel?: number }): void {
    this.ensureNotShutdown();
    this.requestAuthorizer.registerIdentity(publicKey, metadata);
  }

  /**
   * Check if the gateway is shutdown
   */
  isGatewayShutdown(): boolean {
    return this.isShutdown;
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  private ensureNotShutdown(): void {
    if (this.isShutdown) {
      throw new Error("CryptoGateway has been shutdown");
    }
  }
}

// =============================================================================
// Singleton management for gateway integration
// =============================================================================

let sharedCryptoGateway: CryptoGateway | null = null;

/**
 * Get or create the shared CryptoGateway instance
 */
export function getCryptoGateway(config?: CryptoGatewayConfig): CryptoGateway {
  if (!sharedCryptoGateway) {
    sharedCryptoGateway = new CryptoGateway(config);
  }
  return sharedCryptoGateway;
}

/**
 * Reset the shared CryptoGateway (for testing)
 */
export function resetCryptoGateway(): void {
  if (sharedCryptoGateway) {
    sharedCryptoGateway.shutdown();
    sharedCryptoGateway = null;
  }
}

/**
 * Shutdown the shared CryptoGateway
 */
export function shutdownCryptoGateway(): void {
  if (sharedCryptoGateway) {
    sharedCryptoGateway.shutdown();
  }
}
