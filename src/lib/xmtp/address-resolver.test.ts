import { describe, expect, it, vi } from 'vitest';
import { IdentifierKind } from '@xmtp/browser-sdk';
import { XmtpClient } from './client';

describe('XmtpClient address resolver cache', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const inboxId = 'a'.repeat(64);
  const convosInviteCode =
    'Cm8KPwFi60tQh86A-P9SudQquYnOUrBw_u-Ww6W5balnA4LhWs0r9b93FVXZ02qqi1KGZmK-Mpmqhb3ZSdq47eNMnBIgQ9OkZGgjKYjpQbUXZP9NBg_ieSmfAPl-kEcQRyKvGPwaCmRoaTZDNWloWHASQTGBzqUNDRP7ARA_---jB8EkIpylcyvyVjS52z4N3IqDD_eR0ubZ7BUW5r38Xb2tqa65G2inOOEDb5j46DK37L0B';

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
    expect(fetchInboxIdByIdentifier).toHaveBeenCalledWith({
      identifier: address,
      identifierKind: IdentifierKind.Ethereum,
    });
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

  it('does not create a local fallback conversation when connected creation fails', async () => {
    const xmtp = new XmtpClient();
    const createGroup = vi.fn(async () => {
      throw new Error('network create failed');
    });

    (xmtp as unknown as { client: unknown }).client = {
      conversations: {
        createGroup,
      },
    };

    await expect(xmtp.createConversation(inboxId)).rejects.toThrow('network create failed');
    expect(createGroup).toHaveBeenCalledWith(
      [inboxId],
      {
        messageDisappearingSettings: {
          fromNs: expect.any(BigInt),
          inNs: 1_209_600_000_000_000n,
        },
      },
    );
  });

  it('applies two-week disappearing messages to new multi-member groups', async () => {
    const xmtp = new XmtpClient();
    const group = { id: 'group-1', createdAtNs: 1_000_000n };
    const createGroup = vi.fn(async () => group);
    (xmtp as unknown as { client: unknown }).client = {
      inboxId: 'self-inbox',
      conversations: { createGroup },
    };
    (
      xmtp as unknown as {
        ensureConvosGroupProfilePublished: () => Promise<void>;
        sendConvosProfileSnapshot: () => Promise<void>;
      }
    ).ensureConvosGroupProfilePublished = vi.fn(async () => undefined);
    (
      xmtp as unknown as {
        sendConvosProfileSnapshot: () => Promise<void>;
      }
    ).sendConvosProfileSnapshot = vi.fn(async () => undefined);

    await xmtp.createGroupConversation([inboxId]);

    expect(createGroup).toHaveBeenCalledWith(
      [inboxId],
      {
        messageDisappearingSettings: {
          fromNs: expect.any(BigInt),
          inNs: 1_209_600_000_000_000n,
        },
      },
    );
  });

  it('applies two-week disappearing messages to invite-claim DMs', async () => {
    const xmtp = new XmtpClient();
    const send = vi.fn(async () => 'message-id');
    const createDm = vi.fn(async () => ({
      id: 'invite-dm',
      createdAtNs: 1_000_000n,
      send,
    }));
    (xmtp as unknown as { client: unknown }).client = {
      inboxId: 'self-inbox',
      conversations: { createDm },
    };
    xmtp.fetchInboxProfile = vi.fn(async (creatorInboxId: string) => ({
      inboxId: creatorInboxId,
      addresses: [],
      identities: [],
    }));

    await xmtp.sendConvosInviteJoinRequest(convosInviteCode);

    expect(createDm).toHaveBeenCalledWith(
      '43d3a46468232988e941b51764ff4d060fe279299f00f97e9047104722af18fc',
      {
        messageDisappearingSettings: {
          fromNs: expect.any(BigInt),
          inNs: 1_209_600_000_000_000n,
        },
      },
    );
    expect(send).toHaveBeenCalledOnce();
  });
});
