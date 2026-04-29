/**
 * Secure Key Vault - AI-Crypto Isolation Boundary
 *
 * This is the architectural centerpiece that separates AI agent operations
 * from cryptographic key material. The AI agent NEVER has direct access to
 * private keys. All cryptographic operations go through this strict API boundary.
 *
 * Trust Model:
 * - AI Agent (Untrusted Zone): Has key IDs (opaque strings), can request operations
 * - Vault API Boundary: Validates all inputs, rate limits, audit logs
 * - Crypto Core (Trusted Zone): Raw key material, BSV SDK wrapper
 *
 * @see ISOLATION-ARCHITECTURE.md
 * @see SECURITY-MITIGATIONS-v2.md - Mitigation 1.1
 */

import { createHash } from "node:crypto";
import { canonicalizeRequest as bsvCanonicalizeRequest } from "../types/bsv-auth.js";
import {
  BSVCrypto,
  SecurePrivateKey,
  deriveSharedSecret as bsvDeriveSharedSecret,
} from "./bsv-sdk-wrapper.js";
import { encrypt as eciesEncrypt, decrypt as eciesDecrypt } from "./ecies.js";
import {
  VaultConfig,
  VaultKeyMetadata,
  VaultKeyDerivationParams,
  VaultAuditEntry,
  VaultOperation,
  VaultError,
  DEFAULT_VAULT_CONFIG,
} from "./vault-config.js";

/**
 * Internal key storage entry (NEVER exposed outside vault)
 */
interface InternalKeyEntry {
  /** The actual private key - NEVER leaves this module */
  privateKey: SecurePrivateKey;
  /** Metadata that can be exposed */
  metadata: VaultKeyMetadata;
}

/**
 * Secure Key Vault
 *
 * An isolated key storage and operations service. The AI agent gets
 * a handle (key ID), never the actual key. All cryptographic operations
 * are performed within the vault boundary.
 *
 * @example
 * ```typescript
 * // Create a vault
 * const vault = await SecureVault.create({});
 *
 * // Generate a key (returns opaque ID, never the key)
 * const keyId = await vault.generateKey("my-signing-key");
 *
 * // Sign data through the vault (vault has the key, agent doesn't)
 * const signature = await vault.sign(keyId, messageHash);
 *
 * // AI agent CANNOT do:
 * // - Access raw private key
 * // - Bypass vault API
 * // - Influence derivation paths
 * ```
 */
export class SecureVault {
  private readonly config: Required<VaultConfig>;
  private readonly keys: Map<string, InternalKeyEntry> = new Map();
  private readonly auditLog: VaultAuditEntry[] = [];
  private readonly operationCounts: Map<string, { count: number; windowStart: number }> = new Map();
  private locked: boolean = false;
  private autoLockTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActivityTime: number = Date.now();

  /**
   * Private constructor - use SecureVault.create() instead
   */
  private constructor(config: VaultConfig) {
    this.config = { ...DEFAULT_VAULT_CONFIG, ...config };
  }

  /**
   * Create a new SecureVault instance
   *
   * @param config - Vault configuration options
   * @returns Configured SecureVault instance
   */
  static async create(config: VaultConfig = {}): Promise<SecureVault> {
    const vault = new SecureVault(config);

    // Set up auto-lock timer if configured
    if (vault.config.autoLockMs > 0) {
      vault.resetAutoLockTimer();
    }

    return vault;
  }

  /**
   * Generate a new random private key
   *
   * @param label - Human-readable label for the key
   * @returns Opaque key ID (UUID) - NEVER the key itself
   */
  async generateKey(label: string): Promise<string> {
    this.ensureUnlocked();
    this.recordActivity();

    const keyId = crypto.randomUUID();

    try {
      // Generate the actual key (stays inside vault)
      const privateKey = BSVCrypto.privateKeyFromRandom();
      const publicKey = privateKey.toPublicKey();

      const entry: InternalKeyEntry = {
        privateKey,
        metadata: {
          keyId,
          label,
          publicKey: publicKey.toHex(),
          createdAt: Date.now(),
          operationCount: 0,
        },
      };

      this.keys.set(keyId, entry);

      this.logAudit("generate_key", keyId, label, true);

      return keyId;
    } catch (error) {
      this.logAudit("generate_key", keyId, label, false, String(error));
      throw error;
    }
  }

  /**
   * Import an existing private key
   *
   * **Security Note:** After calling this, the input string should be
   * immediately overwritten/cleared by the caller. The vault takes
   * ownership of the key material.
   *
   * @param label - Human-readable label for the key
   * @param privateKeyHex - Private key as 64-character hex string
   * @returns Opaque key ID (UUID)
   */
  async importKey(label: string, privateKeyHex: string): Promise<string> {
    this.ensureUnlocked();
    this.recordActivity();

    const keyId = crypto.randomUUID();

    try {
      // Validate and import the key
      const privateKey = BSVCrypto.privateKeyFromHex(privateKeyHex);
      const publicKey = privateKey.toPublicKey();

      const entry: InternalKeyEntry = {
        privateKey,
        metadata: {
          keyId,
          label,
          publicKey: publicKey.toHex(),
          createdAt: Date.now(),
          operationCount: 0,
        },
      };

      this.keys.set(keyId, entry);

      this.logAudit("import_key", keyId, label, true);

      // Note: Caller should wipe privateKeyHex after this returns
      // We can't do it here because strings are immutable in JS
      // But we document this as a critical security requirement

      return keyId;
    } catch (error) {
      this.logAudit("import_key", keyId, label, false, String(error));
      throw error;
    }
  }

  /**
   * Delete a key from the vault
   *
   * @param keyId - Opaque key identifier
   */
  async deleteKey(keyId: string): Promise<void> {
    this.ensureUnlocked();
    this.recordActivity();

    const entry = this.keys.get(keyId);
    if (!entry) {
      this.logAudit("delete_key", keyId, undefined, false, "Key not found");
      throw new VaultError("KEY_NOT_FOUND", `Key not found: ${keyId}`);
    }

    const label = entry.metadata.label;

    // Remove from map (JS garbage collection will eventually free the memory)
    // Note: In a production system, you'd want secure memory wiping
    this.keys.delete(keyId);

    this.logAudit("delete_key", keyId, label, true);
  }

  /**
   * Get the public key for a key ID
   *
   * Public keys are safe to expose - they're not sensitive.
   *
   * @param keyId - Opaque key identifier
   * @returns Compressed public key as 66-character hex string
   */
  async getPublicKey(keyId: string): Promise<string> {
    this.ensureUnlocked();
    this.recordActivity();

    try {
      const entry = this.getKeyEntry(keyId);
      this.logAudit("get_public_key", keyId, entry.metadata.label, true);
      return entry.metadata.publicKey;
    } catch (error) {
      this.logAudit("get_public_key", keyId, undefined, false, String(error));
      throw error;
    }
  }

  /**
   * List all keys in the vault (metadata only, never key material)
   *
   * @returns Array of key metadata objects
   */
  async listKeys(): Promise<VaultKeyMetadata[]> {
    this.ensureUnlocked();
    this.recordActivity();

    const keys = Array.from(this.keys.values()).map((entry) => ({ ...entry.metadata }));

    this.logAudit("list_keys", undefined, undefined, true, undefined, {
      keyCount: keys.length,
    });

    return keys;
  }

  /**
   * Sign a message hash using a vault key
   *
   * Uses RFC 6979 deterministic signatures internally.
   *
   * @param keyId - Opaque key identifier
   * @param messageHash - SHA-256 hash of message (32 bytes hex, 64 chars)
   * @returns DER-encoded signature as Buffer
   */
  async sign(keyId: string, messageHash: string): Promise<Buffer> {
    this.ensureUnlocked();
    this.recordActivity();
    this.checkRateLimit(keyId);

    // Validate message hash format
    if (!/^[0-9a-fA-F]{64}$/.test(messageHash)) {
      this.logAudit("sign", keyId, undefined, false, "Invalid message hash format");
      throw new VaultError("INVALID_MESSAGE_HASH", "Message hash must be 32 bytes hex (64 chars)");
    }

    const entry = this.getKeyEntry(keyId);

    try {
      // Sign within the vault boundary
      const signature = BSVCrypto.sign(entry.privateKey, messageHash);

      this.incrementOperationCount(keyId);
      this.logAudit("sign", keyId, entry.metadata.label, true);

      return signature;
    } catch (error) {
      this.logAudit("sign", keyId, entry.metadata.label, false, String(error));
      throw error;
    }
  }

  /**
   * Verify a signature against a message hash
   *
   * @param publicKeyHex - Public key to verify against (66 chars hex)
   * @param messageHash - SHA-256 hash of message (32 bytes hex, 64 chars)
   * @param signature - DER-encoded signature
   * @returns true if signature is valid
   */
  async verify(publicKeyHex: string, messageHash: string, signature: Buffer): Promise<boolean> {
    this.ensureUnlocked();
    this.recordActivity();

    // Validate inputs
    if (!/^[0-9a-fA-F]{66}$/.test(publicKeyHex)) {
      this.logAudit("verify", undefined, undefined, false, "Invalid public key format");
      throw new VaultError(
        "INVALID_PUBLIC_KEY",
        "Public key must be compressed (33 bytes hex, 66 chars)",
      );
    }

    if (!/^[0-9a-fA-F]{64}$/.test(messageHash)) {
      this.logAudit("verify", undefined, undefined, false, "Invalid message hash format");
      throw new VaultError("INVALID_MESSAGE_HASH", "Message hash must be 32 bytes hex (64 chars)");
    }

    try {
      const publicKey = BSVCrypto.publicKeyFromHex(publicKeyHex);
      const isValid = BSVCrypto.verify(publicKey, messageHash, signature);

      this.logAudit("verify", undefined, undefined, true, undefined, { valid: isValid });

      return isValid;
    } catch (error) {
      this.logAudit("verify", undefined, undefined, false, String(error));
      throw error;
    }
  }

  /**
   * Derive a child key using BRC-42 key derivation
   *
   * @param keyId - Parent key identifier
   * @param counterpartyPublicKey - Counterparty's public key (66 chars hex)
   * @param params - Key derivation parameters
   * @returns New key ID for the derived key
   */
  async deriveChildKey(
    keyId: string,
    counterpartyPublicKey: string,
    params: VaultKeyDerivationParams,
  ): Promise<string> {
    this.ensureUnlocked();
    this.recordActivity();
    this.checkRateLimit(keyId);

    // Validate counterparty public key
    if (!/^[0-9a-fA-F]{66}$/.test(counterpartyPublicKey)) {
      this.logAudit("derive_child_key", keyId, undefined, false, "Invalid counterparty public key");
      throw new VaultError(
        "INVALID_PUBLIC_KEY",
        "Counterparty public key must be compressed (33 bytes hex, 66 chars)",
      );
    }

    const parentEntry = this.getKeyEntry(keyId);
    const newKeyId = crypto.randomUUID();

    try {
      const _counterpartyPubKey = BSVCrypto.publicKeyFromHex(counterpartyPublicKey);

      // Build invoice number from params
      const invoiceNumber = `${params.protocolID[0]} ${params.protocolID[1]} ${params.keyID}`;

      // Derive child key using BRC-42
      const derivedPrivateKey = parentEntry.privateKey.derivePrivateKey(
        counterpartyPublicKey,
        invoiceNumber,
      );

      const derivedPublicKey = derivedPrivateKey.toPublicKey();

      const label = `derived:${parentEntry.metadata.label}:${params.keyID}`;

      const entry: InternalKeyEntry = {
        privateKey: derivedPrivateKey,
        metadata: {
          keyId: newKeyId,
          label,
          publicKey: derivedPublicKey.toHex(),
          createdAt: Date.now(),
          operationCount: 0,
        },
      };

      this.keys.set(newKeyId, entry);
      this.incrementOperationCount(keyId);

      this.logAudit("derive_child_key", newKeyId, label, true, undefined, {
        parentKeyId: keyId,
        protocolID: `${params.protocolID[0]}:${params.protocolID[1]}`,
      });

      return newKeyId;
    } catch (error) {
      this.logAudit("derive_child_key", keyId, undefined, false, String(error));
      throw new VaultError(
        "DERIVATION_FAILED",
        `Key derivation failed: ${error instanceof Error ? error.message : String(error)}`,
        500,
      );
    }
  }

  /**
   * Encrypt data using ECIES (BRC-78)
   *
   * @param keyId - Sender's key identifier
   * @param recipientPublicKey - Recipient's public key (66 chars hex)
   * @param plaintext - Data to encrypt
   * @returns Encrypted ciphertext (BRC-78 format)
   */
  async encrypt(keyId: string, recipientPublicKey: string, plaintext: Buffer): Promise<Buffer> {
    this.ensureUnlocked();
    this.recordActivity();
    this.checkRateLimit(keyId);

    // Validate recipient public key
    if (!/^[0-9a-fA-F]{66}$/.test(recipientPublicKey)) {
      this.logAudit("encrypt", keyId, undefined, false, "Invalid recipient public key");
      throw new VaultError(
        "INVALID_PUBLIC_KEY",
        "Recipient public key must be compressed (33 bytes hex, 66 chars)",
      );
    }

    const entry = this.getKeyEntry(keyId);

    try {
      const recipientPubKey = BSVCrypto.publicKeyFromHex(recipientPublicKey);

      // Encrypt using ECIES
      const ciphertext = eciesEncrypt(plaintext, entry.privateKey, recipientPubKey);

      // Serialize to bytes
      const { serializeCiphertext } = await import("./ecies.js");
      const serialized = serializeCiphertext(ciphertext);

      this.incrementOperationCount(keyId);
      this.logAudit("encrypt", keyId, entry.metadata.label, true, undefined, {
        plaintextLength: plaintext.length,
      });

      return serialized;
    } catch (error) {
      this.logAudit("encrypt", keyId, entry.metadata.label, false, String(error));
      throw new VaultError(
        "ENCRYPTION_FAILED",
        `Encryption failed: ${error instanceof Error ? error.message : String(error)}`,
        500,
      );
    }
  }

  /**
   * Decrypt data using ECIES (BRC-78)
   *
   * @param keyId - Recipient's key identifier
   * @param senderPublicKey - Sender's public key (66 chars hex)
   * @param ciphertext - Encrypted data (BRC-78 format)
   * @returns Decrypted plaintext
   */
  async decrypt(keyId: string, senderPublicKey: string, ciphertext: Buffer): Promise<Buffer> {
    this.ensureUnlocked();
    this.recordActivity();
    this.checkRateLimit(keyId);

    // Validate sender public key
    if (!/^[0-9a-fA-F]{66}$/.test(senderPublicKey)) {
      this.logAudit("decrypt", keyId, undefined, false, "Invalid sender public key");
      throw new VaultError(
        "INVALID_PUBLIC_KEY",
        "Sender public key must be compressed (33 bytes hex, 66 chars)",
      );
    }

    const entry = this.getKeyEntry(keyId);

    try {
      const senderPubKey = BSVCrypto.publicKeyFromHex(senderPublicKey);

      // Deserialize ciphertext
      const { deserializeCiphertext } = await import("./ecies.js");
      const ciphertextObj = deserializeCiphertext(ciphertext);

      // Decrypt using ECIES
      const plaintext = eciesDecrypt(ciphertextObj, entry.privateKey, senderPubKey);

      this.incrementOperationCount(keyId);
      this.logAudit("decrypt", keyId, entry.metadata.label, true, undefined, {
        ciphertextLength: ciphertext.length,
      });

      return plaintext;
    } catch (error) {
      this.logAudit("decrypt", keyId, entry.metadata.label, false, String(error));
      throw new VaultError(
        "DECRYPTION_FAILED",
        `Decryption failed: ${error instanceof Error ? error.message : String(error)}`,
        500,
      );
    }
  }

  /**
   * Derive a shared secret with a counterparty
   *
   * Uses ECDH + HKDF-SHA256 per NIST SP 800-56A Rev 3.
   *
   * @param keyId - Your key identifier
   * @param counterpartyPublicKey - Counterparty's public key (66 chars hex)
   * @param context - Context string for HKDF (default: "BRC-42")
   * @returns Derived shared secret (32 bytes)
   */
  async deriveSharedSecret(
    keyId: string,
    counterpartyPublicKey: string,
    context: string = "BRC-42",
  ): Promise<Buffer> {
    this.ensureUnlocked();
    this.recordActivity();
    this.checkRateLimit(keyId);

    // Validate counterparty public key
    if (!/^[0-9a-fA-F]{66}$/.test(counterpartyPublicKey)) {
      this.logAudit(
        "derive_shared_secret",
        keyId,
        undefined,
        false,
        "Invalid counterparty public key",
      );
      throw new VaultError(
        "INVALID_PUBLIC_KEY",
        "Counterparty public key must be compressed (33 bytes hex, 66 chars)",
      );
    }

    const entry = this.getKeyEntry(keyId);

    try {
      const counterpartyPubKey = BSVCrypto.publicKeyFromHex(counterpartyPublicKey);

      // Derive shared secret with HKDF
      const sharedSecret = bsvDeriveSharedSecret(entry.privateKey, counterpartyPubKey, context);

      this.incrementOperationCount(keyId);
      this.logAudit("derive_shared_secret", keyId, entry.metadata.label, true, undefined, {
        context,
      });

      return sharedSecret;
    } catch (error) {
      this.logAudit("derive_shared_secret", keyId, entry.metadata.label, false, String(error));
      throw error;
    }
  }

  /**
   * Sign an HTTP request (BRC-103)
   *
   * @param keyId - Key identifier for signing
   * @param params - Request parameters (method, path, body)
   * @returns Authentication headers to attach to request
   */
  async signRequest(
    keyId: string,
    params: { method: string; path: string; body?: string | object },
  ): Promise<Record<string, string>> {
    this.ensureUnlocked();
    this.recordActivity();
    this.checkRateLimit(keyId);

    const entry = this.getKeyEntry(keyId);

    try {
      const timestamp = Date.now();
      const nonce = crypto.randomUUID();

      // Build canonical request string
      const canonicalRequest = bsvCanonicalizeRequest({
        method: params.method,
        path: params.path,
        body: params.body,
        timestamp,
        nonce,
        identityKey: entry.metadata.publicKey,
      });

      // Hash the canonical request
      const messageHash = createHash("sha256").update(canonicalRequest).digest("hex");

      // Sign the hash
      const signature = BSVCrypto.sign(entry.privateKey, messageHash);
      const signatureHex = signature.toString("hex");

      this.incrementOperationCount(keyId);
      this.logAudit("sign_request", keyId, entry.metadata.label, true, undefined, {
        method: params.method,
        path: params.path,
      });

      return {
        "x-bsv-identity-key": entry.metadata.publicKey,
        "x-bsv-signature": signatureHex,
        "x-bsv-timestamp": timestamp.toString(),
        "x-bsv-nonce": nonce,
      };
    } catch (error) {
      this.logAudit("sign_request", keyId, entry.metadata.label, false, String(error));
      throw error;
    }
  }

  /**
   * Lock the vault (prevents all operations until unlocked)
   */
  lock(): void {
    this.locked = true;
    this.clearAutoLockTimer();
    this.logAudit("lock", undefined, undefined, true);
  }

  /**
   * Unlock the vault
   *
   * Note: In a full implementation, this would verify a master password.
   * For now, it just sets the locked flag to false.
   */
  unlock(): void {
    this.locked = false;
    this.resetAutoLockTimer();
    this.logAudit("unlock", undefined, undefined, true);
  }

  /**
   * Check if vault is locked
   */
  isLocked(): boolean {
    return this.locked;
  }

  /**
   * Get audit log entries
   *
   * @param limit - Maximum entries to return (default: 100)
   * @returns Recent audit log entries (newest first)
   */
  getAuditLog(limit: number = 100): VaultAuditEntry[] {
    return this.auditLog.slice(-limit).toReversed();
  }

  /**
   * Clear the audit log
   */
  clearAuditLog(): void {
    this.auditLog.length = 0;
  }

  // ==========================================================================
  // Private helper methods
  // ==========================================================================

  private ensureUnlocked(): void {
    if (this.locked) {
      throw new VaultError("VAULT_LOCKED", "Vault is locked. Call unlock() first.", 403);
    }
  }

  private getKeyEntry(keyId: string): InternalKeyEntry {
    if (!keyId || typeof keyId !== "string") {
      throw new VaultError("INVALID_KEY_ID", "Key ID must be a non-empty string");
    }

    const entry = this.keys.get(keyId);
    if (!entry) {
      throw new VaultError("KEY_NOT_FOUND", `Key not found: ${keyId}`);
    }

    return entry;
  }

  private recordActivity(): void {
    this.lastActivityTime = Date.now();
    this.resetAutoLockTimer();
  }

  private resetAutoLockTimer(): void {
    this.clearAutoLockTimer();

    if (this.config.autoLockMs > 0 && !this.locked) {
      this.autoLockTimer = setTimeout(() => {
        this.lock();
      }, this.config.autoLockMs);
    }
  }

  private clearAutoLockTimer(): void {
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = null;
    }
  }

  private checkRateLimit(keyId: string): void {
    if (this.config.maxOperationsPerMinute === 0) {
      return; // Rate limiting disabled
    }

    const now = Date.now();
    const windowMs = 60000; // 1 minute

    let record = this.operationCounts.get(keyId);

    if (!record || now - record.windowStart > windowMs) {
      // Start new window
      record = { count: 0, windowStart: now };
      this.operationCounts.set(keyId, record);
    }

    if (record.count >= this.config.maxOperationsPerMinute) {
      throw new VaultError(
        "RATE_LIMITED",
        `Rate limit exceeded for key ${keyId}. Max ${this.config.maxOperationsPerMinute} operations per minute.`,
        429,
      );
    }
  }

  private incrementOperationCount(keyId: string): void {
    const entry = this.keys.get(keyId);
    if (entry) {
      entry.metadata.operationCount++;
      entry.metadata.lastUsedAt = Date.now();
    }

    const record = this.operationCounts.get(keyId);
    if (record) {
      record.count++;
    }
  }

  private logAudit(
    operation: VaultOperation,
    keyId?: string,
    keyLabel?: string,
    success: boolean = true,
    error?: string,
    metadata?: Record<string, string | number | boolean>,
  ): void {
    if (!this.config.enableAuditLog) {
      return;
    }

    const entry: VaultAuditEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      operation,
      keyId,
      keyLabel,
      success,
      error,
      metadata,
    };

    this.auditLog.push(entry);

    // Trim log if it exceeds max size
    if (this.auditLog.length > this.config.maxAuditLogSize) {
      this.auditLog.splice(0, this.auditLog.length - this.config.maxAuditLogSize);
    }
  }
}

/**
 * Export types for external use
 */
export type { VaultConfig, VaultKeyMetadata, VaultAuditEntry, VaultKeyDerivationParams };
export { VaultError };
