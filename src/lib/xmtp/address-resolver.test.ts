import { describe, expect, it, vi } from 'vitest';
import { XmtpClient } from './client';

describe('XmtpClient address resolver cache', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const inboxId = 'a'.repeat(64);

  it('dedupes concurrent lookups for the same address', async () => {
    const xmtp = new XmtpClient();
    const fetchInboxIdByIdentifier = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return inboxId;
    });

    (xmtp as unknown as { client: unknown }).client = {
      fetchInboxIdByIdentifier,
    };

    const [one, two, three] = await Promise.all([
      xmtp.resolveInboxIdForAddress(address, { context: 'test:concurrent', allowStaticFallback: false }),
      xmtp.resolveInboxIdForAddress(address, { context: 'test:concurrent', allowStaticFallback: false }),
      xmtp.resolveInboxIdForAddress(address, { context: 'test:concurrent', allowStaticFallback: false }),
    ]);

    expect(one).toBe(inboxId);
    expect(two).toBe(inboxId);
    expect(three).toBe(inboxId);
    expect(fetchInboxIdByIdentifier).toHaveBeenCalledTimes(1);
  });

  it('caches negative lookups with a short TTL', async () => {
    const xmtp = new XmtpClient();
    const fetchInboxIdByIdentifier = vi.fn(async () => null);

    (xmtp as unknown as { client: unknown }).client = {
      fetchInboxIdByIdentifier,
    };

    const first = await xmtp.resolveInboxIdForAddress(address, {
      context: 'test:negative',
      allowStaticFallback: false,
    });
    const second = await xmtp.resolveInboxIdForAddress(address, {
      context: 'test:negative',
      allowStaticFallback: false,
    });

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(fetchInboxIdByIdentifier).toHaveBeenCalledTimes(1);
  });

  it('short-circuits lookups during identity cooldown', async () => {
    const xmtp = new XmtpClient();
    const fetchInboxIdByIdentifier = vi.fn(async () => inboxId);

    (xmtp as unknown as { client: unknown }).client = {
      fetchInboxIdByIdentifier,
    };
    (xmtp as unknown as { identityCooldownUntil: number }).identityCooldownUntil = Date.now() + 60_000;

    const resolved = await xmtp.resolveInboxIdForAddress(address, {
      context: 'test:cooldown',
      allowStaticFallback: false,
    });

    expect(resolved).toBeNull();
    expect(fetchInboxIdByIdentifier).not.toHaveBeenCalled();
  });
});
