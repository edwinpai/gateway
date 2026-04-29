/**
 * Owner Verification Module
 *
 * Compares verified identity against a configured owner public key.
 * Used for ownerOnly mode to restrict access to the server owner.
 *
 * @see BRC-103: Peer-to-peer Authentication
 */

import type { PublicKey, OwnerConfig } from "../types/index.js";
import type { IdentityContext } from "./identity.js";
import { AuthError } from "../types/index.js";

/**
 * Owner verification result
 */
export interface OwnerVerificationResult {
  /** Whether the identity is the owner */
  isOwner: boolean;
  /** The owner's public key */
  ownerPublicKey: PublicKey;
  /** The verified identity's public key */
  identityKey: PublicKey;
}

/**
 * Owner resolver with optional caching
 */
export class OwnerResolver {
  private config: OwnerConfig;
  private cachedOwnerKey: PublicKey | null = null;

  constructor(config: OwnerConfig) {
    this.config = config;
    // Pre-cache static owner key
    if (config.ownerPublicKey) {
      this.cachedOwnerKey = config.ownerPublicKey;
    }
  }

  /**
   * Get the owner's public key
   * Uses cached value if available and caching is enabled
   */
  async getOwnerPublicKey(): Promise<PublicKey> {
    // Return cached key if available
    if (this.cachedOwnerKey) {
      return this.cachedOwnerKey;
    }

    // Resolve dynamically
    if (this.config.getOwnerPublicKey) {
      const key = await this.config.getOwnerPublicKey();

      // Cache if enabled (default: true)
      if (this.config.cacheOwnerKey !== false) {
        this.cachedOwnerKey = key;
      }

      return key;
    }

    throw new AuthError(
      "OWNER_CONFIG_MISSING",
      "Owner configuration is incomplete: no ownerPublicKey or getOwnerPublicKey provided",
      500,
    );
  }

  /**
   * Clear the cached owner key (useful for key rotation)
   */
  clearCache(): void {
    if (!this.config.ownerPublicKey) {
      this.cachedOwnerKey = null;
    }
  }
}

/**
 * Verify that an identity is the configured owner
 *
 * @param identityContext - The verified identity context
 * @param ownerConfig - Owner configuration
 * @returns Verification result
 * @throws AuthError if owner config is missing or identity is not owner
 */
export async function verifyOwner(
  identityContext: IdentityContext,
  ownerConfig: OwnerConfig,
): Promise<OwnerVerificationResult> {
  const resolver = new OwnerResolver(ownerConfig);
  const ownerPublicKey = await resolver.getOwnerPublicKey();

  const isOwner =
    normalizePublicKey(identityContext.identityKey) === normalizePublicKey(ownerPublicKey);

  return {
    isOwner,
    ownerPublicKey,
    identityKey: identityContext.identityKey,
  };
}

/**
 * Assert that an identity is the configured owner
 * Throws AuthError if not the owner
 *
 * @param identityContext - The verified identity context
 * @param ownerConfig - Owner configuration
 * @throws AuthError if identity is not the owner
 */
export async function requireOwner(
  identityContext: IdentityContext,
  ownerConfig: OwnerConfig,
): Promise<void> {
  const result = await verifyOwner(identityContext, ownerConfig);

  if (!result.isOwner) {
    throw new AuthError("NOT_OWNER", "Access denied: request is not from the owner", 403, {
      identityKey: result.identityKey,
      // Don't expose owner key in error for security
    });
  }
}

/**
 * Create a middleware-compatible owner check function
 *
 * @param ownerConfig - Owner configuration
 * @returns Function that throws AuthError if not owner
 */
export function createOwnerCheck(
  ownerConfig: OwnerConfig,
): (ctx: IdentityContext) => Promise<void> {
  const resolver = new OwnerResolver(ownerConfig);

  return async (identityContext: IdentityContext): Promise<void> => {
    const ownerPublicKey = await resolver.getOwnerPublicKey();
    const isOwner =
      normalizePublicKey(identityContext.identityKey) === normalizePublicKey(ownerPublicKey);

    if (!isOwner) {
      throw new AuthError("NOT_OWNER", "Access denied: request is not from the owner", 403);
    }
  };
}

/**
 * Normalize a public key for comparison (lowercase, no prefix variations)
 */
function normalizePublicKey(key: PublicKey): string {
  return key.toLowerCase().trim();
}

/**
 * Compare two public keys for equality
 */
export function publicKeysEqual(a: PublicKey, b: PublicKey): boolean {
  return normalizePublicKey(a) === normalizePublicKey(b);
}
