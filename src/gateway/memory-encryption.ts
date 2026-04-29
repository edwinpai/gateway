/**
 * Memory Encryption - Encrypt Memories at Rest
 *
 * Provides encryption for user memories before storage using
 * per-user derived keys through the CryptoService.
 *
 * Features:
 * - ECIES encryption with user-specific derived keys
 * - Key ID tracking for rotation support
 * - Batch operations for efficiency
 * - Version field for future format upgrades
 *
 * @see SECURITY-MITIGATIONS-v2.md
 */

import { createHash } from "node:crypto";
import { CryptoService } from "../crypto/crypto-service.js";

/**
 * Encrypted memory structure
 */
export interface EncryptedMemory {
  /** Format version for future compatibility */
  version: number;
  /** Encrypted content as hex string */
  ciphertext: string;
  /** Key ID used for encryption (for key rotation tracking) */
  keyId: string;
  /** UTC timestamp when encrypted */
  encryptedAt: number;
}

/**
 * Memory encryption configuration
 */
export interface MemoryEncryptionConfig {
  /** Protocol ID for key derivation (default: [2, "memory-encryption"]) */
  protocolId?: [0 | 1 | 2, string];
  /** TTL for derived keys in ms (default: 5 minutes) */
  keyTtlMs?: number;
}

/**
 * Current encryption format version
 */
const CURRENT_VERSION = 1;

/**
 * Default protocol ID for memory encryption
 */
const DEFAULT_PROTOCOL_ID: [0 | 1 | 2, string] = [2, "memory-encryption"];

/**
 * Default key TTL (5 minutes)
 */
const DEFAULT_KEY_TTL_MS = 5 * 60 * 1000;

/**
 * Memory Encryption Service
 *
 * Encrypts and decrypts memories using per-user derived keys.
 * All crypto operations go through the CryptoService boundary.
 *
 * @example
 * ```typescript
 * const cryptoService = new CryptoService();
 * const memoryEncryption = new MemoryEncryption(cryptoService);
 *
 * // Encrypt a memory
 * const encrypted = await memoryEncryption.encryptMemory(
 *   "User prefers dark mode",
 *   userIdentityKey
 * );
 *
 * // Store encrypted memory...
 *
 * // Later, decrypt
 * const plaintext = await memoryEncryption.decryptMemory(
 *   encrypted,
 *   userIdentityKey
 * );
 * ```
 */
export class MemoryEncryption {
  private readonly cryptoService: CryptoService;
  private readonly config: Required<MemoryEncryptionConfig>;

  // Cache of derived key references by identity
  private readonly keyCache: Map<string, { keyRefId: string; expiresAt: number }> = new Map();

  /**
   * Create a new MemoryEncryption instance
   *
   * @param cryptoService - CryptoService for crypto operations
   * @param config - Optional configuration
   */
  constructor(cryptoService: CryptoService, config: MemoryEncryptionConfig = {}) {
    this.cryptoService = cryptoService;
    this.config = {
      protocolId: config.protocolId ?? DEFAULT_PROTOCOL_ID,
      keyTtlMs: config.keyTtlMs ?? DEFAULT_KEY_TTL_MS,
    };
  }

  /**
   * Encrypt a memory for a user
   *
   * @param content - Memory content to encrypt
   * @param userIdentityKey - User's identity public key (hex)
   * @returns Encrypted memory structure
   */
  async encryptMemory(content: string, userIdentityKey: string): Promise<EncryptedMemory> {
    // Get or derive encryption key for this user
    const { keyRefId, keyId } = await this.getOrDeriveKey(userIdentityKey);

    // Get the derived key's public key for self-encryption
    const pubKeyResult = await this.cryptoService.execute({
      action: "get-public-key",
      keyRefId,
    });

    if (!pubKeyResult.success || !pubKeyResult.result) {
      throw new Error(`Failed to get public key: ${pubKeyResult.error}`);
    }

    const derivedPublicKey = (pubKeyResult.result as { publicKey: string }).publicKey;

    // Encrypt the content
    const plaintextHex = Buffer.from(content, "utf-8").toString("hex");
    const encryptResult = await this.cryptoService.execute({
      action: "encrypt",
      keyRefId,
      plaintextHex,
      recipientPublicKey: derivedPublicKey,
    });

    if (!encryptResult.success || !encryptResult.result) {
      throw new Error(`Encryption failed: ${encryptResult.error}`);
    }

    return {
      version: CURRENT_VERSION,
      ciphertext: (encryptResult.result as { ciphertext: string }).ciphertext,
      keyId,
      encryptedAt: Date.now(),
    };
  }

  /**
   * Decrypt a memory for a user
   *
   * @param encrypted - Encrypted memory structure
   * @param userIdentityKey - User's identity public key (hex)
   * @returns Decrypted memory content
   */
  async decryptMemory(encrypted: EncryptedMemory, userIdentityKey: string): Promise<string> {
    // Validate version
    if (encrypted.version !== CURRENT_VERSION) {
      throw new Error(`Unsupported encryption version: ${encrypted.version}`);
    }

    // Get or derive decryption key for this user
    const { keyRefId } = await this.getOrDeriveKey(userIdentityKey);

    // Get the derived key's public key (sender = recipient for self-encryption)
    const pubKeyResult = await this.cryptoService.execute({
      action: "get-public-key",
      keyRefId,
    });

    if (!pubKeyResult.success || !pubKeyResult.result) {
      throw new Error(`Failed to get public key: ${pubKeyResult.error}`);
    }

    const derivedPublicKey = (pubKeyResult.result as { publicKey: string }).publicKey;

    // Decrypt the content
    const decryptResult = await this.cryptoService.execute({
      action: "decrypt",
      keyRefId,
      ciphertextHex: encrypted.ciphertext,
      senderPublicKey: derivedPublicKey,
    });

    if (!decryptResult.success || !decryptResult.result) {
      throw new Error(`Decryption failed: ${decryptResult.error}`);
    }

    const plaintextHex = (decryptResult.result as { plaintext: string }).plaintext;
    return Buffer.from(plaintextHex, "hex").toString("utf-8");
  }

  /**
   * Encrypt multiple memories for a user
   *
   * More efficient than calling encryptMemory repeatedly as it
   * reuses the derived key.
   *
   * @param memories - Array of memory contents
   * @param userIdentityKey - User's identity public key (hex)
   * @returns Array of encrypted memories
   */
  async encryptBatch(memories: string[], userIdentityKey: string): Promise<EncryptedMemory[]> {
    if (memories.length === 0) {
      return [];
    }

    // Get or derive encryption key for this user
    const { keyRefId, keyId } = await this.getOrDeriveKey(userIdentityKey);

    // Get the derived key's public key
    const pubKeyResult = await this.cryptoService.execute({
      action: "get-public-key",
      keyRefId,
    });

    if (!pubKeyResult.success || !pubKeyResult.result) {
      throw new Error(`Failed to get public key: ${pubKeyResult.error}`);
    }

    const derivedPublicKey = (pubKeyResult.result as { publicKey: string }).publicKey;
    const encryptedAt = Date.now();

    // Encrypt all memories
    const results: EncryptedMemory[] = [];

    for (const content of memories) {
      const plaintextHex = Buffer.from(content, "utf-8").toString("hex");
      const encryptResult = await this.cryptoService.execute({
        action: "encrypt",
        keyRefId,
        plaintextHex,
        recipientPublicKey: derivedPublicKey,
      });

      if (!encryptResult.success || !encryptResult.result) {
        throw new Error(`Batch encryption failed: ${encryptResult.error}`);
      }

      results.push({
        version: CURRENT_VERSION,
        ciphertext: (encryptResult.result as { ciphertext: string }).ciphertext,
        keyId,
        encryptedAt,
      });
    }

    return results;
  }

  /**
   * Decrypt multiple memories for a user
   *
   * More efficient than calling decryptMemory repeatedly as it
   * reuses the derived key.
   *
   * @param encrypted - Array of encrypted memories
   * @param userIdentityKey - User's identity public key (hex)
   * @returns Array of decrypted memory contents
   */
  async decryptBatch(encrypted: EncryptedMemory[], userIdentityKey: string): Promise<string[]> {
    if (encrypted.length === 0) {
      return [];
    }

    // Validate all versions
    for (const enc of encrypted) {
      if (enc.version !== CURRENT_VERSION) {
        throw new Error(`Unsupported encryption version: ${enc.version}`);
      }
    }

    // Get or derive decryption key for this user
    const { keyRefId } = await this.getOrDeriveKey(userIdentityKey);

    // Get the derived key's public key
    const pubKeyResult = await this.cryptoService.execute({
      action: "get-public-key",
      keyRefId,
    });

    if (!pubKeyResult.success || !pubKeyResult.result) {
      throw new Error(`Failed to get public key: ${pubKeyResult.error}`);
    }

    const derivedPublicKey = (pubKeyResult.result as { publicKey: string }).publicKey;

    // Decrypt all memories
    const results: string[] = [];

    for (const enc of encrypted) {
      const decryptResult = await this.cryptoService.execute({
        action: "decrypt",
        keyRefId,
        ciphertextHex: enc.ciphertext,
        senderPublicKey: derivedPublicKey,
      });

      if (!decryptResult.success || !decryptResult.result) {
        throw new Error(`Batch decryption failed: ${decryptResult.error}`);
      }

      const plaintextHex = (decryptResult.result as { plaintext: string }).plaintext;
      results.push(Buffer.from(plaintextHex, "hex").toString("utf-8"));
    }

    return results;
  }

  /**
   * Clear the key cache
   *
   * Call this when keys need to be rotated or for cleanup.
   */
  clearKeyCache(): void {
    this.keyCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { cachedKeys: number; expiredKeys: number } {
    const now = Date.now();
    let expiredKeys = 0;

    for (const entry of this.keyCache.values()) {
      if (now > entry.expiresAt) {
        expiredKeys++;
      }
    }

    return {
      cachedKeys: this.keyCache.size,
      expiredKeys,
    };
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Get or derive an encryption key for a user
   */
  private async getOrDeriveKey(
    userIdentityKey: string,
  ): Promise<{ keyRefId: string; keyId: string }> {
    // Check cache
    const cached = this.keyCache.get(userIdentityKey);
    if (cached && Date.now() < cached.expiresAt) {
      // Derive key ID from user identity for tracking
      const keyId = this.deriveKeyId(userIdentityKey);
      return { keyRefId: cached.keyRefId, keyId };
    }

    // Generate a new ephemeral key first
    const genResult = await this.cryptoService.execute({
      action: "generate-ephemeral",
      ttlMs: this.config.keyTtlMs,
    });

    if (!genResult.success || !genResult.result) {
      throw new Error(`Failed to generate ephemeral key: ${genResult.error}`);
    }

    const parentKeyRefId = (genResult.result as { keyRefId: string }).keyRefId;

    // Derive a child key for this user
    const keyId = this.deriveKeyId(userIdentityKey);
    const deriveResult = await this.cryptoService.execute({
      action: "derive-key",
      keyRefId: parentKeyRefId,
      counterpartyPublicKey: userIdentityKey,
      protocolID: this.config.protocolId,
      keyID: keyId,
    });

    if (!deriveResult.success || !deriveResult.result) {
      throw new Error(`Failed to derive key: ${deriveResult.error}`);
    }

    const derivedKeyRefId = (deriveResult.result as { keyRefId: string }).keyRefId;

    // Cache the derived key
    this.keyCache.set(userIdentityKey, {
      keyRefId: derivedKeyRefId,
      expiresAt: Date.now() + this.config.keyTtlMs - 10000, // Expire slightly early
    });

    // Cleanup expired cache entries
    this.cleanupExpiredCache();

    return { keyRefId: derivedKeyRefId, keyId };
  }

  /**
   * Derive a key ID from user identity
   */
  private deriveKeyId(userIdentityKey: string): string {
    // Use first 16 bytes of SHA-256 hash as key ID
    const hash = createHash("sha256").update(userIdentityKey).update("memory-key-id").digest("hex");
    return hash.substring(0, 32);
  }

  /**
   * Cleanup expired cache entries
   */
  private cleanupExpiredCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.keyCache) {
      if (now > entry.expiresAt) {
        this.keyCache.delete(key);
      }
    }
  }
}
