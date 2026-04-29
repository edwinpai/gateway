/**
 * In-memory credential cache with TTL.
 *
 * Credentials are NEVER written to disk. They live in memory with
 * a lease duration and are automatically evicted on expiry.
 * A gateway restart clears all cached credentials.
 */

export interface CachedCredential {
  value: string;
  credentialId: string;
  expiresAt: number;
  grantedAt: number;
  grantedBy: string;
}

export class CredentialCache {
  private cache = new Map<string, CachedCredential>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Get a cached credential, or null if expired/missing. */
  get(credentialId: string): string | null {
    const entry = this.cache.get(credentialId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.evict(credentialId);
      return null;
    }
    return entry.value;
  }

  /** Store a credential with a TTL. Overwrites any existing entry. */
  set(credentialId: string, value: string, leaseMs: number, grantedBy: string): void {
    this.evict(credentialId);

    const now = Date.now();
    this.cache.set(credentialId, {
      value,
      credentialId,
      expiresAt: now + leaseMs,
      grantedAt: now,
      grantedBy,
    });

    const timer = setTimeout(() => this.evict(credentialId), leaseMs);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
    this.timers.set(credentialId, timer);
  }

  /** Evict a credential from cache. */
  evict(credentialId: string): void {
    this.cache.delete(credentialId);
    const timer = this.timers.get(credentialId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(credentialId);
    }
  }

  /** Check if a credential is cached and not expired. */
  has(credentialId: string): boolean {
    return this.get(credentialId) !== null;
  }

  /** Get metadata about a cached credential (without exposing the value). */
  getMeta(credentialId: string): Omit<CachedCredential, "value"> | null {
    const entry = this.cache.get(credentialId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.evict(credentialId);
      return null;
    }
    const { value: _, ...meta } = entry;
    return meta;
  }

  /** Clear all cached credentials. */
  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.cache.clear();
    this.timers.clear();
  }

  /** Number of currently cached credentials. */
  get size(): number {
    return this.cache.size;
  }

  /** List all cached credential IDs (for diagnostics, no values exposed). */
  listIds(): string[] {
    return [...this.cache.keys()];
  }
}
