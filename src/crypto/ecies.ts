/**
 * ECIES Encryption (BRC-78)
 *
 * Implements Elliptic Curve Integrated Encryption Scheme following
 * the BRC-78 specification for portable encrypted messages.
 *
 * Features:
 * - BRC-42 key derivation for sender/recipient child keys
 * - ECDH + HKDF-SHA256 for shared secret derivation
 * - AES-256-GCM for authenticated encryption
 * - BRC-78 compliant serialization format
 *
 * @see https://github.com/bitcoin-sv/BRCs/blob/master/peer-to-peer/0078.md
 * @see INTEGRATION-SPEC.md Section 3
 */

import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import type { ProtocolID } from "../types/bsv-auth.js";
import {
  BSVCrypto,
  SecurePrivateKey,
  SecurePublicKey,
  deriveSharedSecret,
} from "./bsv-sdk-wrapper.js";

/**
 * BRC-78 version identifier
 */
export const BRC78_VERSION = 0x42421033;

/**
 * Cryptographic parameters
 */
const CRYPTO_PARAMS = {
  /** AES-256-GCM cipher */
  CIPHER: "aes-256-gcm" as const,
  /** IV length in bytes (96 bits) */
  IV_LENGTH: 12,
  /** Auth tag length in bytes (128 bits) */
  AUTH_TAG_LENGTH: 16,
  /** Encryption key length in bytes (256 bits) */
  KEY_LENGTH: 32,
  /** Key ID length in bytes */
  KEY_ID_LENGTH: 32,
  /** Compressed public key length in bytes */
  PUBLIC_KEY_LENGTH: 33,
  /** Version field length in bytes */
  VERSION_LENGTH: 4,
} as const;

/**
 * HKDF info string for BRC-78 encryption
 */
const HKDF_INFO = "BRC-78-encryption";

/**
 * Default protocol ID for message encryption
 */
const DEFAULT_PROTOCOL_ID: ProtocolID = [2, "message encryption"];

/**
 * ECIES error codes
 */
export type ECIESErrorCode =
  | "INVALID_RECIPIENT"
  | "INVALID_SENDER"
  | "INVALID_CIPHERTEXT"
  | "INVALID_VERSION"
  | "DECRYPTION_FAILED"
  | "KEY_DERIVATION_FAILED";

/**
 * Custom error for ECIES operations
 */
export class ECIESError extends Error {
  readonly code: ECIESErrorCode;
  readonly httpCode: number;

  constructor(code: ECIESErrorCode, message: string, httpCode: number = 400) {
    super(message);
    this.name = "ECIESError";
    this.code = code;
    this.httpCode = httpCode;
  }
}

/**
 * ECIES encryption options
 */
export interface ECIESOptions {
  /** Protocol ID for key derivation (default: [2, "message encryption"]) */
  protocolID?: ProtocolID;
  /** Additional authenticated data for AES-GCM */
  aad?: Buffer;
}

/**
 * ECIES ciphertext structure
 */
export interface ECIESCiphertext {
  /** Version (0x42421033) */
  version: number;
  /** Sender's identity public key (33 bytes hex) */
  senderPublicKey: string;
  /** Recipient's identity public key (33 bytes hex) */
  recipientPublicKey: string;
  /** Random key ID (32 bytes hex) */
  keyID: string;
  /** IV + ciphertext + auth tag */
  ciphertext: Buffer;
}

/**
 * Build BRC-43 invoice number for message encryption
 *
 * @param keyID - Random key ID (32 bytes)
 * @param protocolID - Protocol ID (default: [2, "message encryption"])
 * @returns Invoice number string
 */
function buildEncryptionInvoiceNumber(
  keyID: Buffer,
  protocolID: ProtocolID = DEFAULT_PROTOCOL_ID,
): string {
  const [securityLevel, protocol] = protocolID;
  const keyIDBase64 = keyID.toString("base64");
  return `${securityLevel} ${protocol} ${keyIDBase64}`;
}

/**
 * Derive encryption key from sender and recipient keys using BRC-42 + ECDH + HKDF
 *
 * @param senderPrivateKey - Sender's private key
 * @param recipientPublicKey - Recipient's public key
 * @param invoiceNumber - BRC-43 invoice number
 * @returns Encryption key (32 bytes)
 */
function deriveEncryptionKey(
  senderPrivateKey: SecurePrivateKey,
  recipientPublicKey: SecurePublicKey,
  invoiceNumber: string,
): Buffer {
  try {
    // Step 1: Derive child private key for sender
    const senderChildPrivKey = BSVCrypto.derivePrivateKey(
      senderPrivateKey,
      recipientPublicKey,
      invoiceNumber,
    );

    // Step 2: Derive child public key for recipient
    const recipientRawPubKey = recipientPublicKey._dangerouslyGetRawKey();
    const senderRawPrivKey = senderPrivateKey._dangerouslyGetRawKey();
    const recipientChildPubKey = recipientRawPubKey.deriveChild(senderRawPrivKey, invoiceNumber);
    const recipientChildSecurePubKey = new SecurePublicKey(recipientChildPubKey);

    // Step 3: Compute shared secret using derived keys
    const sharedSecret = deriveSharedSecret(
      senderChildPrivKey,
      recipientChildSecurePubKey,
      HKDF_INFO,
    );

    return sharedSecret;
  } catch (error) {
    throw new ECIESError(
      "KEY_DERIVATION_FAILED",
      `Failed to derive encryption key: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
}

/**
 * Encrypt a message using BRC-78 ECIES
 *
 * Algorithm:
 * 1. Generate random keyID (32 bytes)
 * 2. Build BRC-43 invoice number
 * 3. Derive child keys using BRC-42
 * 4. Compute shared secret via ECDH
 * 5. Derive encryption key via HKDF
 * 6. Encrypt with AES-256-GCM
 *
 * @param plaintext - Message to encrypt
 * @param senderPrivateKey - Sender's identity private key
 * @param recipientPublicKey - Recipient's identity public key
 * @param options - Encryption options
 * @returns ECIES ciphertext structure
 */
export function encrypt(
  plaintext: Buffer,
  senderPrivateKey: SecurePrivateKey,
  recipientPublicKey: SecurePublicKey,
  options: ECIESOptions = {},
): ECIESCiphertext {
  const { protocolID = DEFAULT_PROTOCOL_ID, aad } = options;

  // Generate random key ID
  const keyID = randomBytes(CRYPTO_PARAMS.KEY_ID_LENGTH);

  // Build invoice number
  const invoiceNumber = buildEncryptionInvoiceNumber(keyID, protocolID);

  // Derive encryption key
  const encryptionKey = deriveEncryptionKey(senderPrivateKey, recipientPublicKey, invoiceNumber);

  // Generate random IV
  const iv = randomBytes(CRYPTO_PARAMS.IV_LENGTH);

  // Encrypt with AES-256-GCM
  const cipher = createCipheriv(CRYPTO_PARAMS.CIPHER, encryptionKey, iv);

  if (aad) {
    cipher.setAAD(aad);
  }

  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Combine IV + ciphertext + auth tag
  const ciphertext = Buffer.concat([iv, encrypted, authTag]);

  return {
    version: BRC78_VERSION,
    senderPublicKey: senderPrivateKey.toPublicKey().toHex(),
    recipientPublicKey: recipientPublicKey.toHex(),
    keyID: keyID.toString("hex"),
    ciphertext,
  };
}

/**
 * Decrypt a message using BRC-78 ECIES
 *
 * Algorithm:
 * 1. Parse ciphertext structure
 * 2. Build BRC-43 invoice number from keyID
 * 3. Derive child keys using BRC-42
 * 4. Compute shared secret via ECDH
 * 5. Derive encryption key via HKDF
 * 6. Decrypt with AES-256-GCM
 *
 * @param ciphertext - ECIES ciphertext structure
 * @param recipientPrivateKey - Recipient's identity private key
 * @param senderPublicKey - Sender's identity public key
 * @param options - Decryption options
 * @returns Decrypted plaintext
 */
export function decrypt(
  ciphertext: ECIESCiphertext,
  recipientPrivateKey: SecurePrivateKey,
  senderPublicKey: SecurePublicKey,
  options: ECIESOptions = {},
): Buffer {
  const { protocolID = DEFAULT_PROTOCOL_ID, aad } = options;

  // Validate version
  if (ciphertext.version !== BRC78_VERSION) {
    throw new ECIESError(
      "INVALID_VERSION",
      `Invalid BRC-78 version: expected 0x${BRC78_VERSION.toString(16)}, got 0x${ciphertext.version.toString(16)}`,
    );
  }

  // Validate ciphertext length (must have at least IV + auth tag)
  const minLength = CRYPTO_PARAMS.IV_LENGTH + CRYPTO_PARAMS.AUTH_TAG_LENGTH;
  if (ciphertext.ciphertext.length < minLength) {
    throw new ECIESError(
      "INVALID_CIPHERTEXT",
      `Ciphertext too short: ${ciphertext.ciphertext.length} bytes (minimum ${minLength})`,
    );
  }

  // Parse key ID
  const keyID = Buffer.from(ciphertext.keyID, "hex");
  if (keyID.length !== CRYPTO_PARAMS.KEY_ID_LENGTH) {
    throw new ECIESError(
      "INVALID_CIPHERTEXT",
      `Invalid key ID length: ${keyID.length} bytes (expected ${CRYPTO_PARAMS.KEY_ID_LENGTH})`,
    );
  }

  // Build invoice number
  const invoiceNumber = buildEncryptionInvoiceNumber(keyID, protocolID);

  // Derive encryption key (from recipient's perspective)
  // Recipient derives their child private key using sender's public key
  const recipientChildPrivKey = BSVCrypto.derivePrivateKey(
    recipientPrivateKey,
    senderPublicKey,
    invoiceNumber,
  );

  // Sender's child public key
  const senderRawPubKey = senderPublicKey._dangerouslyGetRawKey();
  const recipientRawPrivKey = recipientPrivateKey._dangerouslyGetRawKey();
  const senderChildPubKey = senderRawPubKey.deriveChild(recipientRawPrivKey, invoiceNumber);
  const senderChildSecurePubKey = new SecurePublicKey(senderChildPubKey);

  // Compute shared secret
  const sharedSecret = deriveSharedSecret(
    recipientChildPrivKey,
    senderChildSecurePubKey,
    HKDF_INFO,
  );

  // Extract IV, encrypted data, and auth tag
  const iv = ciphertext.ciphertext.subarray(0, CRYPTO_PARAMS.IV_LENGTH);
  const authTag = ciphertext.ciphertext.subarray(-CRYPTO_PARAMS.AUTH_TAG_LENGTH);
  const encryptedData = ciphertext.ciphertext.subarray(
    CRYPTO_PARAMS.IV_LENGTH,
    -CRYPTO_PARAMS.AUTH_TAG_LENGTH,
  );

  // Decrypt with AES-256-GCM
  try {
    const decipher = createDecipheriv(CRYPTO_PARAMS.CIPHER, sharedSecret, iv);
    decipher.setAuthTag(authTag);

    if (aad) {
      decipher.setAAD(aad);
    }

    const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    return decrypted;
  } catch {
    throw new ECIESError(
      "DECRYPTION_FAILED",
      "Decryption failed: authentication tag verification failed or corrupted ciphertext",
    );
  }
}

/**
 * Serialize ECIES ciphertext to bytes (BRC-78 format)
 *
 * Format:
 * | Version (4) | Sender ID (33) | Recipient ID (33) | Key ID (32) | Ciphertext (var) |
 *
 * @param ciphertext - ECIES ciphertext structure
 * @returns Serialized bytes
 */
export function serializeCiphertext(ciphertext: ECIESCiphertext): Buffer {
  // Validate version
  if (ciphertext.version !== BRC78_VERSION) {
    throw new ECIESError("INVALID_VERSION", `Invalid BRC-78 version: ${ciphertext.version}`);
  }

  // Parse public keys
  const senderPubKey = Buffer.from(ciphertext.senderPublicKey, "hex");
  const recipientPubKey = Buffer.from(ciphertext.recipientPublicKey, "hex");
  const keyID = Buffer.from(ciphertext.keyID, "hex");

  // Validate lengths
  if (senderPubKey.length !== CRYPTO_PARAMS.PUBLIC_KEY_LENGTH) {
    throw new ECIESError(
      "INVALID_SENDER",
      `Invalid sender public key length: ${senderPubKey.length}`,
    );
  }
  if (recipientPubKey.length !== CRYPTO_PARAMS.PUBLIC_KEY_LENGTH) {
    throw new ECIESError(
      "INVALID_RECIPIENT",
      `Invalid recipient public key length: ${recipientPubKey.length}`,
    );
  }
  if (keyID.length !== CRYPTO_PARAMS.KEY_ID_LENGTH) {
    throw new ECIESError("INVALID_CIPHERTEXT", `Invalid key ID length: ${keyID.length}`);
  }

  // Create version buffer (big-endian)
  const versionBuffer = Buffer.alloc(CRYPTO_PARAMS.VERSION_LENGTH);
  versionBuffer.writeUInt32BE(ciphertext.version);

  return Buffer.concat([
    versionBuffer,
    senderPubKey,
    recipientPubKey,
    keyID,
    ciphertext.ciphertext,
  ]);
}

/**
 * Deserialize ECIES ciphertext from bytes (BRC-78 format)
 *
 * @param data - Serialized bytes
 * @returns ECIES ciphertext structure
 */
export function deserializeCiphertext(data: Buffer): ECIESCiphertext {
  const headerLength =
    CRYPTO_PARAMS.VERSION_LENGTH +
    CRYPTO_PARAMS.PUBLIC_KEY_LENGTH * 2 +
    CRYPTO_PARAMS.KEY_ID_LENGTH;

  if (data.length < headerLength) {
    throw new ECIESError(
      "INVALID_CIPHERTEXT",
      `Data too short for BRC-78 header: ${data.length} bytes (minimum ${headerLength})`,
    );
  }

  let offset = 0;

  // Read version (big-endian)
  const version = data.readUInt32BE(offset);
  offset += CRYPTO_PARAMS.VERSION_LENGTH;

  if (version !== BRC78_VERSION) {
    throw new ECIESError(
      "INVALID_VERSION",
      `Invalid BRC-78 version: expected 0x${BRC78_VERSION.toString(16)}, got 0x${version.toString(16)}`,
    );
  }

  // Read sender public key
  const senderPublicKey = data
    .subarray(offset, offset + CRYPTO_PARAMS.PUBLIC_KEY_LENGTH)
    .toString("hex");
  offset += CRYPTO_PARAMS.PUBLIC_KEY_LENGTH;

  // Read recipient public key
  const recipientPublicKey = data
    .subarray(offset, offset + CRYPTO_PARAMS.PUBLIC_KEY_LENGTH)
    .toString("hex");
  offset += CRYPTO_PARAMS.PUBLIC_KEY_LENGTH;

  // Read key ID
  const keyID = data.subarray(offset, offset + CRYPTO_PARAMS.KEY_ID_LENGTH).toString("hex");
  offset += CRYPTO_PARAMS.KEY_ID_LENGTH;

  // Rest is ciphertext
  const ciphertext = data.subarray(offset);

  return {
    version,
    senderPublicKey,
    recipientPublicKey,
    keyID,
    ciphertext,
  };
}

/**
 * High-level ECIES class for stateful encryption
 *
 * @example
 * ```typescript
 * const alice = new ECIES(alicePrivateKey);
 * const bob = new ECIES(bobPrivateKey);
 *
 * // Alice encrypts for Bob
 * const encrypted = alice.encrypt(
 *   Buffer.from("Hello Bob!"),
 *   bob.getPublicKey()
 * );
 *
 * // Bob decrypts from Alice
 * const decrypted = bob.decrypt(encrypted, alice.getPublicKey());
 * ```
 */
export class ECIES {
  private readonly privateKey: SecurePrivateKey;
  private readonly publicKey: SecurePublicKey;

  /**
   * Create a new ECIES instance
   *
   * @param privateKey - Identity private key
   */
  constructor(privateKey: SecurePrivateKey) {
    this.privateKey = privateKey;
    this.publicKey = privateKey.toPublicKey();
  }

  /**
   * Create ECIES instance from hex private key
   *
   * @param privateKeyHex - Private key as 64-character hex string
   */
  static fromHex(privateKeyHex: string): ECIES {
    const privateKey = BSVCrypto.privateKeyFromHex(privateKeyHex);
    return new ECIES(privateKey);
  }

  /**
   * Create ECIES instance with random private key
   */
  static fromRandom(): ECIES {
    const privateKey = BSVCrypto.privateKeyFromRandom();
    return new ECIES(privateKey);
  }

  /**
   * Get the public key
   */
  getPublicKey(): SecurePublicKey {
    return this.publicKey;
  }

  /**
   * Get the public key as hex string
   */
  getPublicKeyHex(): string {
    return this.publicKey.toHex();
  }

  /**
   * Encrypt a message for a recipient
   *
   * @param plaintext - Message to encrypt
   * @param recipientPublicKey - Recipient's public key (hex string or SecurePublicKey)
   * @param options - Encryption options
   * @returns Serialized BRC-78 ciphertext
   */
  encrypt(
    plaintext: Buffer,
    recipientPublicKey: SecurePublicKey | string,
    options?: ECIESOptions,
  ): Buffer {
    const recipientPubKey =
      typeof recipientPublicKey === "string"
        ? BSVCrypto.publicKeyFromHex(recipientPublicKey)
        : recipientPublicKey;

    const ciphertext = encrypt(plaintext, this.privateKey, recipientPubKey, options);
    return serializeCiphertext(ciphertext);
  }

  /**
   * Decrypt a message from a sender
   *
   * @param data - Serialized BRC-78 ciphertext
   * @param senderPublicKey - Sender's public key (hex string or SecurePublicKey)
   * @param options - Decryption options
   * @returns Decrypted plaintext
   */
  decrypt(data: Buffer, senderPublicKey: SecurePublicKey | string, options?: ECIESOptions): Buffer {
    const senderPubKey =
      typeof senderPublicKey === "string"
        ? BSVCrypto.publicKeyFromHex(senderPublicKey)
        : senderPublicKey;

    const ciphertext = deserializeCiphertext(data);

    // Validate sender matches
    if (ciphertext.senderPublicKey !== senderPubKey.toHex()) {
      throw new ECIESError(
        "INVALID_SENDER",
        "Sender public key in ciphertext does not match provided sender",
      );
    }

    // Validate recipient matches
    if (ciphertext.recipientPublicKey !== this.publicKey.toHex()) {
      throw new ECIESError(
        "INVALID_RECIPIENT",
        "Recipient public key in ciphertext does not match this instance",
      );
    }

    return decrypt(ciphertext, this.privateKey, senderPubKey, options);
  }

  /**
   * Encrypt a string message
   *
   * @param message - String message to encrypt
   * @param recipientPublicKey - Recipient's public key
   * @param encoding - String encoding (default: utf-8)
   * @returns Serialized ciphertext as hex string
   */
  encryptString(
    message: string,
    recipientPublicKey: SecurePublicKey | string,
    encoding: BufferEncoding = "utf-8",
  ): string {
    const plaintext = Buffer.from(message, encoding);
    const encrypted = this.encrypt(plaintext, recipientPublicKey);
    return encrypted.toString("hex");
  }

  /**
   * Decrypt a hex-encoded ciphertext to string
   *
   * @param ciphertextHex - Ciphertext as hex string
   * @param senderPublicKey - Sender's public key
   * @param encoding - String encoding (default: utf-8)
   * @returns Decrypted string
   */
  decryptString(
    ciphertextHex: string,
    senderPublicKey: SecurePublicKey | string,
    encoding: BufferEncoding = "utf-8",
  ): string {
    const ciphertext = Buffer.from(ciphertextHex, "hex");
    const plaintext = this.decrypt(ciphertext, senderPublicKey);
    return plaintext.toString(encoding);
  }
}

/**
 * Re-export types for convenience
 */
export type { SecurePrivateKey, SecurePublicKey } from "./bsv-sdk-wrapper.js";
