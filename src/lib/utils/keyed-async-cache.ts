export type KeyedAsyncCacheOptions<V> = {
  ttlMs: number;
  negativeTtlMs?: number;
  isNegative?: (value: V) => boolean;
  now?: () => number;
  onHit?: () => void;
  onMiss?: () => void;
};

type CacheEntry<V> = {
  value: V;
  at: number;
};

/**
 * A tiny async cache with:
 * - TTL (separate positive/negative TTL)
 * - in-flight dedupe per key
 *
 * The fetcher is responsible for catching and mapping errors to a value if you
 * want errors to be cached (e.g. caching `null` on failure).
 */
export class KeyedAsyncCache<V> {
  private cache = new Map<string, CacheEntry<V>>();
  private inFlight = new Map<string, Promise<V>>();
  private ttlMs: number;
  private negativeTtlMs: number;
  private isNegative: (value: V) => boolean;
  private now: () => number;
  private onHit?: () => void;
  private onMiss?: () => void;

  constructor(opts: KeyedAsyncCacheOptions<V>) {
    this.ttlMs = opts.ttlMs;
    this.negativeTtlMs = opts.negativeTtlMs ?? opts.ttlMs;
    this.isNegative = opts.isNegative ?? ((value: V) => value == null);
    this.now = opts.now ?? (() => Date.now());
    this.onHit = opts.onHit;
    this.onMiss = opts.onMiss;
  }

  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
  }

  peek(key: string): V | undefined {
    return this.cache.get(key)?.value;
  }

  private ttlFor(value: V): number {
    return this.isNegative(value) ? this.negativeTtlMs : this.ttlMs;
  }

  async get(key: string, fetcher: () => Promise<V>): Promise<V> {
    const now = this.now();
    const cached = this.cache.get(key);
    if (cached && now - cached.at < this.ttlFor(cached.value)) {
      this.onHit?.();
      return cached.value;
    }

    const inFlight = this.inFlight.get(key);
    if (inFlight) {
      this.onHit?.();
      return await inFlight;
    }

    this.onMiss?.();
    const promise = (async () => {
      try {
        const value = await fetcher();
        this.cache.set(key, { value, at: this.now() });
        return value;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return await promise;
  }
}

