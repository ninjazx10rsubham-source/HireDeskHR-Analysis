interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class CacheService {
  private cache = new Map<string, CacheEntry<any>>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs = 10_000) {
    this.defaultTtlMs = defaultTtlMs;
    // Periodic sweep to prevent memory leaks
    setInterval(() => this.sweep(), 30_000).unref?.();
  }

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    const ttl = ttlMs !== undefined ? ttlMs : this.defaultTtlMs;
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl
    });
  }

  private inFlight = new Map<string, Promise<any>>();

  async getOrSet<T>(key: string, ttlMs: number, computeFn: () => Promise<T> | T): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key) as Promise<T>;
    }
    const promise = (async () => {
      try {
        const fresh = await computeFn();
        this.set(key, fresh, ttlMs);
        return fresh;
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, promise);
    return promise;
  }

  del(key: string): void {
    this.cache.delete(key);
  }

  delByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  invalidatePrefix(prefix: string): void {
    this.delByPrefix(prefix);
  }

  clear(): void {
    this.cache.clear();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

export const memoryCache = new CacheService();
