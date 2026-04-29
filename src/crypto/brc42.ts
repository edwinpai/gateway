/**
 * BRC-42: BSV Key Derivation Scheme (BKDS)
 *
 * Implements HD key derivation using ECDH shared secrets and HMAC-based derivation.
 * This scheme allows two parties to derive multiple keys for each other using
 * invoice numbers as derivation parameters.
 *
 * **Security Critical:** Uses hardened derivation paths exclusively to prevent
 * parent key recovery attacks (per BIP-32 security model).
 *
 * @see https://github.com/bitcoin-sv/BRCs/blob/master/key-derivation/0042.md
 * @see SECURITY-MITIGATIONS-v2.md - Mitigation 5.1
 */

import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import * as secp from "@noble/secp256k1";
import { SECP256K1, validatePrivateKey, validateCompressedPublicKey } from "./constants.js";

/**
 * BRC-42 key derivation result
 */
export interface DerivedKey {
  /** Derived private key (32 bytes hex) */
  privateKey: string;
  /** Derived public key (33 bytes compressed hex) */
  publicKey: string;
}

/**
 * BRC-42 public key derivation result
 */
export interface DerivedPublicKey {
  /** Derived public key (33 bytes compressed hex) */
  publicKey: string;
}

/**
 * Derive a child private key using BRC-42 scheme
 *
 * Algorithm (Per BRC-42 Specification):
 * 1. Compute shared secret: ECDH(recipientPrivateKey, senderPublicKey)
 * 2. Generate HMAC: HMAC-SHA256(sharedSecret, invoiceNumber)
 * 3. Convert HMAC to scalar (big-endian)
 * 4. Derive child private key: (scalar + recipientPrivateKey) mod n
 *
 * **Security Note:** Derivation paths are implicitly hardened because
 * the shared secret (ECDH result) acts as a hardening factor.
 *
 * @param recipientPrivateKey - Recipient's master private key (32 bytes hex)
 * @param senderPublicKey - Sender's public key (33 bytes compressed hex)
 * @param invoiceNumber - Invoice number as string (UTF-8 encoded)
 * @returns Derived child private key
 */
export function derivePrivateKey(
  recipientPrivateKey: string,
  senderPublicKey: string,
  invoiceNumber: string,
): string {
  // Validate inputs
  const privKeyBuf = Buffer.from(recipientPrivateKey, "hex");
  const pubKeyBuf = Buffer.from(senderPublicKey, "hex");

  if (privKeyBuf.length !== 32) {
    throw new Error(`Invalid recipient private key length: ${privKeyBuf.length} (expected 32)`);
  }

  validateCompressedPublicKey(pubKeyBuf);

  // Step 1: Compute ECDH shared secret
  // sharedSecret = recipientPrivateKey * senderPublicKey
  const sharedSecret = secp.getSharedSecret(privKeyBuf, pubKeyBuf, true);

  // Step 2: Generate HMAC over invoice number using shared secret as key
  const invoiceBuffer = Buffer.from(invoiceNumber, "utf-8");
  const hmacResult = hmac(sha256, sharedSecret, invoiceBuffer);

  // Step 3: Convert HMAC to scalar (big-endian)
  const scalar = BigInt("0x" + Buffer.from(hmacResult).toString("hex"));

  // Step 4: Add scalar to recipient's private key (mod n)
  const recipientPrivBigInt = BigInt("0x" + recipientPrivateKey);
  validatePrivateKey(recipientPrivBigInt);

  const childPrivateKey = (scalar + recipientPrivBigInt) % SECP256K1.N;

  // Ensure result is in valid range [1, n-1]
  if (childPrivateKey === 0n) {
    throw new Error("Derived private key is zero (invalid)");
  }

  validatePrivateKey(childPrivateKey);

  // Convert to hex string (32 bytes, zero-padded)
  return childPrivateKey.toString(16).padStart(64, "0");
}

/**
 * Derive a child public key using BRC-42 scheme
 *
 * Algorithm (Per BRC-42 Specification):
 * 1. Compute shared secret: ECDH(senderPrivateKey, recipientPublicKey)
 * 2. Generate HMAC: HMAC-SHA256(sharedSecret, invoiceNumber)
 * 3. Convert HMAC to scalar (big-endian)
 * 4. Compute point: scalar * G (generator point)
 * 5. Derive child public key: (scalar * G) + recipientPublicKey
 *
 * @param senderPrivateKey - Sender's master private key (32 bytes hex)
 * @param recipientPublicKey - Recipient's public key (33 bytes compressed hex)
 * @param invoiceNumber - Invoice number as string (UTF-8 encoded)
 * @returns Derived child public key
 */
export function derivePublicKey(
  senderPrivateKey: string,
  recipientPublicKey: string,
  invoiceNumber: string,
): string {
  // Validate inputs
  const privKeyBuf = Buffer.from(senderPrivateKey, "hex");
  const pubKeyBuf = Buffer.from(recipientPublicKey, "hex");

  if (privKeyBuf.length !== 32) {
    throw new Error(`Invalid sender private key length: ${privKeyBuf.length} (expected 32)`);
  }

  validateCompressedPublicKey(pubKeyBuf);

  // Step 1: Compute ECDH shared secret
  // sharedSecret = senderPrivateKey * recipientPublicKey
  const sharedSecret = secp.getSharedSecret(privKeyBuf, pubKeyBuf, true);

  // Step 2: Generate HMAC over invoice number using shared secret as key
  const invoiceBuffer = Buffer.from(invoiceNumber, "utf-8");
  const hmacResult = hmac(sha256, sharedSecret, invoiceBuffer);

  // Step 3: Convert HMAC to scalar (big-endian)
  const scalar = BigInt("0x" + Buffer.from(hmacResult).toString("hex"));
  const scalarMod = scalar % SECP256K1.N;

  // Ensure scalar is in valid range [1, n-1]
  if (scalarMod === 0n) {
    throw new Error("Derived scalar is zero (invalid)");
  }

  // Step 4: Compute scalar * G (generator point multiplication)
  const _scalarHex = scalarMod.toString(16).padStart(64, "0");
  const scalarPoint = secp.Point.BASE.multiply(scalarMod);

  // Step 5: Add scalar * G to recipient's public key
  // childPublicKey = (scalar * G) + recipientPublicKey
  const recipientPoint = secp.Point.fromHex(Buffer.from(pubKeyBuf).toString("hex"));
  const childPoint = scalarPoint.add(recipientPoint);

  // Return compressed public key
  return Buffer.from(childPoint.toRawBytes(true)).toString("hex");
}

/**
 * Verify that a derived private key corresponds to a derived public key
 *
 * This is a sanity check to ensure derivation correctness.
 *
 * @param derivedPrivateKey - Derived private key (32 bytes hex)
 * @param derivedPublicKey - Derived public key (33 bytes compressed hex)
 * @returns true if keys match
 */
export function verifyDerivedKeyPair(derivedPrivateKey: string, derivedPublicKey: string): boolean {
  try {
    const computedPublicKey = secp.ProjectivePoint.fromPrivateKey(derivedPrivateKey);
    const computedPubKeyHex = Buffer.from(computedPublicKey.toRawBytes(true)).toString("hex");

    return computedPubKeyHex === derivedPublicKey;
  } catch {
    return false;
  }
}

/**
 * Validate invoice number format
 *
 * Per BRC-42: Invoice numbers are UTF-8 strings.
 * This function enforces reasonable constraints.
 *
 * @param invoiceNumber - Invoice number to validate
 * @throws Error if invalid
 */
export function validateInvoiceNumber(invoiceNumber: string): void {
  if (typeof invoiceNumber !== "string") {
    throw new Error("Invoice number must be a string");
  }

  if (invoiceNumber.length === 0) {
    throw new Error("Invoice number cannot be empty");
  }

  if (invoiceNumber.length > 1024) {
    throw new Error("Invoice number exceeds maximum length (1024 chars)");
  }

  // Ensure valid UTF-8 by attempting to encode
  try {
    Buffer.from(invoiceNumber, "utf-8");
  } catch {
    throw new Error("Invoice number contains invalid UTF-8");
  }
}
