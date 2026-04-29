/**
 * Crypto Service - Strict AI-Crypto Isolation Boundary
 *
 * This is the ONLY interface through which AI agent code should access
 * cryptographic operations. It provides:
 *
 * - TypeBox schema validation for ALL inputs
 * - Structured command interface (no freeform strings)
 * - Hardcoded security-critical parameters
 * - Comprehensive audit logging
 * - Reference-based key access (never raw keys)
 *
 * **Security Critical:** Direct usage of crypto modules bypasses these protections.
 *
 * @see SECURITY-MITIGATIONS-v2.md - Mitigation 1.1
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { ProtocolID } from "../types/bsv-auth.js";
import { buildInvoiceNumber } from "../auth/key-derivation.js";
import { BSVCrypto } from "./bsv-sdk-wrapper.js";
import { serializeCiphertext, deserializeCiphertext } from "./ecies.js";
import { KeyVault, KeyVaultError, type VaultStats } from "./key-vault.js";

// =============================================================================
// TypeBox Schemas - All inputs must validate against these
// =============================================================================

/**
 * 64-character hex string (32 bytes)
 */
const Hex32Schema = Type.String({
  pattern: "^[0-9a-fA-F]{64}$",
  description: "32-byte value as 64-character hex string",
});

/**
 * 66-character hex string (33 bytes compressed public key)
 */
const Hex33Schema = Type.String({
  pattern: "^0[23][0-9a-fA-F]{64}$",
  description: "Compressed public key (33 bytes, 02/03 prefix)",
});

/**
 * DER-encoded signature as hex
 */
const DERSignatureSchema = Type.String({
  pattern: "^[0-9a-fA-F]+$",
  minLength: 140, // Minimum DER signature length in hex
  maxLength: 144, // Maximum DER signature length in hex
  description: "DER-encoded ECDSA signature as hex string",
});

/**
 * UUID reference ID
 */
const RefIdSchema = Type.String({
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
  description: "Key reference ID (UUID)",
});

/**
 * Protocol ID tuple [SecurityLevel, ProtocolString]
 */
const ProtocolIDSchema = Type.Tuple([
  Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)]),
  Type.String({ minLength: 1, maxLength: 200 }),
]);

/**
 * Key ID string
 */
const KeyIDSchema = Type.String({
  minLength: 1,
  maxLength: 256,
  description: "Key identifier within protocol namespace",
});

/**
 * Counterparty identifier
 */
const _CounterpartySchema = Type.Union([Hex33Schema, Type.Literal("self"), Type.Literal("anyone")]);

// =============================================================================
// Request Schemas
// =============================================================================

const SignRequestSchema = Type.Object({
  action: Type.Literal("sign"),
  keyRefId: RefIdSchema,
  messageHash: Hex32Schema,
});

const VerifyRequestSchema = Type.Object({
  action: Type.Literal("verify"),
  messageHash: Hex32Schema,
  signature: DERSignatureSchema,
  publicKey: Hex33Schema,
});

const EncryptRequestSchema = Type.Object({
  action: Type.Literal("encrypt"),
  keyRefId: RefIdSchema,
  plaintextHex: Type.String({ pattern: "^[0-9a-fA-F]*$" }),
  recipientPublicKey: Hex33Schema,
});

const DecryptRequestSchema = Type.Object({
  action: Type.Literal("decrypt"),
  keyRefId: RefIdSchema,
  ciphertextHex: Type.String({ pattern: "^[0-9a-fA-F]+$" }),
  senderPublicKey: Hex33Schema,
});

const DeriveKeyRequestSchema = Type.Object({
  action: Type.Literal("derive-key"),
  keyRefId: RefIdSchema,
  counterpartyPublicKey: Hex33Schema,
  protocolID: ProtocolIDSchema,
  keyID: KeyIDSchema,
});

const GenerateEphemeralRequestSchema = Type.Object({
  action: Type.Literal("generate-ephemeral"),
  ttlMs: Type.Optional(Type.Number({ minimum: 10000, maximum: 3600000 })),
});

const ImportKeyRequestSchema = Type.Object({
  action: Type.Literal("import-key"),
  privateKeyHex: Hex32Schema,
  ttlMs: Type.Optional(Type.Number({ minimum: 10000, maximum: 3600000 })),
});

const GetPublicKeyRequestSchema = Type.Object({
  action: Type.Literal("get-public-key"),
  keyRefId: RefIdSchema,
});

const WipeKeyRequestSchema = Type.Object({
  action: Type.Literal("wipe-key"),
  keyRefId: RefIdSchema,
});

const StatsRequestSchema = Type.Object({
  action: Type.Literal("stats"),
});

/**
 * Union of all valid request types
 */
const CryptoServiceRequestSchema = Type.Union([
  SignRequestSchema,
  VerifyRequestSchema,
  EncryptRequestSchema,
  DecryptRequestSchema,
  DeriveKeyRequestSchema,
  GenerateEphemeralRequestSchema,
  ImportKeyRequestSchema,
  GetPublicKeyRequestSchema,
  WipeKeyRequestSchema,
  StatsRequestSchema,
]);

// Type aliases
type SignRequest = Static<typeof SignRequestSchema>;
type VerifyRequest = Static<typeof VerifyRequestSchema>;
type EncryptRequest = Static<typeof EncryptRequestSchema>;
type DecryptRequest = Static<typeof DecryptRequestSchema>;
type DeriveKeyRequest = Static<typeof DeriveKeyRequestSchema>;
type GenerateEphemeralRequest = Static<typeof GenerateEphemeralRequestSchema>;
type ImportKeyRequest = Static<typeof ImportKeyRequestSchema>;
type GetPublicKeyRequest = Static<typeof GetPublicKeyRequestSchema>;
type WipeKeyRequest = Static<typeof WipeKeyRequestSchema>;
type StatsRequest = Static<typeof StatsRequestSchema>;

export type CryptoServiceRequest = Static<typeof CryptoServiceRequestSchema>;

// =============================================================================
// Response Types
// =============================================================================

/**
 * Audit log entry for crypto operations
 */
export interface AuditLogEntry {
  /** Unique entry ID */
  id: string;
  /** Unix timestamp (ms) */
  timestamp: number;
  /** Action performed */
  action: string;
  /** Key reference ID (if applicable) */
  keyRefId?: string;
  /** Operation success/failure */
  success: boolean;
  /** Error code (if failed) */
  errorCode?: string;
  /** Additional metadata (NEVER includes key material) */
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Response from the crypto service
 */
export interface CryptoServiceResponse<T = unknown> {
  /** Whether the operation succeeded */
  success: boolean;
  /** Result data (typed per action) */
  result?: T;
  /** Error message (if failed) */
  error?: string;
  /** Error code (if failed) */
  errorCode?: string;
  /** Audit log entry for this operation */
  auditEntry: AuditLogEntry;
}

// Action-specific result types
export interface SignResult {
  signature: string; // DER-encoded signature as hex
}

export interface VerifyResult {
  valid: boolean;
}

export interface EncryptResult {
  ciphertext: string; // BRC-78 ciphertext as hex
}

export interface DecryptResult {
  plaintext: string; // Decrypted data as hex
}

export interface DeriveKeyResult {
  publicKey: string; // Derived public key (NEVER private)
  keyRefId: string; // Reference to the derived private key
}

export interface GenerateEphemeralResult {
  publicKey: string; // Public key (NEVER private)
  keyRefId: string; // Reference to the private key
}

export interface ImportKeyResult {
  keyRefId: string; // Reference to imported key
  publicKey: string;
}

export interface GetPublicKeyResult {
  publicKey: string;
}

export interface WipeKeyResult {
  wiped: boolean;
}

export interface StatsResult {
  vaultStats: VaultStats;
}

// =============================================================================
// Error Codes
// =============================================================================

export type CryptoServiceErrorCode =
  | "INVALID_REQUEST"
  | "VALIDATION_FAILED"
  | "KEY_NOT_FOUND"
  | "KEY_EXPIRED"
  | "OPERATION_FAILED"
  | "VERIFICATION_FAILED"
  | "DECRYPTION_FAILED"
  | "INTERNAL_ERROR";

/**
 * Crypto service error
 */
export class CryptoServiceError extends Error {
  readonly code: CryptoServiceErrorCode;
  readonly httpCode: number;

  constructor(code: CryptoServiceErrorCode, message: string, httpCode: number = 400) {
    super(message);
    this.name = "CryptoServiceError";
    this.code = code;
    this.httpCode = httpCode;
  }
}

// =============================================================================
// Crypto Service
// =============================================================================

/**
 * Crypto Service Configuration
 */
export interface CryptoServiceConfig {
  /** Default TTL for ephemeral keys (ms) */
  defaultKeyTtlMs?: number;
  /** Enable audit logging */
  enableAuditLog?: boolean;
  /** Maximum audit log size */
  maxAuditLogSize?: number;
}

const DEFAULT_CONFIG: Required<CryptoServiceConfig> = {
  defaultKeyTtlMs: 5 * 60 * 1000, // 5 minutes
  enableAuditLog: true,
  maxAuditLogSize: 10000,
};

/**
 * Crypto Service - The AI-Crypto Isolation Boundary
 *
 * ALL cryptographic operations from the AI layer go through this service.
 * It provides:
 *
 * 1. **Input Validation**: TypeBox schemas validate all inputs
 * 2. **Reference-Based Keys**: Private keys are never returned, only UUIDs
 * 3. **Hardcoded Security**: Derivation paths are always hardened, curve is secp256k1
 * 4. **Audit Logging**: Every operation is logged (without key material)
 *
 * @example
 * ```typescript
 * const service = new CryptoService();
 *
 * // Generate an ephemeral key (returns reference, not key)
 * const genResult = await service.execute({
 *   action: 'generate-ephemeral'
 * });
 * const keyRefId = genResult.result.keyRefId;
 *
 * // Sign using the reference
 * const signResult = await service.execute({
 *   action: 'sign',
 *   keyRefId,
 *   messageHash: '...'
 * });
 *
 * // AI agent CANNOT:
 * // - Get the private key
 * // - Change derivation paths
 * // - Bypass validation
 * ```
 */
export class CryptoService {
  private readonly config: Required<CryptoServiceConfig>;
  private readonly vault: KeyVault;
  private readonly auditLog: AuditLogEntry[] = [];

  /**
   * Create a new CryptoService
   *
   * @param config - Service configuration
   */
  constructor(config: CryptoServiceConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.vault = new KeyVault();
  }

  /**
   * Execute a crypto operation
   *
   * This is the main entry point for all cryptographic operations.
   * All inputs are validated against TypeBox schemas before execution.
   *
   * @param request - The operation request
   * @returns Operation response with result and audit entry
   */
  async execute(request: unknown): Promise<CryptoServiceResponse> {
    const timestamp = Date.now();
    const id = crypto.randomUUID();

    // Validate request against schema
    if (!Value.Check(CryptoServiceRequestSchema, request)) {
      const errors = [...Value.Errors(CryptoServiceRequestSchema, request)];
      const errorMessage = errors.map((e) => `${e.path}: ${e.message}`).join(", ");

      const auditEntry = this.createAuditEntry(
        id,
        timestamp,
        "unknown",
        undefined,
        false,
        "VALIDATION_FAILED",
        { errors: errorMessage },
      );

      return {
        success: false,
        error: `Validation failed: ${errorMessage}`,
        errorCode: "VALIDATION_FAILED",
        auditEntry,
      };
    }

    // Type-safe request after validation
    const validRequest = request;

    try {
      switch (validRequest.action) {
        case "sign":
          return await this.handleSign(validRequest, id, timestamp);
        case "verify":
          return await this.handleVerify(validRequest, id, timestamp);
        case "encrypt":
          return await this.handleEncrypt(validRequest, id, timestamp);
        case "decrypt":
          return await this.handleDecrypt(validRequest, id, timestamp);
        case "derive-key":
          return await this.handleDeriveKey(validRequest, id, timestamp);
        case "generate-ephemeral":
          return await this.handleGenerateEphemeral(validRequest, id, timestamp);
        case "import-key":
          return await this.handleImportKey(validRequest, id, timestamp);
        case "get-public-key":
          return await this.handleGetPublicKey(validRequest, id, timestamp);
        case "wipe-key":
          return await this.handleWipeKey(validRequest, id, timestamp);
        case "stats":
          return await this.handleStats(validRequest, id, timestamp);
        default:
          // TypeScript exhaustiveness check
          const _exhaustive: never = validRequest;
          throw new CryptoServiceError("INVALID_REQUEST", "Unknown action");
      }
    } catch (error) {
      // Handle known errors
      if (error instanceof KeyVaultError) {
        const auditEntry = this.createAuditEntry(
          id,
          timestamp,
          validRequest.action,
          "keyRefId" in validRequest ? validRequest.keyRefId : undefined,
          false,
          error.code,
        );

        return {
          success: false,
          error: error.message,
          errorCode: error.code as CryptoServiceErrorCode,
          auditEntry,
        };
      }

      if (error instanceof CryptoServiceError) {
        const auditEntry = this.createAuditEntry(
          id,
          timestamp,
          validRequest.action,
          "keyRefId" in validRequest ? validRequest.keyRefId : undefined,
          false,
          error.code,
        );

        return {
          success: false,
          error: error.message,
          errorCode: error.code,
          auditEntry,
        };
      }

      // Unknown error
      const auditEntry = this.createAuditEntry(
        id,
        timestamp,
        validRequest.action,
        "keyRefId" in validRequest ? validRequest.keyRefId : undefined,
        false,
        "INTERNAL_ERROR",
      );

      return {
        success: false,
        error: "Internal error",
        errorCode: "INTERNAL_ERROR",
        auditEntry,
      };
    }
  }

  /**
   * Get audit log entries
   *
   * @param limit - Maximum entries to return
   * @returns Recent audit log entries (newest first)
   */
  getAuditLog(limit: number = 100): AuditLogEntry[] {
    return this.auditLog.slice(-limit).toReversed();
  }

  /**
   * Clear the audit log
   */
  clearAuditLog(): void {
    this.auditLog.length = 0;
  }

  /**
   * Get vault statistics
   */
  getVaultStats(): VaultStats {
    return this.vault.stats();
  }

  /**
   * Seal the vault - prevents all future operations
   */
  seal(): void {
    this.vault.seal();
  }

  // ==========================================================================
  // Request Handlers
  // ==========================================================================

  private async handleSign(
    request: SignRequest,
    id: string,
    timestamp: number,
  ): Promise<CryptoServiceResponse<SignResult>> {
    const messageHash = Buffer.from(request.messageHash, "hex");
    const signature = this.vault.sign(request.keyRefId, messageHash);

    const auditEntry = this.createAuditEntry(
      id,
      timestamp,
      "sign",
      request.keyRefId,
      true,
      undefined,
      { messageHashPrefix: request.messageHash.substring(0, 16) },
    );

    return {
      success: true,
      result: { signature: signature.toString("hex") },
      auditEntry,
    };
  }

  private async handleVerify(
    request: VerifyRequest,
    id: string,
    timestamp: number,
  ): Promise<CryptoServiceResponse<VerifyResult>> {
    const publicKey = BSVCrypto.publicKeyFromHex(request.publicKey);
    const signature = Buffer.from(request.signature, "hex");

    const valid = BSVCrypto.verify(publicKey, request.messageHash, signature);

    const auditEntry = this.createAuditEntry(id, timestamp, "verify", undefined, true, undefined, {
      valid,
      publicKeyPrefix: request.publicKey.substring(0, 16),
    });

    return {
      success: true,
      result: { valid },
      auditEntry,
    };
  }

  private async handleEncrypt(
    request: EncryptRequest,
    id: string,
    timestamp: number,
  ): Promise<CryptoServiceResponse<EncryptResult>> {
    const recipientPublicKey = BSVCrypto.publicKeyFromHex(request.recipientPublicKey);
    const plaintext = Buffer.from(request.plaintextHex, "hex");

    // Use KeyVault's internal encrypt method (keeps key inside vault)
    const ciphertextObj = this.vault.encrypt(request.keyRefId, plaintext, recipientPublicKey);
    const ciphertext = serializeCiphertext(ciphertextObj);

    const auditEntry = this.createAuditEntry(
      id,
      timestamp,
      "encrypt",
      request.keyRefId,
      true,
      undefined,
      {
        plaintextLength: plaintext.length,
        recipientKeyPrefix: request.recipientPublicKey.substring(0, 16),
      },
    );

    return {
      success: true,
      result: { ciphertext: ciphertext.toString("hex") },
      auditEntry,
    };
  }

  private async handleDecrypt(
    request: DecryptRequest,
    id: string,
    timestamp: number,
  ): Promise<CryptoServiceResponse<DecryptResult>> {
    const ciphertextBytes = Buffer.from(request.ciphertextHex, "hex");
    const ciphertextObj = deserializeCiphertext(ciphertextBytes);
    const senderPublicKey = BSVCrypto.publicKeyFromHex(request.senderPublicKey);

    const plaintext = this.vault.decrypt(request.keyRefId, ciphertextObj, senderPublicKey);

    const auditEntry = this.createAuditEntry(
      id,
      timestamp,
      "decrypt",
      request.keyRefId,
      true,
      undefined,
      {
        ciphertextLength: ciphertextBytes.length,
        senderKeyPrefix: request.senderPublicKey.substring(0, 16),
      },
    );

    return {
      success: true,
      result: { plaintext: plaintext.toString("hex") },
      auditEntry,
    };
  }

  private async handleDeriveKey(
    request: DeriveKeyRequest,
    id: string,
    timestamp: number,
  ): Promise<CryptoServiceResponse<DeriveKeyResult>> {
    const counterpartyPublicKey = BSVCrypto.publicKeyFromHex(request.counterpartyPublicKey);

    // Build invoice number from protocol ID and key ID
    // SECURITY: Protocol ID and Key ID are validated by TypeBox
    const invoiceNumber = buildInvoiceNumber(request.protocolID as ProtocolID, request.keyID);

    // Derive child key using vault's internal method (key never leaves vault)
    const keyRefId = this.vault.deriveChildKey(
      request.keyRefId,
      counterpartyPublicKey,
      invoiceNumber,
      this.config.defaultKeyTtlMs,
    );

    // Get the derived public key (safe to expose)
    const publicKey = this.vault.getPublicKey(keyRefId).toHex();

    const auditEntry = this.createAuditEntry(
      id,
      timestamp,
      "derive-key",
      keyRefId,
      true,
      undefined,
      {
        parentKeyRefId: request.keyRefId,
        protocolID: `${request.protocolID[0]}:${request.protocolID[1]}`,
        keyID: request.keyID,
      },
    );

    return {
      success: true,
      result: { publicKey, keyRefId },
      auditEntry,
    };
  }

  private async handleGenerateEphemeral(
    request: GenerateEphemeralRequest,
    id: string,
    timestamp: number,
  ): Promise<CryptoServiceResponse<GenerateEphemeralResult>> {
    const ttlMs = request.ttlMs ?? this.config.defaultKeyTtlMs;

    // Generate random key
    const privateKey = BSVCrypto.privateKeyFromRandom();
    const publicKey = privateKey.toPublicKey().toHex();

    // Store in vault (returns reference only)
    const keyRefId = this.vault.store(privateKey, ttlMs);

    const auditEntry = this.createAuditEntry(
      id,
      timestamp,
      "generate-ephemeral",
      keyRefId,
      true,
      undefined,
      { ttlMs },
    );

    return {
      success: true,
      result: { publicKey, keyRefId },
      auditEntry,
    };
  }

  private async handleImportKey(
    request: ImportKeyRequest,
    id: string,
    timestamp: number,
  ): Promise<CryptoServiceResponse<ImportKeyResult>> {
    const ttlMs = request.ttlMs ?? this.config.defaultKeyTtlMs;

    const privateKey = BSVCrypto.privateKeyFromHex(request.privateKeyHex);
    const publicKey = privateKey.toPublicKey().toHex();

    const keyRefId = this.vault.store(privateKey, ttlMs);

    const auditEntry = this.createAuditEntry(
      id,
      timestamp,
      "import-key",
      keyRefId,
      true,
      undefined,
      { ttlMs },
    );

    // NOTE: Caller should zero-fill request.privateKeyHex after this call
    // We cannot do it here because strings are immutable in JS

    return {
      success: true,
      result: { keyRefId, publicKey },
      auditEntry,
    };
  }

  private async handleGetPublicKey(
    request: GetPublicKeyRequest,
    id: string,
    timestamp: number,
  ): Promise<CryptoServiceResponse<GetPublicKeyResult>> {
    const publicKey = this.vault.getPublicKey(request.keyRefId);

    const auditEntry = this.createAuditEntry(
      id,
      timestamp,
      "get-public-key",
      request.keyRefId,
      true,
    );

    return {
      success: true,
      result: { publicKey: publicKey.toHex() },
      auditEntry,
    };
  }

  private async handleWipeKey(
    request: WipeKeyRequest,
    id: string,
    timestamp: number,
  ): Promise<CryptoServiceResponse<WipeKeyResult>> {
    this.vault.wipe(request.keyRefId);

    const auditEntry = this.createAuditEntry(id, timestamp, "wipe-key", request.keyRefId, true);

    return {
      success: true,
      result: { wiped: true },
      auditEntry,
    };
  }

  private async handleStats(
    _request: StatsRequest,
    id: string,
    timestamp: number,
  ): Promise<CryptoServiceResponse<StatsResult>> {
    const vaultStats = this.vault.stats();

    const auditEntry = this.createAuditEntry(id, timestamp, "stats", undefined, true, undefined, {
      keyCount: vaultStats.keyCount,
    });

    return {
      success: true,
      result: { vaultStats },
      auditEntry,
    };
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private createAuditEntry(
    id: string,
    timestamp: number,
    action: string,
    keyRefId?: string,
    success: boolean = true,
    errorCode?: string,
    metadata?: Record<string, string | number | boolean>,
  ): AuditLogEntry {
    const entry: AuditLogEntry = {
      id,
      timestamp,
      action,
      keyRefId,
      success,
      errorCode,
      metadata,
    };

    if (this.config.enableAuditLog) {
      this.auditLog.push(entry);

      // Trim log if it exceeds max size
      if (this.auditLog.length > this.config.maxAuditLogSize) {
        this.auditLog.splice(0, this.auditLog.length - this.config.maxAuditLogSize);
      }
    }

    return entry;
  }
}
