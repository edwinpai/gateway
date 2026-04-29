/**
 * Secure Vault Configuration
 *
 * Configuration types for the AI-Crypto isolation boundary.
 * The vault provides a strict API that prevents AI agents from
 * accessing raw key material.
 *
 * @see ISOLATION-ARCHITECTURE.md
 * @see SECURITY-MITIGATIONS-v2.md - Mitigation 1.1
 */

/**
 * Source for the master encryption key
 *
 * - 'env': Read from environment variable
 * - 'prompt': Prompt user for password (CLI/interactive only)
 * - 'keychain': Use system keychain (future)
 */
export type MasterKeySource = "env" | "prompt" | "keychain";

/**
 * Vault configuration options
 */
export interface VaultConfig {
  /**
   * Where to store encrypted keys (at-rest storage)
   * For now, in-memory vault is used; this is reserved for future persistent storage.
   */
  storagePath?: string;

  /**
   * How to obtain the master encryption key
   * Default: 'env'
   */
  masterKeySource?: MasterKeySource;

  /**
   * Environment variable name for master key (when source is 'env')
   * Default: 'EDWINPAI_VAULT_MASTER_KEY'
   */
  masterKeyEnvVar?: string;

  /**
   * Auto-lock vault after inactivity (milliseconds)
   * Default: 300000 (5 minutes)
   * Set to 0 to disable auto-lock
   */
  autoLockMs?: number;

  /**
   * Enable audit logging of all vault operations
   * Default: true
   */
  enableAuditLog?: boolean;

  /**
   * Maximum number of audit log entries to retain in memory
   * Default: 10000
   */
  maxAuditLogSize?: number;

  /**
   * Rate limit: maximum operations per minute per key
   * Default: 1000
   * Set to 0 to disable rate limiting
   */
  maxOperationsPerMinute?: number;
}

/**
 * Default vault configuration
 */
export const DEFAULT_VAULT_CONFIG: Required<VaultConfig> = {
  storagePath: "",
  masterKeySource: "env",
  masterKeyEnvVar: "EDWINPAI_VAULT_MASTER_KEY",
  autoLockMs: 300000, // 5 minutes
  enableAuditLog: true,
  maxAuditLogSize: 10000,
  maxOperationsPerMinute: 1000,
};

/**
 * Audit log entry for vault operations
 */
export interface VaultAuditEntry {
  /** Unique entry ID */
  id: string;

  /** Unix timestamp (ms) */
  timestamp: number;

  /** Operation type */
  operation: VaultOperation;

  /** Key ID involved (if applicable) */
  keyId?: string;

  /** Key label (if applicable) */
  keyLabel?: string;

  /** Operation success/failure */
  success: boolean;

  /** Error message (if failed) */
  error?: string;

  /** Additional metadata (NEVER includes key material) */
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Vault operations that are audit logged
 */
export type VaultOperation =
  | "generate_key"
  | "import_key"
  | "delete_key"
  | "get_public_key"
  | "list_keys"
  | "sign"
  | "verify"
  | "derive_child_key"
  | "encrypt"
  | "decrypt"
  | "derive_shared_secret"
  | "sign_request"
  | "lock"
  | "unlock";

/**
 * Key metadata stored in vault (NEVER includes private key material)
 */
export interface VaultKeyMetadata {
  /** Opaque key identifier (UUID) */
  keyId: string;

  /** Human-readable label */
  label: string;

  /** Compressed public key (33 bytes hex) - OK to expose */
  publicKey: string;

  /** Creation timestamp (Unix ms) */
  createdAt: number;

  /** Last used timestamp (Unix ms) */
  lastUsedAt?: number;

  /** Total number of operations performed with this key */
  operationCount: number;
}

/**
 * Key derivation parameters for vault operations
 */
export interface VaultKeyDerivationParams {
  /** Protocol ID: [SecurityLevel, protocolString] */
  protocolID: [0 | 1 | 2, string];

  /** Key ID within the protocol namespace */
  keyID: string;

  /** Counterparty identifier (optional) */
  counterparty?: string;
}

/**
 * Vault error codes
 */
export type VaultErrorCode =
  | "VAULT_LOCKED"
  | "KEY_NOT_FOUND"
  | "INVALID_KEY_ID"
  | "INVALID_PUBLIC_KEY"
  | "INVALID_SIGNATURE"
  | "INVALID_MESSAGE_HASH"
  | "DERIVATION_FAILED"
  | "ENCRYPTION_FAILED"
  | "DECRYPTION_FAILED"
  | "RATE_LIMITED"
  | "ALREADY_EXISTS"
  | "INVALID_INPUT";

/**
 * Custom error class for vault operations
 */
export class VaultError extends Error {
  readonly code: VaultErrorCode;
  readonly httpCode: number;

  constructor(code: VaultErrorCode, message: string, httpCode: number = 400) {
    super(message);
    this.name = "VaultError";
    this.code = code;
    this.httpCode = httpCode;
  }
}
