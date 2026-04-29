/**
 * Key Vault - TTL-Based Ephemeral Key Storage
 *
 * Provides secure in-memory storage for private keys with:
 * - Reference-based access (never return private keys)
 * - TTL-based automatic expiration
 * - Secure key wiping (zero-fill buffers)
 * - Usage tracking and statistics
 *
 * This is a lower-level component than SecureVault, focused specifically
 * on ephemeral key management with TTL semantics.
 *
 * @see SECURITY-MITIGATIONS-v2.md - Mitigation 1.1
 */

import type { ECIESCiphertext } from "./ecies.js";
import { BSVCrypto, SecurePrivateKey, SecurePublicKey } from "./bsv-sdk-wrapper.js";
import { decrypt as eciesDecrypt, encrypt as eciesEncrypt } from "./ecies.js";

/**
 * Default TTL for stored keys (5 minutes)
 */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Minimum allowed TTL (10 seconds)
 */
const MIN_TTL_MS = 10 * 1000;

/**
 * Maximum allowed TTL (1 hour)
 */
const MAX_TTL_MS = 60 * 60 * 1000;

/**
 * Key vault error codes
 */
export type KeyVaultErrorCode =
  | "KEY_NOT_FOUND"
  | "KEY_EXPIRED"
  | "INVALID_TTL"
  | "INVALID_KEY_MATERIAL"
  | "OPERATION_FAILED"
  | "VAULT_SEALED";

/**
 * Key vault error
 */
export class KeyVaultError extends Error {
  readonly code: KeyVaultErrorCode;
  readonly httpCode: number;

  constructor(code: KeyVaultErrorCode, message: string, httpCode: number = 400) {
    // NEVER include key material in error messages
    super(message);
    this.name = "KeyVaultError";
    this.code = code;
    this.httpCode = httpCode;
  }
}

/**
 * Internal storage entry for a key
 */
interface VaultEntry {
  /** The actual private key buffer (will be zero-filled on wipe) */
  keyBuffer: Buffer;
  /** Public key (safe to expose) */
  publicKey: SecurePublicKey;
  /** When this key was stored */
  storedAt: number;
  /** When this key expires */
  expiresAt: number;
  /** Number of operations performed with this key */
  usageCount: number;
  /** Last time the key was used */
  lastUsedAt: number;
  /** Timer for auto-expiration */
  expirationTimer: ReturnType<typeof setTimeout>;
}

/**
 * Statistics about the vault (no key material)
 */
export interface VaultStats {
  /** Number of keys currently stored */
  keyCount: number;
  /** Total number of keys ever stored in this session */
  totalKeysStored: number;
  /** Total number of keys that have expired */
  totalKeysExpired: number;
  /** Total number of keys manually wiped */
  totalKeysWiped: number;
  /** Timestamp of the oldest key (if any) */
  oldestKeyTimestamp: number | null;
  /** Timestamp of the newest key (if any) */
  newestKeyTimestamp: number | null;
  /** Average key TTL in milliseconds */
  averageTtlMs: number;
}

/**
 * Key Vault - Secure ephemeral key storage
 *
 * Stores private keys with reference IDs. The AI layer only sees the reference ID,
 * never the actual key material. Operations like signing and decryption happen
 * inside the vault boundary.
 *
 * @example
 * ```typescript
 * const vault = new KeyVault();
 *
 * // Store a key (returns opaque reference)
 * const refId = vault.store(privateKey, 60000); // 1 minute TTL
 *
 * // Sign using the stored key (vault holds the key, not the caller)
 * const signature = vault.sign(refId, messageHash);
 *
 * // Get public key (safe to expose)
 * const pubKey = vault.getPublicKey(refId);
 *
 * // Key auto-expires after TTL, or manually wipe
 * vault.wipe(refId);
 * ```
 */
export class KeyVault {
  private readonly keys: Map<string, VaultEntry> = new Map();
  private totalKeysStored: number = 0;
  private totalKeysExpired: number = 0;
  private totalKeysWiped: number = 0;
  private sealed: boolean = false;

  /**
   * Create a new KeyVault
   */

  /**
   * Store a private key in the vault
   *
   * @param key - Private key to store
   * @param ttlMs - Time-to-live in milliseconds (default: 5 minutes)
   * @returns Opaque reference ID (UUID)
   * @throws KeyVaultError if TTL is invalid
   */
  store(key: SecurePrivateKey, ttlMs: number = DEFAULT_TTL_MS): string {
    this.ensureNotSealed();

    // Validate TTL
    if (ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS) {
      throw new KeyVaultError(
        "INVALID_TTL",
        `TTL must be between ${MIN_TTL_MS}ms and ${MAX_TTL_MS}ms`,
      );
    }

    // Generate reference ID
    const refId = crypto.randomUUID();

    // Get key material and public key
    const keyBuffer = Buffer.from(key.toHex(), "hex");
    const publicKey = key.toPublicKey();

    const now = Date.now();
    const expiresAt = now + ttlMs;

    // Set up auto-expiration timer
    const expirationTimer = setTimeout(() => {
      this.handleExpiration(refId);
    }, ttlMs);

    // Store entry
    const entry: VaultEntry = {
      keyBuffer,
      publicKey,
      storedAt: now,
      expiresAt,
      usageCount: 0,
      lastUsedAt: now,
      expirationTimer,
    };

    this.keys.set(refId, entry);
    this.totalKeysStored++;

    return refId;
  }

  /**
   * Store a private key from hex string
   *
   * @param keyHex - Private key as 64-character hex string
   * @param ttlMs - Time-to-live in milliseconds
   * @returns Opaque reference ID
   */
  storeFromHex(keyHex: string, ttlMs: number = DEFAULT_TTL_MS): string {
    this.ensureNotSealed();

    try {
      const key = BSVCrypto.privateKeyFromHex(keyHex);
      return this.store(key, ttlMs);
    } catch {
      throw new KeyVaultError("INVALID_KEY_MATERIAL", "Invalid private key format");
    }
  }

  /**
   * Sign a message hash using a stored key
   *
   * Uses RFC 6979 deterministic signatures.
   *
   * @param refId - Key reference ID
   * @param messageHash - SHA-256 hash (32 bytes) as Buffer
   * @returns DER-encoded signature as Buffer
   * @throws KeyVaultError if key not found or expired
   */
  sign(refId: string, messageHash: Buffer): Buffer {
    this.ensureNotSealed();

    const entry = this.getEntry(refId);
    const hashHex = messageHash.toString("hex");

    // Validate message hash format
    if (messageHash.length !== 32) {
      throw new KeyVaultError("OPERATION_FAILED", "Message hash must be 32 bytes");
    }

    try {
      // Reconstruct SecurePrivateKey and sign
      const privateKey = SecurePrivateKey.fromHex(entry.keyBuffer.toString("hex"));
      const signature = BSVCrypto.sign(privateKey, hashHex);

      this.recordUsage(refId);
      return signature;
    } catch {
      throw new KeyVaultError("OPERATION_FAILED", "Signing operation failed");
    }
  }

  /**
   * Decrypt ciphertext using a stored key
   *
   * @param refId - Key reference ID
   * @param ciphertext - ECIES ciphertext structure
   * @param senderPublicKey - Sender's public key
   * @returns Decrypted plaintext as Buffer
   * @throws KeyVaultError if key not found, expired, or decryption fails
   */
  decrypt(refId: string, ciphertext: ECIESCiphertext, senderPublicKey: SecurePublicKey): Buffer {
    this.ensureNotSealed();

    const entry = this.getEntry(refId);

    try {
      // Reconstruct SecurePrivateKey and decrypt
      const privateKey = SecurePrivateKey.fromHex(entry.keyBuffer.toString("hex"));
      const plaintext = eciesDecrypt(ciphertext, privateKey, senderPublicKey);

      this.recordUsage(refId);
      return plaintext;
    } catch {
      throw new KeyVaultError("OPERATION_FAILED", "Decryption failed");
    }
  }

  /**
   * Encrypt plaintext using a stored key
   *
   * @param refId - Key reference ID (sender's key)
   * @param plaintext - Data to encrypt
   * @param recipientPublicKey - Recipient's public key
   * @returns ECIES ciphertext structure
   * @throws KeyVaultError if key not found, expired, or encryption fails
   */
  encrypt(refId: string, plaintext: Buffer, recipientPublicKey: SecurePublicKey): ECIESCiphertext {
    this.ensureNotSealed();

    const entry = this.getEntry(refId);

    try {
      // Reconstruct SecurePrivateKey and encrypt
      const privateKey = SecurePrivateKey.fromHex(entry.keyBuffer.toString("hex"));
      const ciphertext = eciesEncrypt(plaintext, privateKey, recipientPublicKey);

      this.recordUsage(refId);
      return ciphertext;
    } catch {
      throw new KeyVaultError("OPERATION_FAILED", "Encryption failed");
    }
  }

  /**
   * Derive a child key using BRC-42 derivation
   *
   * @param refId - Parent key reference ID
   * @param counterpartyPublicKey - Counterparty's public key
   * @param invoiceNumber - BRC-43 invoice number
   * @param ttlMs - TTL for the derived key
   * @returns Reference ID for the derived key
   * @throws KeyVaultError if key not found, expired, or derivation fails
   */
  deriveChildKey(
    refId: string,
    counterpartyPublicKey: SecurePublicKey,
    invoiceNumber: string,
    ttlMs: number = DEFAULT_TTL_MS,
  ): string {
    this.ensureNotSealed();

    const entry = this.getEntry(refId);

    try {
      // Reconstruct parent private key and derive child
      const parentPrivateKey = SecurePrivateKey.fromHex(entry.keyBuffer.toString("hex"));
      const derivedPrivateKey = parentPrivateKey.derivePrivateKey(
        counterpartyPublicKey.toHex(),
        invoiceNumber,
      );

      // Store the derived key and return its reference
      this.recordUsage(refId);
      return this.store(derivedPrivateKey, ttlMs);
    } catch {
      throw new KeyVaultError("OPERATION_FAILED", "Key derivation failed");
    }
  }

  /**
   * Get the derived public key without storing the private key
   *
   * This is useful when you only need the public key for the counterparty.
   *
   * @param refId - Key reference ID
   * @param counterpartyPublicKey - Counterparty's public key
   * @param invoiceNumber - BRC-43 invoice number
   * @returns Derived public key
   */
  derivePublicKey(
    refId: string,
    counterpartyPublicKey: SecurePublicKey,
    invoiceNumber: string,
  ): SecurePublicKey {
    this.ensureNotSealed();

    const entry = this.getEntry(refId);

    try {
      // Derive public key using counterparty's public key and our private key
      const rawCounterpartyPubKey = counterpartyPublicKey._dangerouslyGetRawKey();
      const privateKey = SecurePrivateKey.fromHex(entry.keyBuffer.toString("hex"));
      const rawPrivKey = privateKey._dangerouslyGetRawKey();

      const derivedPubKey = rawCounterpartyPubKey.deriveChild(rawPrivKey, invoiceNumber);

      this.recordUsage(refId);
      return new SecurePublicKey(derivedPubKey);
    } catch {
      throw new KeyVaultError("OPERATION_FAILED", "Public key derivation failed");
    }
  }

  /**
   * Get the public key for a stored key
   *
   * Public keys are safe to expose.
   *
   * @param refId - Key reference ID
   * @returns SecurePublicKey
   * @throws KeyVaultError if key not found or expired
   */
  getPublicKey(refId: string): SecurePublicKey {
    const entry = this.getEntry(refId);
    return entry.publicKey;
  }

  /**
   * Wipe a key from the vault
   *
   * Zero-fills the key buffer and removes the entry.
   *
   * @param refId - Key reference ID
   * @throws KeyVaultError if key not found
   */
  wipe(refId: string): void {
    const entry = this.keys.get(refId);
    if (!entry) {
      throw new KeyVaultError("KEY_NOT_FOUND", "Key reference not found");
    }

    this.wipeEntry(refId, entry);
    this.totalKeysWiped++;
  }

  /**
   * Wipe all keys from the vault
   *
   * Zero-fills all key buffers and removes all entries.
   */
  wipeAll(): void {
    for (const [refId, entry] of this.keys) {
      this.wipeEntry(refId, entry);
      this.totalKeysWiped++;
    }
  }

  /**
   * Check if a key exists and is not expired
   *
   * @param refId - Key reference ID
   * @returns true if key exists and is valid
   */
  has(refId: string): boolean {
    const entry = this.keys.get(refId);
    if (!entry) {
      return false;
    }

    if (Date.now() > entry.expiresAt) {
      this.handleExpiration(refId);
      return false;
    }

    return true;
  }

  /**
   * Get vault statistics (no key material)
   *
   * @returns VaultStats object
   */
  stats(): VaultStats {
    let oldestTimestamp: number | null = null;
    let newestTimestamp: number | null = null;
    let totalTtl = 0;

    for (const entry of this.keys.values()) {
      if (oldestTimestamp === null || entry.storedAt < oldestTimestamp) {
        oldestTimestamp = entry.storedAt;
      }
      if (newestTimestamp === null || entry.storedAt > newestTimestamp) {
        newestTimestamp = entry.storedAt;
      }
      totalTtl += entry.expiresAt - entry.storedAt;
    }

    return {
      keyCount: this.keys.size,
      totalKeysStored: this.totalKeysStored,
      totalKeysExpired: this.totalKeysExpired,
      totalKeysWiped: this.totalKeysWiped,
      oldestKeyTimestamp: oldestTimestamp,
      newestKeyTimestamp: newestTimestamp,
      averageTtlMs: this.keys.size > 0 ? totalTtl / this.keys.size : 0,
    };
  }

  /**
   * Seal the vault - no more operations allowed
   *
   * Wipes all keys and prevents any future operations.
   * This is a one-way operation.
   */
  seal(): void {
    this.wipeAll();
    this.sealed = true;
  }

  /**
   * Check if vault is sealed
   */
  isSealed(): boolean {
    return this.sealed;
  }

  /**
   * Extend the TTL of a key
   *
   * @param refId - Key reference ID
   * @param additionalMs - Additional milliseconds to add
   * @throws KeyVaultError if key not found or new TTL exceeds maximum
   */
  extendTtl(refId: string, additionalMs: number): void {
    this.ensureNotSealed();

    const entry = this.keys.get(refId);
    if (!entry) {
      throw new KeyVaultError("KEY_NOT_FOUND", "Key reference not found");
    }

    const now = Date.now();
    const newExpiresAt = entry.expiresAt + additionalMs;
    const totalTtl = newExpiresAt - entry.storedAt;

    if (totalTtl > MAX_TTL_MS) {
      throw new KeyVaultError(
        "INVALID_TTL",
        `Extended TTL would exceed maximum of ${MAX_TTL_MS}ms`,
      );
    }

    // Cancel old timer and set new one
    clearTimeout(entry.expirationTimer);
    const remainingMs = newExpiresAt - now;
    entry.expirationTimer = setTimeout(() => {
      this.handleExpiration(refId);
    }, remainingMs);

    entry.expiresAt = newExpiresAt;
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  private ensureNotSealed(): void {
    if (this.sealed) {
      throw new KeyVaultError(
        "VAULT_SEALED",
        "Vault has been sealed and cannot perform operations",
        403,
      );
    }
  }

  private getEntry(refId: string): VaultEntry {
    const entry = this.keys.get(refId);
    if (!entry) {
      throw new KeyVaultError("KEY_NOT_FOUND", "Key reference not found");
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.handleExpiration(refId);
      throw new KeyVaultError("KEY_EXPIRED", "Key has expired");
    }

    return entry;
  }

  private recordUsage(refId: string): void {
    const entry = this.keys.get(refId);
    if (entry) {
      entry.usageCount++;
      entry.lastUsedAt = Date.now();
    }
  }

  private handleExpiration(refId: string): void {
    const entry = this.keys.get(refId);
    if (entry) {
      this.wipeEntry(refId, entry);
      this.totalKeysExpired++;
    }
  }

  private wipeEntry(refId: string, entry: VaultEntry): void {
    // Cancel expiration timer
    clearTimeout(entry.expirationTimer);

    // Zero-fill the key buffer
    entry.keyBuffer.fill(0);

    // Remove from map
    this.keys.delete(refId);
  }
}
