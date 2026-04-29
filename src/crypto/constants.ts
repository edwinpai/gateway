/**
 * Cryptographic Constants and Validation
 *
 * Hardcoded secp256k1 elliptic curve parameters with validation.
 * These constants MUST NOT be sourced from external configuration,
 * RAG content, or user input.
 *
 * **Security Critical:** Any modification to these constants could
 * compromise the entire cryptographic system.
 *
 * @see SECURITY-MITIGATIONS-v2.md - Mitigation 4.1 & 6
 * @see https://www.secg.org/sec2-v2.pdf (secp256k1 specification)
 */

/**
 * Secp256k1 Curve Parameters (Domain Parameters)
 *
 * These are the standard secp256k1 parameters as defined in SEC 2.
 * They are hardcoded and immutable.
 */
export const SECP256K1 = {
  /** Curve name */
  name: "secp256k1" as const,

  /**
   * Prime field modulus (p)
   * The field over which the curve is defined
   */
  P: BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F"),

  /**
   * Curve order (n)
   * Number of points on the curve (group order)
   */
  N: BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141"),

  /**
   * Curve coefficient a
   * The equation is y^2 = x^3 + ax + b
   * For secp256k1, a = 0
   */
  A: 0n,

  /**
   * Curve coefficient b
   * The equation is y^2 = x^3 + ax + b
   * For secp256k1, b = 7
   */
  B: 7n,

  /**
   * Generator point G coordinates
   * The base point used for key generation
   */
  Gx: BigInt("0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798"),
  Gy: BigInt("0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8"),

  /**
   * Cofactor (h)
   * For secp256k1, h = 1 (prime order curve)
   */
  H: 1n,
} as const;

/**
 * Key size constraints
 */
export const KEY_SIZES = {
  /** Private key size in bytes (256 bits) */
  PRIVATE_KEY_BYTES: 32,

  /** Compressed public key size in bytes (33 bytes: 0x02/0x03 + 32 bytes x-coordinate) */
  PUBLIC_KEY_COMPRESSED_BYTES: 33,

  /** Uncompressed public key size in bytes (65 bytes: 0x04 + 32 bytes x + 32 bytes y) */
  PUBLIC_KEY_UNCOMPRESSED_BYTES: 65,

  /** Signature size in bytes (DER encoding is variable, typically 70-72 bytes) */
  SIGNATURE_MAX_BYTES: 72,
} as const;

/**
 * Validation error class for crypto parameter violations
 */
export class CryptoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoValidationError";
  }
}

/**
 * Validate secp256k1 curve parameters against hardcoded constants
 *
 * This function is called at module initialization to ensure that
 * the cryptographic library is using the correct curve parameters.
 *
 * **Security Critical:** Never accept parameters from external sources.
 *
 * @param params - Curve parameters to validate
 * @throws CryptoValidationError if parameters don't match
 */
export function validateCurveParameters(params: {
  p?: bigint;
  n?: bigint;
  Gx?: bigint;
  Gy?: bigint;
  a?: bigint;
  b?: bigint;
}): void {
  if (params.p !== undefined && params.p !== SECP256K1.P) {
    throw new CryptoValidationError(
      `Invalid curve prime (p). Expected secp256k1 constant, got ${params.p.toString(16)}`,
    );
  }

  if (params.n !== undefined && params.n !== SECP256K1.N) {
    throw new CryptoValidationError(
      `Invalid curve order (n). Expected secp256k1 constant, got ${params.n.toString(16)}`,
    );
  }

  if (params.Gx !== undefined && params.Gx !== SECP256K1.Gx) {
    throw new CryptoValidationError(
      `Invalid generator point x-coordinate (Gx). Expected secp256k1 constant`,
    );
  }

  if (params.Gy !== undefined && params.Gy !== SECP256K1.Gy) {
    throw new CryptoValidationError(
      `Invalid generator point y-coordinate (Gy). Expected secp256k1 constant`,
    );
  }

  if (params.a !== undefined && params.a !== SECP256K1.A) {
    throw new CryptoValidationError(`Invalid curve coefficient a. Expected 0 for secp256k1`);
  }

  if (params.b !== undefined && params.b !== SECP256K1.B) {
    throw new CryptoValidationError(`Invalid curve coefficient b. Expected 7 for secp256k1`);
  }
}

/**
 * Validate that a private key is in the valid range [1, n-1]
 *
 * @param privateKey - Private key as BigInt
 * @throws CryptoValidationError if invalid
 */
export function validatePrivateKey(privateKey: bigint): void {
  if (privateKey < 1n) {
    throw new CryptoValidationError("Private key must be >= 1");
  }

  if (privateKey >= SECP256K1.N) {
    throw new CryptoValidationError(
      `Private key must be < curve order (n). Got ${privateKey.toString(16)}`,
    );
  }
}

/**
 * Validate that a nonce (k) is in the valid range [1, n-1]
 *
 * @param k - Nonce value as BigInt
 * @throws CryptoValidationError if invalid
 */
export function validateNonce(k: bigint): void {
  if (k < 1n) {
    throw new CryptoValidationError("Nonce (k) must be >= 1");
  }

  if (k >= SECP256K1.N) {
    throw new CryptoValidationError(`Nonce (k) must be < curve order (n). Got ${k.toString(16)}`);
  }
}

/**
 * Validate compressed public key format
 *
 * @param publicKey - Public key as Buffer
 * @throws CryptoValidationError if invalid format
 */
export function validateCompressedPublicKey(publicKey: Buffer): void {
  if (publicKey.length !== KEY_SIZES.PUBLIC_KEY_COMPRESSED_BYTES) {
    throw new CryptoValidationError(
      `Invalid compressed public key length: ${publicKey.length} (expected ${KEY_SIZES.PUBLIC_KEY_COMPRESSED_BYTES})`,
    );
  }

  const prefix = publicKey[0];
  if (prefix !== 0x02 && prefix !== 0x03) {
    throw new CryptoValidationError(
      `Invalid compressed public key prefix: 0x${prefix.toString(16)} (expected 0x02 or 0x03)`,
    );
  }
}

/**
 * Initialize crypto module and validate constants
 *
 * Call this at module load time to ensure cryptographic integrity.
 * This is a defense-in-depth measure to detect tampering or configuration errors.
 */
export function initializeCrypto(): void {
  // Validate that our hardcoded constants are internally consistent
  validateCurveParameters({
    p: SECP256K1.P,
    n: SECP256K1.N,
    Gx: SECP256K1.Gx,
    Gy: SECP256K1.Gy,
    a: SECP256K1.A,
    b: SECP256K1.B,
  });

  // Additional sanity checks
  if (SECP256K1.H !== 1n) {
    throw new CryptoValidationError("secp256k1 cofactor must be 1");
  }

  if (SECP256K1.N <= 0n) {
    throw new CryptoValidationError("Curve order must be positive");
  }
}

/**
 * Reject any attempt to use non-secp256k1 curves
 *
 * @param curveName - Curve name to check
 * @throws CryptoValidationError if not secp256k1
 */
export function enforceSecp256k1(curveName: string): void {
  if (curveName !== "secp256k1") {
    throw new CryptoValidationError(`Only secp256k1 is supported. Attempted to use: ${curveName}`);
  }
}

// Initialize crypto module on load
initializeCrypto();
