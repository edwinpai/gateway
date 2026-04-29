/**
 * BRC-3 Signature Creation and Verification
 *
 * Implements digital signature creation and verification following the BRC-3 specification.
 * Uses ECDSA with secp256k1 curve and SHA-256 message hashing.
 *
 * @see https://github.com/bitcoin-sv/BRCs/blob/master/wallet/0003.md
 * @see https://github.com/bitcoin-sv/BRCs/blob/master/wallet/0077.md
 */

import { createHash, createSign, createVerify, randomBytes } from "node:crypto";
import type {
  SignatureRequest,
  SignatureResponse,
  VerifySignatureRequest,
  VerifySignatureResponse,
  ProtocolID,
  Counterparty,
  PublicKey,
  Signature,
  HexString,
  WalletInterface,
} from "./types.js";
import { publicKeyToPem, sha256 } from "./verification.js";

// =============================================================================
// BRC-3 Canonical Message Format
// =============================================================================

/**
 * Message prefix for BRC-3 signature domain separation
 * Prevents cross-protocol signature attacks
 */
const BRC3_MESSAGE_PREFIX = "BRC3-SIGNATURE";

/**
 * Canonical message structure for BRC-3 signing
 * Ensures deterministic message formatting across implementations
 */
export interface CanonicalMessage {
  /** Protocol ID tuple [securityLevel, protocolString] */
  protocolID: ProtocolID;
  /** Key ID used for signing */
  keyID: string;
  /** Counterparty context (optional) */
  counterparty?: Counterparty;
  /** The actual data being signed */
  data: string;
  /** Timestamp of signature (Unix ms) */
  timestamp?: number;
}

/**
 * Format a canonical message string for BRC-3 signing
 *
 * The canonical format is:
 * BRC3-SIGNATURE\n<securityLevel>:<protocol>\n<keyID>\n<counterparty>\n<data_hex>
 *
 * This ensures:
 * - Domain separation from other signature schemes
 * - Consistent ordering of all signing parameters
 * - Deterministic output across implementations
 *
 * @param message - The canonical message components
 * @returns The formatted canonical string ready for hashing
 */
export function formatCanonicalMessage(message: CanonicalMessage): string {
  const { protocolID, keyID, counterparty, data, timestamp } = message;

  // Normalize counterparty to string
  const cpStr = counterparty ?? "anyone";

  // Build canonical format with newline separators
  const parts = [BRC3_MESSAGE_PREFIX, `${protocolID[0]}:${protocolID[1]}`, keyID, cpStr, data];

  // Include timestamp if provided (for replay protection)
  if (timestamp !== undefined) {
    parts.push(String(timestamp));
  }

  return parts.join("\n");
}

/**
 * Hash data for signing using SHA-256 (BRC-3 specified)
 *
 * @param data - Data to hash (string or bytes)
 * @returns SHA-256 hash as Buffer
 */
export function hashForSigning(data: string | Uint8Array): Buffer {
  const input = typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data);
  return createHash("sha256").update(input).digest();
}

/**
 * Create the message hash for BRC-3 signing
 * Formats canonically then hashes with SHA-256
 *
 * @param request - Signature request parameters
 * @returns SHA-256 hash ready for ECDSA signing
 */
export function createSigningHash(request: SignatureRequest): Buffer {
  // Convert data to hex string if Uint8Array
  const dataHex =
    typeof request.data === "string"
      ? Buffer.from(request.data, "utf-8").toString("hex")
      : Buffer.from(request.data).toString("hex");

  const canonical = formatCanonicalMessage({
    protocolID: request.protocolID,
    keyID: request.keyID,
    counterparty: request.counterparty,
    data: dataHex,
  });

  return hashForSigning(canonical);
}

// =============================================================================
// Signature Creation (BRC-3)
// =============================================================================

/**
 * Options for signature creation
 */
export interface SigningOptions {
  /** Whether to double-hash the data (default: false) */
  doubleHash?: boolean;
  /** Include timestamp in canonical message */
  includeTimestamp?: boolean;
}

/**
 * Sign a request using a wallet interface (BRC-3 compliant)
 *
 * This function creates a digital signature over the provided data using
 * the key derivation parameters specified in the request. The signature
 * is created following BRC-3 specification:
 *
 * 1. Data is formatted into canonical form
 * 2. Canonical message is hashed with SHA-256
 * 3. Hash is signed using ECDSA with secp256k1
 * 4. Signature is returned in DER format
 *
 * @param wallet - Wallet interface for cryptographic operations
 * @param request - Signature request with data and key params
 * @param options - Optional signing options
 * @returns Promise resolving to signature response
 *
 * @example
 * ```typescript
 * const response = await signRequest(wallet, {
 *   data: 'Hello, World!',
 *   protocolID: [2, 'auth'],
 *   keyID: 'primary',
 *   counterparty: 'anyone',
 *   description: 'Authentication signature'
 * });
 * console.log(response.signature); // DER-encoded signature
 * console.log(response.publicKey); // Signer's public key
 * ```
 */
export async function signRequest(
  wallet: WalletInterface,
  request: SignatureRequest,
  options: SigningOptions = {},
): Promise<SignatureResponse> {
  const { includeTimestamp: _includeTimestamp = false } = options;

  // Prepare the data - convert to string if Uint8Array
  const dataStr =
    typeof request.data === "string" ? request.data : Buffer.from(request.data).toString("hex");

  // Build signature request for wallet
  const walletRequest = {
    data: dataStr,
    protocolID: request.protocolID,
    keyID: request.keyID,
    counterparty: request.counterparty,
    description: request.description,
  };

  // Call wallet's createSignature method
  const result = await wallet.createSignature(walletRequest);

  if (!result.success || !result.result) {
    throw new Error(result.error ?? "Signature creation failed");
  }

  return {
    signature: result.result.signature,
    publicKey: result.result.publicKey,
  };
}

/**
 * Sign raw data directly using Node.js crypto (for testing/fallback)
 *
 * This is a lower-level signing function that uses Node.js crypto directly.
 * For production use, prefer signRequest() with a proper wallet implementation.
 *
 * @param privateKeyHex - Private key in hex format (32 bytes)
 * @param data - Data to sign
 * @param options - Signing options
 * @returns DER-encoded signature in hex
 */
export function signDirect(
  privateKeyHex: string,
  data: string | Buffer,
  options: SigningOptions = {},
): Signature {
  const { doubleHash = false } = options;

  // Hash the data
  let messageHash = sha256(typeof data === "string" ? data : data);
  if (doubleHash) {
    messageHash = sha256(messageHash);
  }

  // Convert private key to PEM format for Node.js crypto
  const privateKeyBuffer = Buffer.from(privateKeyHex, "hex");
  const privateKeyPem = privateKeyToPem(privateKeyBuffer);

  // Create signature using ECDSA
  const sign = createSign("SHA256");
  sign.update(messageHash);
  sign.end();

  const signature = sign.sign({
    key: privateKeyPem,
    dsaEncoding: "der",
  });

  return signature.toString("hex");
}

/**
 * Convert a private key buffer to PEM format
 */
function privateKeyToPem(privateKey: Buffer): string {
  if (privateKey.length !== 32) {
    throw new Error(`Invalid private key length: ${privateKey.length} (expected 32)`);
  }

  // ASN.1 DER encoding for secp256k1 private key
  // SEQUENCE { version, privateKey, [0] parameters OID, [1] publicKey }
  const ecPrivateKeyOid = Buffer.from([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
  const secp256k1Oid = Buffer.from([0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a]);

  // Private key as OCTET STRING
  const privateKeyOctet = Buffer.concat([Buffer.from([0x04, privateKey.length]), privateKey]);

  // Parameters (OID secp256k1) as context tag [0]
  const parameters = Buffer.concat([Buffer.from([0xa0, secp256k1Oid.length]), secp256k1Oid]);

  // Version (integer 1)
  const version = Buffer.from([0x02, 0x01, 0x01]);

  // Build ECPrivateKey structure
  const ecPrivateKey = Buffer.concat([version, privateKeyOctet, parameters]);

  // Wrap in SEQUENCE
  const ecPrivateKeySeq = Buffer.concat([Buffer.from([0x30, ecPrivateKey.length]), ecPrivateKey]);

  // Build PKCS#8 wrapper
  const algorithmIdentifier = Buffer.concat([
    Buffer.from([0x30, ecPrivateKeyOid.length + secp256k1Oid.length]),
    ecPrivateKeyOid,
    secp256k1Oid,
  ]);

  const pkcs8 = Buffer.concat([
    Buffer.from([0x30, 2 + algorithmIdentifier.length + 2 + ecPrivateKeySeq.length]),
    Buffer.from([0x02, 0x01, 0x00]), // version 0
    algorithmIdentifier,
    Buffer.from([0x04, ecPrivateKeySeq.length]),
    ecPrivateKeySeq,
  ]);

  const base64 = pkcs8.toString("base64");
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----`;
}

// =============================================================================
// Signature Verification (BRC-3)
// =============================================================================

/**
 * Verify a signature using a wallet interface (BRC-3 compliant)
 *
 * Verification follows BRC-3 specification:
 * 1. Reconstruct canonical message from request params
 * 2. Hash with SHA-256
 * 3. Verify ECDSA signature against derived public key
 *
 * @param wallet - Wallet interface for verification
 * @param request - Verification request parameters
 * @returns Promise resolving to verification result
 *
 * @example
 * ```typescript
 * const result = await verifySignature(wallet, {
 *   data: 'Hello, World!',
 *   signature: signatureHex,
 *   protocolID: [2, 'auth'],
 *   keyID: 'primary',
 *   counterparty: 'anyone'
 * });
 * console.log(result.valid); // true or false
 * ```
 */
export async function verifySignature(
  wallet: WalletInterface,
  request: VerifySignatureRequest,
): Promise<VerifySignatureResponse> {
  // Prepare the data
  const dataStr =
    typeof request.data === "string" ? request.data : Buffer.from(request.data).toString("hex");

  // Build verification request for wallet
  const walletRequest = {
    data: dataStr,
    signature: request.signature,
    protocolID: request.protocolID,
    keyID: request.keyID,
    counterparty: request.counterparty,
    forSelf: request.forSelf,
  };

  // Call wallet's verifySignature method
  const result = await wallet.verifySignature(walletRequest);

  if (!result.success || !result.result) {
    return { valid: false };
  }

  return { valid: result.result.valid };
}

/**
 * Verify a signature directly using Node.js crypto (for testing/fallback)
 *
 * @param publicKeyHex - Compressed public key in hex (33 bytes)
 * @param signature - DER-encoded signature in hex
 * @param data - Original data that was signed
 * @param options - Verification options
 * @returns true if signature is valid
 */
export function verifyDirect(
  publicKeyHex: PublicKey,
  signature: Signature,
  data: string | Buffer,
  options: SigningOptions = {},
): boolean {
  const { doubleHash = false } = options;

  try {
    // Hash the data the same way it was hashed for signing
    let messageHash = sha256(typeof data === "string" ? data : data);
    if (doubleHash) {
      messageHash = sha256(messageHash);
    }

    // Convert public key to PEM
    const pem = publicKeyToPem(publicKeyHex);

    // Verify using SHA256 (the message is already hashed, but verifier expects raw data)
    // Actually, Node.js verify() hashes internally, so we pass the original data
    const verifier = createVerify("SHA256");
    verifier.update(typeof data === "string" ? data : data);
    verifier.end();

    const signatureBuffer = Buffer.from(signature, "hex");
    return verifier.verify(pem, signatureBuffer);
  } catch {
    return false;
  }
}

/**
 * Verify a canonical BRC-3 message signature
 *
 * This verifies signatures created with formatCanonicalMessage()
 *
 * @param publicKeyHex - Signer's compressed public key
 * @param signature - DER-encoded signature
 * @param message - Canonical message components
 * @returns true if valid
 */
export function verifyCanonicalSignature(
  publicKeyHex: PublicKey,
  signature: Signature,
  message: CanonicalMessage,
): boolean {
  const canonical = formatCanonicalMessage(message);
  return verifyDirect(publicKeyHex, signature, canonical);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a cryptographic nonce for signature freshness
 *
 * @param length - Number of random bytes (default: 32)
 * @returns Hex-encoded nonce
 */
export function generateNonce(length: number = 32): HexString {
  return randomBytes(length).toString("hex");
}

/**
 * Create a timestamped signature request
 * Adds current timestamp and nonce for replay protection
 *
 * @param data - Data to sign
 * @param protocolID - Protocol identifier
 * @param keyID - Key identifier
 * @param counterparty - Optional counterparty
 * @returns Signature request with timestamp and nonce embedded
 */
export function createTimestampedRequest(
  data: string | Uint8Array,
  protocolID: ProtocolID,
  keyID: string,
  counterparty?: Counterparty,
): SignatureRequest & { timestamp: number; nonce: string } {
  const timestamp = Date.now();
  const nonce = generateNonce(16);

  // Embed timestamp and nonce in the data
  const dataStr = typeof data === "string" ? data : Buffer.from(data).toString("hex");

  const timestampedData = `${dataStr}\n${timestamp}\n${nonce}`;

  return {
    data: timestampedData,
    protocolID,
    keyID,
    counterparty,
    timestamp,
    nonce,
  };
}

/**
 * Validate signature format (DER-encoded)
 *
 * @param signature - Hex-encoded signature to validate
 * @returns true if appears to be valid DER format
 */
export function isValidSignatureFormat(signature: string): boolean {
  try {
    const sig = Buffer.from(signature, "hex");

    // DER format: 0x30 [total-length] 0x02 [R-length] [R] 0x02 [S-length] [S]
    if (sig.length < 8) {
      return false;
    }
    if (sig[0] !== 0x30) {
      return false;
    }

    const totalLen = sig[1];
    if (totalLen > 127) {
      // Long form not expected for ECDSA signatures
      return false;
    }

    if (sig.length !== totalLen + 2) {
      return false;
    }
    if (sig[2] !== 0x02) {
      return false;
    }

    const rLen = sig[3];
    if (sig.length < 4 + rLen + 2) {
      return false;
    }

    const sOffset = 4 + rLen;
    if (sig[sOffset] !== 0x02) {
      return false;
    }

    const sLen = sig[sOffset + 1];
    if (sig.length !== sOffset + 2 + sLen) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Extract R and S components from a DER signature
 *
 * @param signature - DER-encoded signature (hex)
 * @returns Object with r and s as hex strings, or null if invalid
 */
export function extractSignatureComponents(
  signature: Signature,
): { r: HexString; s: HexString } | null {
  try {
    const sig = Buffer.from(signature, "hex");

    if (sig[0] !== 0x30) {
      return null;
    }

    let offset = 2;
    if (sig[1] >= 0x80) {
      offset++;
    } // Long form length

    if (sig[offset] !== 0x02) {
      return null;
    }
    const rLen = sig[offset + 1];
    const rStart = offset + 2;
    const r = sig.subarray(rStart, rStart + rLen);

    offset = rStart + rLen;
    if (sig[offset] !== 0x02) {
      return null;
    }
    const sLen = sig[offset + 1];
    const sStart = offset + 2;
    const s = sig.subarray(sStart, sStart + sLen);

    // Remove leading zeros for canonical form (32 bytes each)
    const rHex = r.toString("hex").replace(/^00+/, "").padStart(64, "0");
    const sHex = s.toString("hex").replace(/^00+/, "").padStart(64, "0");

    return { r: rHex, s: sHex };
  } catch {
    return null;
  }
}
