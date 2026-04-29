/**
 * BRC-42 Key Derivation Service
 *
 * Provides a clean service interface for BRC-42/43 key derivation with:
 * - Protocol ID + Key ID → Invoice Number construction
 * - Hardened path enforcement (always)
 * - Support for security levels 0, 1, 2
 *
 * @see https://github.com/bitcoin-sv/BRCs/blob/master/wallet/0042.md
 * @see https://github.com/bitcoin-sv/BRCs/blob/master/wallet/0043.md
 * @see INTEGRATION-SPEC.md Section 2
 */

import type {
  ProtocolID,
  SecurityLevel,
  Counterparty,
  KeyDerivationParams,
} from "../types/bsv-auth.js";
import {
  BSVCrypto,
  SecurePrivateKey,
  SecurePublicKey,
  deriveSharedSecret,
} from "../crypto/bsv-sdk-wrapper.js";

/**
 * Key derivation error codes
 */
export type KeyDerivationErrorCode =
  | "INVALID_SECURITY_LEVEL"
  | "INVALID_PROTOCOL_ID"
  | "INVALID_KEY_ID"
  | "NON_HARDENED_PATH"
  | "INVALID_COUNTERPARTY"
  | "INVOICE_TOO_LONG"
  | "DERIVATION_FAILED";

/**
 * Custom error for key derivation failures
 */
export class KeyDerivationError extends Error {
  readonly code: KeyDerivationErrorCode;
  readonly httpCode: number;

  constructor(code: KeyDerivationErrorCode, message: string, httpCode: number = 400) {
    super(message);
    this.name = "KeyDerivationError";
    this.code = code;
    this.httpCode = httpCode;
  }
}

/**
 * Maximum invoice number length (BRC-42 constraint)
 */
const MAX_INVOICE_LENGTH = 1024;

/**
 * Valid security levels per BRC-43
 */
const VALID_SECURITY_LEVELS: Set<SecurityLevel> = new Set([0, 1, 2]);

/**
 * Validate security level
 */
function validateSecurityLevel(level: number): asserts level is SecurityLevel {
  if (!VALID_SECURITY_LEVELS.has(level as SecurityLevel)) {
    throw new KeyDerivationError(
      "INVALID_SECURITY_LEVEL",
      `Invalid security level: ${level}. Must be 0, 1, or 2.`,
    );
  }
}

/**
 * Validate protocol ID format
 */
function validateProtocolID(protocolID: ProtocolID): void {
  if (!Array.isArray(protocolID) || protocolID.length !== 2) {
    throw new KeyDerivationError(
      "INVALID_PROTOCOL_ID",
      "Protocol ID must be a tuple of [SecurityLevel, string]",
    );
  }

  const [level, protocol] = protocolID;

  validateSecurityLevel(level);

  if (typeof protocol !== "string" || protocol.trim().length === 0) {
    throw new KeyDerivationError(
      "INVALID_PROTOCOL_ID",
      "Protocol string must be a non-empty string",
    );
  }
}

/**
 * Validate key ID
 */
function validateKeyID(keyID: string): void {
  if (typeof keyID !== "string" || keyID.trim().length === 0) {
    throw new KeyDerivationError("INVALID_KEY_ID", "Key ID must be a non-empty string");
  }
}

/**
 * Validate counterparty for security level
 */
function validateCounterparty(
  counterparty: Counterparty | undefined,
  securityLevel: SecurityLevel,
): void {
  if (securityLevel === 2) {
    // Level 2 requires specific counterparty (not 'anyone')
    if (counterparty === "anyone") {
      throw new KeyDerivationError(
        "INVALID_COUNTERPARTY",
        "Security level 2 requires a specific counterparty public key, not 'anyone'",
      );
    }
    if (!counterparty || counterparty === "self") {
      // 'self' is allowed for level 2
      return;
    }
    // Must be a valid public key (33 bytes hex = 66 chars)
    if (!/^[0-9a-fA-F]{66}$/.test(counterparty)) {
      throw new KeyDerivationError(
        "INVALID_COUNTERPARTY",
        "Counterparty must be a valid compressed public key (66 hex chars)",
      );
    }
  }
}

/**
 * Build BRC-43 invoice number from protocol ID and key ID
 *
 * Format: "{securityLevel} {protocolID} {keyID}"
 *
 * @param protocolID - Protocol identifier [SecurityLevel, string]
 * @param keyID - Unique key identifier within protocol
 * @returns Invoice number string
 * @throws KeyDerivationError if parameters are invalid
 *
 * @example
 * ```typescript
 * const invoice = buildInvoiceNumber([2, "message encryption"], "abc123");
 * // Returns: "2 message encryption abc123"
 * ```
 */
export function buildInvoiceNumber(protocolID: ProtocolID, keyID: string): string {
  validateProtocolID(protocolID);
  validateKeyID(keyID);

  const [securityLevel, protocol] = protocolID;

  const invoiceNumber = `${securityLevel} ${protocol} ${keyID}`;

  if (invoiceNumber.length > MAX_INVOICE_LENGTH) {
    throw new KeyDerivationError(
      "INVOICE_TOO_LONG",
      `Invoice number exceeds maximum length of ${MAX_INVOICE_LENGTH} characters`,
    );
  }

  return invoiceNumber;
}

/**
 * Derive a child private key using BRC-42
 *
 * This function enforces hardened derivation paths for security.
 *
 * @param masterPrivateKey - Master (identity) private key
 * @param counterpartyPublicKey - Counterparty's public key for derivation
 * @param params - Key derivation parameters
 * @returns Derived child private key
 * @throws KeyDerivationError on invalid parameters or derivation failure
 */
export function deriveChildPrivateKey(
  masterPrivateKey: SecurePrivateKey,
  counterpartyPublicKey: SecurePublicKey,
  params: KeyDerivationParams,
): SecurePrivateKey {
  validateProtocolID(params.protocolID);
  validateKeyID(params.keyID);
  validateCounterparty(params.counterparty, params.protocolID[0]);

  const invoiceNumber = buildInvoiceNumber(params.protocolID, params.keyID);

  try {
    // Derive child key using BSV SDK wrapper
    const derivedKey = BSVCrypto.derivePrivateKey(
      masterPrivateKey,
      counterpartyPublicKey,
      invoiceNumber,
    );

    return derivedKey;
  } catch (error) {
    throw new KeyDerivationError(
      "DERIVATION_FAILED",
      `Key derivation failed: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
}

/**
 * Derive a child public key using BRC-42
 *
 * This allows deriving a public key that the counterparty can unlock
 * with their corresponding private key derivation.
 *
 * @param senderPrivateKey - Sender's private key
 * @param recipientPublicKey - Recipient's public key
 * @param params - Key derivation parameters
 * @returns Derived child public key
 * @throws KeyDerivationError on invalid parameters or derivation failure
 */
export function deriveChildPublicKey(
  senderPrivateKey: SecurePrivateKey,
  recipientPublicKey: SecurePublicKey,
  params: KeyDerivationParams,
): SecurePublicKey {
  validateProtocolID(params.protocolID);
  validateKeyID(params.keyID);
  validateCounterparty(params.counterparty, params.protocolID[0]);

  const invoiceNumber = buildInvoiceNumber(params.protocolID, params.keyID);

  try {
    // Use the internal deriveChild on public key via BSV SDK
    const recipientRawPubKey = recipientPublicKey._dangerouslyGetRawKey();
    const senderRawPrivKey = senderPrivateKey._dangerouslyGetRawKey();

    const derivedPubKey = recipientRawPubKey.deriveChild(senderRawPrivKey, invoiceNumber);

    return new SecurePublicKey(derivedPubKey);
  } catch (error) {
    throw new KeyDerivationError(
      "DERIVATION_FAILED",
      `Public key derivation failed: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
}

/**
 * Key Derivation Service class for stateful operations
 *
 * This class maintains a master private key and provides convenient
 * methods for key derivation operations.
 *
 * @example
 * ```typescript
 * const service = new KeyDerivationService(masterKey);
 *
 * // Derive a private key for a counterparty
 * const childKey = service.derivePrivateKey(counterpartyPubKey, {
 *   protocolID: [2, "auth"],
 *   keyID: "session-123"
 * });
 *
 * // Get shared secret for encryption
 * const secret = service.deriveSharedSecret(theirPubKey, "encryption");
 * ```
 */
export class KeyDerivationService {
  private readonly masterPrivateKey: SecurePrivateKey;
  private readonly identityPublicKey: SecurePublicKey;

  /**
   * Create a new KeyDerivationService
   *
   * @param masterPrivateKey - Master (identity) private key
   */
  constructor(masterPrivateKey: SecurePrivateKey) {
    this.masterPrivateKey = masterPrivateKey;
    this.identityPublicKey = masterPrivateKey.toPublicKey();
  }

  /**
   * Create a KeyDerivationService from a hex private key
   *
   * @param privateKeyHex - Private key as 64-character hex string
   * @returns New KeyDerivationService instance
   */
  static fromHex(privateKeyHex: string): KeyDerivationService {
    const masterKey = BSVCrypto.privateKeyFromHex(privateKeyHex);
    return new KeyDerivationService(masterKey);
  }

  /**
   * Create a KeyDerivationService with a randomly generated key
   *
   * @returns New KeyDerivationService with random master key
   */
  static fromRandom(): KeyDerivationService {
    const masterKey = BSVCrypto.privateKeyFromRandom();
    return new KeyDerivationService(masterKey);
  }

  /**
   * Get the identity public key
   *
   * @returns The master public key (identity key)
   */
  getIdentityPublicKey(): SecurePublicKey {
    return this.identityPublicKey;
  }

  /**
   * Get the identity public key as hex string
   *
   * @returns 66-character hex string (compressed public key)
   */
  getIdentityPublicKeyHex(): string {
    return this.identityPublicKey.toHex();
  }

  /**
   * Derive a child private key
   *
   * @param counterpartyPublicKey - Counterparty's public key (hex string or SecurePublicKey)
   * @param params - Key derivation parameters
   * @returns Derived child private key
   */
  derivePrivateKey(
    counterpartyPublicKey: SecurePublicKey | string,
    params: KeyDerivationParams,
  ): SecurePrivateKey {
    const pubKey =
      typeof counterpartyPublicKey === "string"
        ? BSVCrypto.publicKeyFromHex(counterpartyPublicKey)
        : counterpartyPublicKey;

    return deriveChildPrivateKey(this.masterPrivateKey, pubKey, params);
  }

  /**
   * Derive a child public key for a recipient
   *
   * @param recipientPublicKey - Recipient's public key (hex string or SecurePublicKey)
   * @param params - Key derivation parameters
   * @returns Derived child public key
   */
  derivePublicKey(
    recipientPublicKey: SecurePublicKey | string,
    params: KeyDerivationParams,
  ): SecurePublicKey {
    const pubKey =
      typeof recipientPublicKey === "string"
        ? BSVCrypto.publicKeyFromHex(recipientPublicKey)
        : recipientPublicKey;

    return deriveChildPublicKey(this.masterPrivateKey, pubKey, params);
  }

  /**
   * Derive a shared secret with a counterparty
   *
   * Uses ECDH + HKDF-SHA256 per NIST SP 800-56A Rev 3.
   * The raw ECDH output is never used directly.
   *
   * @param counterpartyPublicKey - Counterparty's public key (hex string or SecurePublicKey)
   * @param context - Context string for HKDF (default: "BRC-42")
   * @returns Derived shared secret (32 bytes)
   */
  deriveSharedSecret(
    counterpartyPublicKey: SecurePublicKey | string,
    context: string = "BRC-42",
  ): Buffer {
    const pubKey =
      typeof counterpartyPublicKey === "string"
        ? BSVCrypto.publicKeyFromHex(counterpartyPublicKey)
        : counterpartyPublicKey;

    return deriveSharedSecret(this.masterPrivateKey, pubKey, context);
  }

  /**
   * Sign a message hash using the master private key
   *
   * Uses RFC 6979 deterministic k generation.
   *
   * @param messageHash - SHA-256 hash of message (32 bytes hex, 64 chars)
   * @returns DER-encoded signature
   */
  sign(messageHash: string): Buffer {
    return BSVCrypto.sign(this.masterPrivateKey, messageHash);
  }

  /**
   * Derive a child key and sign with it
   *
   * @param messageHash - SHA-256 hash of message (32 bytes hex)
   * @param counterpartyPublicKey - Counterparty's public key
   * @param params - Key derivation parameters
   * @returns DER-encoded signature from derived key
   */
  deriveAndSign(
    messageHash: string,
    counterpartyPublicKey: SecurePublicKey | string,
    params: KeyDerivationParams,
  ): Buffer {
    const derivedKey = this.derivePrivateKey(counterpartyPublicKey, params);
    return BSVCrypto.sign(derivedKey, messageHash);
  }
}

/**
 * Convenience function to create a BRC-43 protocol ID
 *
 * @param securityLevel - Security level (0, 1, or 2)
 * @param protocol - Protocol name string
 * @returns Protocol ID tuple
 */
export function createProtocolID(securityLevel: SecurityLevel, protocol: string): ProtocolID {
  validateSecurityLevel(securityLevel);

  if (typeof protocol !== "string" || protocol.trim().length === 0) {
    throw new KeyDerivationError(
      "INVALID_PROTOCOL_ID",
      "Protocol string must be a non-empty string",
    );
  }

  return [securityLevel, protocol];
}

/**
 * Standard protocol IDs for common use cases
 */
export const StandardProtocols = {
  /** Message encryption (BRC-78) */
  MESSAGE_ENCRYPTION: [2, "message encryption"] as ProtocolID,

  /** Authentication (BRC-103) */
  AUTH: [2, "auth"] as ProtocolID,

  /** Certificate operations (BRC-52) */
  CERTIFICATES: [2, "certificates"] as ProtocolID,

  /** Public discovery (level 1, anyone can derive) */
  PUBLIC_DISCOVERY: [1, "public"] as ProtocolID,
} as const;

/**
 * Re-export types for convenience
 */
export type { SecurePrivateKey, SecurePublicKey } from "../crypto/bsv-sdk-wrapper.js";
export type {
  ProtocolID,
  SecurityLevel,
  Counterparty,
  KeyDerivationParams,
} from "../types/bsv-auth.js";
