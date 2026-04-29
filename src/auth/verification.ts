/**
 * BRC-100 Signature Verification
 *
 * Implements secp256k1 signature verification following BRC-100/BRC-3 specifications.
 * Uses ECDSA with SHA-256 for message hashing.
 *
 * @see https://github.com/bitcoin-sv/BRCs/blob/master/wallet/0100.md
 * @see https://github.com/bitcoin-sv/BRCs/blob/master/wallet/0003.md
 */

import { createHash, createVerify } from "node:crypto";
import type {
  WalletInterface,
  SignedRequest,
  VerificationResult,
  BSVIdentity,
  PublicKey,
  Signature,
  HexString,
  VerifiableCertificate,
  ProtocolID,
} from "./types.js";
import { BSVCrypto } from "../crypto/bsv-sdk-wrapper.js";
import { canonicalizeRequest } from "./types.js";

/**
 * Verification options for signature checking
 */
export interface VerificationOptions {
  /** Maximum age of request timestamp in ms (default: 30000) */
  maxTimestampAge?: number;

  /** Whether to verify any included certificates */
  verifyCertificates?: boolean;

  /** Trusted certifier public keys */
  trustedCertifiers?: PublicKey[];

  /** Required certificate types */
  requiredCertificateTypes?: string[];

  /** Skip signature verification (if already verified by RequestAuthorizer) */
  skipSignatureVerification?: boolean;
}

/**
 * Convert a compressed secp256k1 public key (hex) to PEM format
 */
export function publicKeyToPem(publicKeyHex: HexString): string {
  // Compressed public key is 33 bytes (02/03 prefix + 32 bytes x-coord)
  const pubKeyBuffer = Buffer.from(publicKeyHex, "hex");

  if (pubKeyBuffer.length !== 33) {
    throw new Error(`Invalid compressed public key length: ${pubKeyBuffer.length} (expected 33)`);
  }

  // ASN.1 DER encoding for secp256k1 public key
  // SEQUENCE { SEQUENCE { OID ecPublicKey, OID secp256k1 }, BIT STRING pubkey }
  const ecPublicKeyOid = Buffer.from([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
  const secp256k1Oid = Buffer.from([0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a]);

  const algorithmIdentifier = Buffer.concat([
    Buffer.from([0x30, ecPublicKeyOid.length + secp256k1Oid.length]),
    ecPublicKeyOid,
    secp256k1Oid,
  ]);

  const bitString = Buffer.concat([
    Buffer.from([0x03, pubKeyBuffer.length + 1, 0x00]),
    pubKeyBuffer,
  ]);

  const spki = Buffer.concat([
    Buffer.from([0x30, algorithmIdentifier.length + bitString.length]),
    algorithmIdentifier,
    bitString,
  ]);

  const base64 = spki.toString("base64");
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}

/**
 * Hash data using SHA-256 (as per BRC-3)
 */
export function sha256(data: string | Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

/**
 * Verify an ECDSA signature using secp256k1
 *
 * @param message - Original message that was signed
 * @param signature - DER-encoded signature (hex)
 * @param publicKey - Compressed public key (hex)
 * @returns true if signature is valid
 */
export function verifySignature(
  message: string | Buffer,
  signature: Signature,
  publicKey: PublicKey,
): boolean {
  try {
    const pem = publicKeyToPem(publicKey);
    const signatureBuffer = Buffer.from(signature, "hex");
    const messageBuffer = typeof message === "string" ? Buffer.from(message) : message;

    const verifier = createVerify("SHA256");
    verifier.update(messageBuffer);

    return verifier.verify(pem, signatureBuffer);
  } catch {
    return false;
  }
}

/**
 * Verify an ECDSA signature using BSV SDK wrapper
 *
 * This function uses the secure BSV SDK wrapper which enforces:
 * - Compressed public key format (33 bytes)
 * - RFC 6979 deterministic signature verification
 * - secp256k1 curve parameter validation
 *
 * @param message - Original message that was signed
 * @param signature - DER-encoded signature (hex string or Buffer)
 * @param publicKey - Compressed public key (hex)
 * @returns true if signature is valid
 */
export function verifySignatureBSV(
  message: string | Buffer,
  signature: Signature | Buffer,
  publicKey: PublicKey,
): boolean {
  try {
    // Hash the message with SHA-256 (BSVCrypto.verify expects a 64-char hex hash)
    const messageBuffer = typeof message === "string" ? Buffer.from(message) : message;
    const messageHash = sha256(messageBuffer).toString("hex");

    // Convert signature to Buffer if it's a hex string
    const signatureBuffer = Buffer.isBuffer(signature) ? signature : Buffer.from(signature, "hex");

    // Parse the public key using the secure wrapper
    const securePublicKey = BSVCrypto.publicKeyFromHex(publicKey);

    // Verify using BSV SDK wrapper
    return BSVCrypto.verify(securePublicKey, messageHash, signatureBuffer);
  } catch {
    return false;
  }
}

/**
 * Options for unified signature verification
 */
export interface UnifiedVerificationOptions {
  /** Whether to use BSV SDK for verification (default: true) */
  useBSVSDK?: boolean;
}

/**
 * Verify an ECDSA signature using unified verification strategy
 *
 * Tries BSV SDK first (more secure, enforces constraints), falls back to
 * PEM-based verification if BSV SDK fails. This provides backward compatibility
 * while preferring the more secure BSV SDK path.
 *
 * @param message - Original message that was signed
 * @param signature - DER-encoded signature (hex string or Buffer)
 * @param publicKey - Compressed public key (hex)
 * @param options - Verification options
 * @returns true if signature is valid
 */
export function verifySignatureUnified(
  message: string | Buffer,
  signature: Signature | Buffer,
  publicKey: PublicKey,
  options: UnifiedVerificationOptions = {},
): boolean {
  const { useBSVSDK = true } = options;

  // Convert signature to hex string for PEM fallback
  const signatureHex = Buffer.isBuffer(signature) ? signature.toString("hex") : signature;

  if (useBSVSDK) {
    // Try BSV SDK first
    const bsvResult = verifySignatureBSV(message, signature, publicKey);
    if (bsvResult) {
      return true;
    }

    // Fall back to PEM-based if BSV SDK fails
    // This handles edge cases where signature format differs slightly
    return verifySignature(message, signatureHex, publicKey);
  }

  // If BSV SDK is disabled, use PEM-based only
  return verifySignature(message, signatureHex, publicKey);
}

/**
 * Verify a signed request following BRC-103
 *
 * @param request - The signed request to verify
 * @param options - Verification options
 * @returns Verification result with identity if valid
 */
export function verifySignedRequest(
  request: SignedRequest,
  options: VerificationOptions = {},
): VerificationResult {
  const { maxTimestampAge = 30000, skipSignatureVerification = false } = options;
  const now = Date.now();

  // Check timestamp freshness (unless signature verification is skipped, which implies this was already checked)
  if (!skipSignatureVerification) {
    const age = Math.abs(now - request.timestamp);
    if (age > maxTimestampAge) {
      return {
        valid: false,
        error: `Request expired: timestamp age ${age}ms exceeds maximum ${maxTimestampAge}ms`,
        errorCode: "EXPIRED",
        verifiedAt: now,
      };
    }

    // Canonicalize and verify signature using unified verification
    // (tries BSV SDK first, falls back to PEM-based)
    const canonical = canonicalizeRequest(request);
    const isValid = verifySignatureUnified(canonical, request.signature, request.identityKey);

    if (!isValid) {
      return {
        valid: false,
        error: "Invalid signature",
        errorCode: "INVALID_SIGNATURE",
        verifiedAt: now,
      };
    }
  }

  // Build verified identity
  const identity: BSVIdentity = {
    identityKey: request.identityKey,
    lastSeen: now,
  };

  // Optionally verify certificates
  let verifiedCertificates: VerifiableCertificate[] | undefined;
  if (options.verifyCertificates && request.certificates) {
    const certResult = verifyCertificates(request.certificates, options);
    if (!certResult.valid) {
      return {
        valid: false,
        error: certResult.error,
        errorCode: "INVALID_CERTIFICATE",
        verifiedAt: now,
      };
    }
    verifiedCertificates = certResult.certificates;
  }

  return {
    valid: true,
    identity,
    verifiedCertificates,
    verifiedAt: now,
  };
}

/**
 * Verify a set of certificates
 */
function verifyCertificates(
  certificates: VerifiableCertificate[],
  options: VerificationOptions,
): { valid: boolean; error?: string; certificates?: VerifiableCertificate[] } {
  const { trustedCertifiers = [], requiredCertificateTypes = [] } = options;

  const verified: VerifiableCertificate[] = [];

  for (const vc of certificates) {
    const cert = vc.certificate;

    // Check if certifier is trusted (if trust list provided)
    if (trustedCertifiers.length > 0 && !trustedCertifiers.includes(cert.certifier)) {
      continue; // Skip untrusted certificates
    }

    // Verify certifier signature on certificate (using unified verification)
    const certData = JSON.stringify({
      type: cert.type,
      serialNumber: cert.serialNumber,
      subject: cert.subject,
      fields: cert.fields,
      issuedAt: cert.issuedAt,
      expiresAt: cert.expiresAt,
    });

    const isValid = verifySignatureUnified(certData, cert.signature, cert.certifier);
    if (!isValid) {
      return { valid: false, error: `Invalid certificate signature: ${cert.serialNumber}` };
    }

    // Check expiration
    if (cert.expiresAt && cert.expiresAt < Date.now()) {
      return { valid: false, error: `Certificate expired: ${cert.serialNumber}` };
    }

    verified.push({ ...vc, verified: true });
  }

  // Check required certificate types
  for (const requiredType of requiredCertificateTypes) {
    const hasType = verified.some((vc) => vc.certificate.type === requiredType);
    if (!hasType) {
      return { valid: false, error: `Missing required certificate type: ${requiredType}` };
    }
  }

  return { valid: true, certificates: verified };
}

/**
 * Create a signature verifier using a wallet for cryptographic operations
 */
export class WalletVerifier {
  private wallet: WalletInterface;

  constructor(wallet: WalletInterface) {
    this.wallet = wallet;
  }

  /**
   * Verify a signature using the wallet's verification method
   */
  async verify(
    data: string | Uint8Array,
    signature: Signature,
    protocolID: ProtocolID,
    keyID: string,
  ): Promise<boolean> {
    const result = await this.wallet.verifySignature({
      data,
      signature,
      protocolID,
      keyID,
    });

    if (!result.success || !result.result) {
      return false;
    }

    return result.result.valid;
  }

  /**
   * Verify a signed request using the wallet
   */
  async verifyRequest(
    request: SignedRequest,
    options: VerificationOptions = {},
  ): Promise<VerificationResult> {
    const { maxTimestampAge = 30000 } = options;
    const now = Date.now();

    // Check timestamp freshness
    const age = Math.abs(now - request.timestamp);
    if (age > maxTimestampAge) {
      return {
        valid: false,
        error: `Request expired: timestamp age ${age}ms exceeds maximum ${maxTimestampAge}ms`,
        errorCode: "EXPIRED",
        verifiedAt: now,
      };
    }

    // Canonicalize request
    const canonical = canonicalizeRequest(request);

    // Verify using wallet
    const isValid = await this.verify(canonical, request.signature, [2, "auth"], "request");

    if (!isValid) {
      return {
        valid: false,
        error: "Invalid signature",
        errorCode: "INVALID_SIGNATURE",
        verifiedAt: now,
      };
    }

    const identity: BSVIdentity = {
      identityKey: request.identityKey,
      lastSeen: now,
    };

    return {
      valid: true,
      identity,
      verifiedAt: now,
    };
  }
}

/**
 * Generate a cryptographically secure nonce
 */
export function generateNonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * Create message hash for signing (SHA-256)
 */
export function createMessageHash(message: string): HexString {
  return sha256(message).toString("hex");
}
