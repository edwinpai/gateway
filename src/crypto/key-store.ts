/**
 * Encrypted Key Store
 *
 * Provides encrypted-at-rest storage for private keys using AES-256-GCM.
 * Each key is individually encrypted with a unique IV and salt.
 * Master key is derived from password/env var using PBKDF2.
 *
 * **Security Properties:**
 * - Per-key encryption: unique IV + salt per entry
 * - PBKDF2 key derivation: 100,000 iterations, SHA-512
 * - AES-256-GCM: authenticated encryption
 * - No private key material in error messages
 *
 * @see SECURITY-MITIGATIONS-v2.md
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { SecurePrivateKey } from "./bsv-sdk-wrapper.js";

/**
 * Configuration for the encrypted key store
 */
export interface KeyStoreConfig {
  /** File path for encrypted keystore */
  storagePath: string;
  /** Source for master key: 'env' reads from environment, 'password' uses direct password */
  masterKeySource: "env" | "password";
  /** Environment variable name (default: EDWINPAI_VAULT_MASTER_KEY) */
  masterKeyEnvVar?: string;
  /** Direct password (only used when masterKeySource is 'password') */
  masterPassword?: string;
}

/**
 * Stored key entry format (persisted to disk)
 */
export interface StoredKeyEntry {
  /** Unique identifier for this key */
  keyId: string;
  /** Human-readable label */
  label: string;
  /** Public key as hex (safe to store unencrypted) */
  publicKey: string;
  /** AES-256-GCM encrypted private key (base64) */
  encryptedPrivateKey: string;
  /** Initialization vector (base64) */
  iv: string;
  /** GCM authentication tag (base64) */
  authTag: string;
  /** PBKDF2 salt (base64) */
  salt: string;
  /** Creation timestamp (epoch ms) */
  createdAt: number;
}

/**
 * Key store file format
 */
interface KeyStoreFile {
  version: 1;
  entries: StoredKeyEntry[];
}

/**
 * PBKDF2 parameters
 */
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = "sha512";
const DERIVED_KEY_LENGTH = 32; // 256 bits for AES-256

/**
 * AES-GCM parameters
 */
const AES_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits per NIST recommendation
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32; // 256 bits

/**
 * Encrypted Key Store
 *
 * Provides encrypted-at-rest storage for private keys.
 */
export class EncryptedKeyStore {
  private readonly config: KeyStoreConfig;
  private readonly masterPassword: string;
  private entries: Map<string, StoredKeyEntry>;
  private loaded: boolean;

  private constructor(config: KeyStoreConfig, masterPassword: string) {
    this.config = config;
    this.masterPassword = masterPassword;
    this.entries = new Map();
    this.loaded = false;
  }

  /**
   * Open an encrypted key store
   *
   * Creates a new store if the file doesn't exist.
   * Loads and validates existing store if present.
   *
   * @param config - Key store configuration
   * @returns Opened key store instance
   * @throws Error if master key is not available or store is corrupt
   */
  static async open(config: KeyStoreConfig): Promise<EncryptedKeyStore> {
    // Resolve master password
    const masterPassword = EncryptedKeyStore.resolveMasterPassword(config);

    if (!masterPassword || masterPassword.length === 0) {
      throw new Error("Master key is required but not provided");
    }

    const store = new EncryptedKeyStore(config, masterPassword);
    await store.loadFromDisk();

    return store;
  }

  /**
   * Check if a keystore file exists
   *
   * @param storagePath - Path to keystore file
   * @returns true if file exists
   */
  static exists(storagePath: string): boolean {
    return fs.existsSync(storagePath);
  }

  /**
   * Resolve master password from config
   */
  private static resolveMasterPassword(config: KeyStoreConfig): string {
    if (config.masterKeySource === "password") {
      return config.masterPassword || "";
    }

    // Read from environment variable
    const envVar = config.masterKeyEnvVar || "EDWINPAI_VAULT_MASTER_KEY";
    return process.env[envVar] || "";
  }

  /**
   * Derive encryption key from master password using PBKDF2
   *
   * @param password - Master password
   * @param salt - Salt for this specific key entry
   * @returns 32-byte derived key
   */
  private async deriveEncryptionKey(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(
        password,
        salt,
        PBKDF2_ITERATIONS,
        DERIVED_KEY_LENGTH,
        PBKDF2_DIGEST,
        (err, derivedKey) => {
          if (err) {
            reject(err);
          } else {
            resolve(derivedKey);
          }
        },
      );
    });
  }

  /**
   * Encrypt a private key
   *
   * @param privateKeyHex - Private key as hex string
   * @param salt - PBKDF2 salt
   * @returns Encrypted key components
   */
  private async encryptPrivateKey(
    privateKeyHex: string,
    salt: Buffer,
  ): Promise<{ encryptedData: Buffer; iv: Buffer; authTag: Buffer }> {
    const derivedKey = await this.deriveEncryptionKey(this.masterPassword, salt);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(AES_ALGORITHM, derivedKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    const encrypted = Buffer.concat([cipher.update(privateKeyHex, "utf8"), cipher.final()]);

    const authTag = cipher.getAuthTag();

    return { encryptedData: encrypted, iv, authTag };
  }

  /**
   * Decrypt a private key
   *
   * @param encryptedData - Encrypted private key
   * @param iv - Initialization vector
   * @param authTag - GCM authentication tag
   * @param salt - PBKDF2 salt
   * @returns Decrypted private key hex
   * @throws Error if decryption fails (wrong password or tampering)
   */
  private async decryptPrivateKey(
    encryptedData: Buffer,
    iv: Buffer,
    authTag: Buffer,
    salt: Buffer,
  ): Promise<string> {
    const derivedKey = await this.deriveEncryptionKey(this.masterPassword, salt);

    const decipher = crypto.createDecipheriv(AES_ALGORITHM, derivedKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    decipher.setAuthTag(authTag);

    try {
      const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);

      return decrypted.toString("utf8");
    } catch (error) {
      // Don't leak information about why decryption failed
      throw new Error("Decryption failed: invalid master key or data corruption", { cause: error });
    }
  }

  /**
   * Store a private key (encrypts it first)
   *
   * @param keyId - Unique identifier for this key
   * @param label - Human-readable label
   * @param privateKey - Private key to store
   * @returns Stored key entry (without decrypted key material)
   * @throws Error if keyId already exists
   */
  async store(keyId: string, label: string, privateKey: SecurePrivateKey): Promise<StoredKeyEntry> {
    if (this.entries.has(keyId)) {
      throw new Error(`Key with ID "${keyId}" already exists`);
    }

    // Generate unique salt for this key
    const salt = crypto.randomBytes(SALT_LENGTH);

    // Get key material
    const privateKeyHex = privateKey.toHex();
    const publicKey = privateKey.toPublicKey().toHex();

    // Encrypt
    const { encryptedData, iv, authTag } = await this.encryptPrivateKey(privateKeyHex, salt);

    // Create entry
    const entry: StoredKeyEntry = {
      keyId,
      label,
      publicKey,
      encryptedPrivateKey: encryptedData.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      salt: salt.toString("base64"),
      createdAt: Date.now(),
    };

    // Store in memory and persist
    this.entries.set(keyId, entry);
    await this.save();

    return entry;
  }

  /**
   * Load a private key (decrypts it)
   *
   * @param keyId - Key identifier
   * @returns Decrypted private key
   * @throws Error if key not found or decryption fails
   */
  async load(keyId: string): Promise<SecurePrivateKey> {
    const entry = this.entries.get(keyId);
    if (!entry) {
      throw new Error(`Key not found: "${keyId}"`);
    }

    // Decode stored data
    const encryptedData = Buffer.from(entry.encryptedPrivateKey, "base64");
    const iv = Buffer.from(entry.iv, "base64");
    const authTag = Buffer.from(entry.authTag, "base64");
    const salt = Buffer.from(entry.salt, "base64");

    // Decrypt
    const privateKeyHex = await this.decryptPrivateKey(encryptedData, iv, authTag, salt);

    // Reconstruct SecurePrivateKey
    return SecurePrivateKey.fromHex(privateKeyHex);
  }

  /**
   * Delete a key from the store
   *
   * @param keyId - Key identifier
   * @throws Error if key not found
   */
  async delete(keyId: string): Promise<void> {
    if (!this.entries.has(keyId)) {
      throw new Error(`Key not found: "${keyId}"`);
    }

    this.entries.delete(keyId);
    await this.save();
  }

  /**
   * List all keys (public info only, no decryption needed)
   *
   * @returns Array of key metadata
   */
  async list(): Promise<
    Array<{ keyId: string; label: string; publicKey: string; createdAt: number }>
  > {
    return Array.from(this.entries.values()).map((entry) => ({
      keyId: entry.keyId,
      label: entry.label,
      publicKey: entry.publicKey,
      createdAt: entry.createdAt,
    }));
  }

  /**
   * Check if a key exists
   *
   * @param keyId - Key identifier
   * @returns true if key exists
   */
  has(keyId: string): boolean {
    return this.entries.has(keyId);
  }

  /**
   * Get the number of keys in the store
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Save keystore to disk
   */
  private async save(): Promise<void> {
    const storeFile: KeyStoreFile = {
      version: 1,
      entries: Array.from(this.entries.values()),
    };

    const json = JSON.stringify(storeFile, null, 2);

    // Ensure directory exists
    const dir = path.dirname(this.config.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write atomically (write to temp, then rename)
    const tempPath = `${this.config.storagePath}.tmp`;
    fs.writeFileSync(tempPath, json, "utf8");
    fs.renameSync(tempPath, this.config.storagePath);
  }

  /**
   * Load keystore from disk
   */
  private async loadFromDisk(): Promise<void> {
    if (!fs.existsSync(this.config.storagePath)) {
      // New store, nothing to load
      this.entries = new Map();
      this.loaded = true;
      return;
    }

    try {
      const json = fs.readFileSync(this.config.storagePath, "utf8");
      const storeFile = JSON.parse(json) as KeyStoreFile;

      // Validate structure
      if (!storeFile || typeof storeFile !== "object") {
        throw new Error("Invalid keystore format: not an object");
      }

      if (storeFile.version !== 1) {
        throw new Error(`Unsupported keystore version: ${String(storeFile.version)}`);
      }

      if (!Array.isArray(storeFile.entries)) {
        throw new Error("Invalid keystore format: entries is not an array");
      }

      // Validate each entry
      for (const entry of storeFile.entries) {
        this.validateEntry(entry);
      }

      // Load into map
      this.entries = new Map(storeFile.entries.map((e) => [e.keyId, e]));
      this.loaded = true;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("Corrupt keystore file: invalid JSON", { cause: error });
      }
      throw error;
    }
  }

  /**
   * Validate a stored key entry
   */
  private validateEntry(entry: unknown): asserts entry is StoredKeyEntry {
    if (!entry || typeof entry !== "object") {
      throw new Error("Invalid keystore entry: not an object");
    }

    const e = entry as Record<string, unknown>;

    const requiredFields = [
      "keyId",
      "label",
      "publicKey",
      "encryptedPrivateKey",
      "iv",
      "authTag",
      "salt",
      "createdAt",
    ];

    for (const field of requiredFields) {
      if (!(field in e)) {
        throw new Error(`Invalid keystore entry: missing field "${field}"`);
      }
    }

    if (typeof e.keyId !== "string" || e.keyId.length === 0) {
      throw new Error("Invalid keystore entry: keyId must be a non-empty string");
    }

    if (typeof e.createdAt !== "number") {
      throw new Error("Invalid keystore entry: createdAt must be a number");
    }
  }
}
