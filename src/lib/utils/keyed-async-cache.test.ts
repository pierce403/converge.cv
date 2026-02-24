import { describe, expect, it } from 'vitest';
import { KeyedAsyncCache } from './keyed-async-cache';

describe('KeyedAsyncCache', () => {
  it('dedupes in-flight fetches per key', async () => {
    const now = 0;
    const cache = new KeyedAsyncCache<number>({ ttlMs: 1_000, now: () => now });

    let calls = 0;
    let resolve!: (value: number) => void;
    const pending = new Promise<number>((res) => {
      resolve = res;
    });

    const fetcher = () => {
      calls += 1;
      return pending;
    };

    const p1 = cache.get('k', fetcher);
    const p2 = cache.get('k', fetcher);

    expect(calls).toBe(1);

    resolve(123);

    await expect(p1).resolves.toBe(123);
    await expect(p2).resolves.toBe(123);
  });

  it('uses TTL to avoid refetching until expiry', async () => {
    let now = 0;
    const cache = new KeyedAsyncCache<number>({ ttlMs: 1_000, now: () => now });

    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return calls;
    };

    await expect(cache.get('k', fetcher)).resolves.toBe(1);
    now = 500;
    await expect(cache.get('k', fetcher)).resolves.toBe(1);
    expect(calls).toBe(1);

    now = 1_001;
    await expect(cache.get('k', fetcher)).resolves.toBe(2);
    expect(calls).toBe(2);
  });

  it('supports a shorter negative TTL', async () => {
    let now = 0;
    const cache = new KeyedAsyncCache<string | null>({
      ttlMs: 1_000,
      negativeTtlMs: 200,
      now: () => now,
    });

    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return null;
    };

    await expect(cache.get('k', fetcher)).resolves.toBeNull();
    expect(calls).toBe(1);

    now = 100;
    await expect(cache.get('k', fetcher)).resolves.toBeNull();
    expect(calls).toBe(1);

    now = 250;
    await expect(cache.get('k', fetcher)).resolves.toBeNull();
    expect(calls).toBe(2);
  });
});
