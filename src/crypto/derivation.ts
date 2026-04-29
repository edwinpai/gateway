/**
 * Hardened Derivation Path Enforcement
 *
 * Validates that all BIP-32 style derivation paths use hardened indices.
 * Non-hardened paths allow parent key recovery if a child key is compromised.
 *
 * **Security Critical:** Only hardened derivation paths are allowed for
 * security-sensitive key hierarchies.
 *
 * @see SECURITY-MITIGATIONS-v2.md - Mitigation 5.1
 * @see https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki
 */

/**
 * Hardened index offset per BIP-32
 * Indices >= 2^31 are hardened
 */
export const HARDENED_OFFSET = 0x80000000; // 2^31 = 2,147,483,648

/**
 * Derivation path component (index)
 */
export interface PathComponent {
  /** Index value */
  index: number;
  /** Whether this index is hardened */
  hardened: boolean;
}

/**
 * Parsed derivation path
 */
export interface DerivationPath {
  /** Raw path string (e.g., "m/44'/0'/0'") */
  raw: string;
  /** Parsed components */
  components: PathComponent[];
  /** Whether all components are hardened */
  allHardened: boolean;
}

/**
 * Parse a BIP-32 derivation path string
 *
 * Supported formats:
 * - "m/44'/0'/0'" (hardened, recommended)
 * - "m/44/0/0" (non-hardened, NOT recommended)
 * - "m/44h/0h/0h" (alternative hardened notation)
 *
 * @param path - Derivation path string
 * @returns Parsed path components
 * @throws Error if path format is invalid
 */
export function parseDerivationPath(path: string): DerivationPath {
  if (!path.startsWith("m/") && !path.startsWith("M/")) {
    throw new Error(`Invalid derivation path: must start with 'm/' (got: ${path})`);
  }

  const pathStr = path.substring(2); // Remove "m/"
  if (pathStr.length === 0) {
    return {
      raw: path,
      components: [],
      allHardened: true, // Empty path is vacuously all-hardened
    };
  }

  const parts = pathStr.split("/");
  const components: PathComponent[] = [];

  for (const part of parts) {
    if (part.length === 0) {
      throw new Error(`Invalid derivation path: empty component in ${path}`);
    }

    // Check for hardened notation
    const isHardened = part.endsWith("'") || part.endsWith("h") || part.endsWith("H");
    const indexStr = isHardened ? part.slice(0, -1) : part;

    // Parse index
    const index = parseInt(indexStr, 10);
    if (isNaN(index)) {
      throw new Error(`Invalid derivation path: non-numeric index '${part}' in ${path}`);
    }

    if (index < 0) {
      throw new Error(`Invalid derivation path: negative index ${index} in ${path}`);
    }

    // Check for overflow
    const actualIndex = isHardened ? index + HARDENED_OFFSET : index;
    if (actualIndex > 0xffffffff) {
      throw new Error(`Invalid derivation path: index ${index} exceeds maximum (2^32 - 1)`);
    }

    components.push({
      index: actualIndex,
      hardened: isHardened,
    });
  }

  const allHardened = components.every((c) => c.hardened);

  return {
    raw: path,
    components,
    allHardened,
  };
}

/**
 * Validate that a derivation path uses only hardened indices
 *
 * Per BIP-32 security model:
 * - Hardened derivation: Child key leak does NOT compromise parent key
 * - Non-hardened derivation: Child private key + parent public key → parent private key
 *
 * BRC-42 and security-critical applications MUST use hardened paths.
 *
 * @param path - Derivation path string
 * @throws Error if path contains non-hardened components
 */
export function enforceHardenedPath(path: string): void {
  const parsed = parseDerivationPath(path);

  if (!parsed.allHardened) {
    const nonHardenedIndices = parsed.components.filter((c) => !c.hardened).map((c) => c.index);

    throw new Error(
      `Derivation path contains non-hardened indices: ${path}\n` +
        `Non-hardened indices: ${nonHardenedIndices.join(", ")}\n` +
        `Security requirement: All indices must be hardened (use ' suffix)`,
    );
  }
}

/**
 * Convert a non-hardened path to hardened
 *
 * @param path - Derivation path (may contain non-hardened indices)
 * @returns Path with all indices hardened
 */
export function hardenPath(path: string): string {
  const parsed = parseDerivationPath(path);

  if (parsed.allHardened) {
    return path; // Already hardened
  }

  const hardenedParts = parsed.components.map((c) => {
    const baseIndex = c.hardened ? c.index - HARDENED_OFFSET : c.index;
    return `${baseIndex}'`;
  });

  return `m/${hardenedParts.join("/")}`;
}

/**
 * Validate BRC-42 derivation path format
 *
 * BRC-42 paths should follow the pattern:
 * m/purpose'/coin_type'/account'
 *
 * All indices must be hardened for security.
 *
 * @param path - Derivation path to validate
 * @throws Error if path is invalid for BRC-42
 */
export function validateBRC42Path(path: string): void {
  const parsed = parseDerivationPath(path);

  // Enforce hardened derivation
  enforceHardenedPath(path);

  // BRC-42 typically uses 3 levels: m/purpose'/coin_type'/account'
  // But it's open-ended, so we just enforce >= 1 level
  if (parsed.components.length < 1) {
    throw new Error(`BRC-42 path must have at least 1 hardened level: ${path}`);
  }
}

/**
 * Standard BIP-44 base path for BSV
 * m/44'/0'/0'
 */
export const BRC42_BASE_PATH = "m/44'/0'/0'" as const;

/**
 * Check if a path is the standard BRC-42 base path
 */
export function isBRC42BasePath(path: string): boolean {
  return path === BRC42_BASE_PATH;
}

/**
 * Security recommendations for derivation paths
 */
export const DERIVATION_SECURITY = {
  /** Always use hardened derivation for security-critical keys */
  USE_HARDENED_ONLY: true,

  /** BIP-44 standard path for BSV */
  BIP44_BSV_PATH: "m/44'/0'/0'",

  /** Purpose index for BIP-44 */
  BIP44_PURPOSE: 44,

  /** Coin type for BSV (Bitcoin SV) */
  BSV_COIN_TYPE: 0,

  /** Hardened offset (2^31) */
  HARDENED_OFFSET,
} as const;

/**
 * Example secure derivation paths
 */
export const SECURE_PATH_EXAMPLES = [
  "m/44'/0'/0'", // Standard BIP-44 BSV
  "m/44'/0'/1'", // Second account
  "m/44'/0'/2'", // Third account
] as const;

/**
 * Example INSECURE derivation paths (DO NOT USE)
 */
export const INSECURE_PATH_EXAMPLES = [
  "m/44/0/0", // Non-hardened (vulnerable!)
  "m/44'/0/0", // Partially hardened (vulnerable!)
  "m/44/0'/0'", // Partially hardened (vulnerable!)
] as const;
