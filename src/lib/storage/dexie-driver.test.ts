import { describe, expect, it, vi } from 'vitest';
import type { Conversation, Identity } from '@/types';
import { DexieDriver } from './dexie-driver';

const conversation = (id: string, lastMessageAt: number): Conversation => ({
  id,
  peerId: `peer-${id}`,
  lastMessageAt,
  unreadCount: 0,
  pinned: false,
  archived: false,
  createdAt: lastMessageAt,
});

describe('DexieDriver conversation ordering', () => {
  it('returns conversations newest first', async () => {
    const newestFirst = [
      conversation('newest', 300),
      conversation('middle', 200),
      conversation('oldest', 100),
    ];
    const collection = {
      reverse: vi.fn(),
      filter: vi.fn(),
      toArray: vi.fn(async () => [...newestFirst]),
    };
    collection.reverse.mockReturnValue(collection);

    const conversations = {
      orderBy: vi.fn(() => collection),
    };
    const driver = new DexieDriver('ordering-test');
    (driver as unknown as { dataDb: { conversations: typeof conversations } }).dataDb = {
      conversations,
    };

    const result = await driver.listConversations();

    expect(conversations.orderBy).toHaveBeenCalledWith('lastMessageAt');
    expect(collection.reverse).toHaveBeenCalledTimes(1);
    expect(result.map((item) => item.id)).toEqual(['newest', 'middle', 'oldest']);
  });
});

describe('DexieDriver identity isolation', () => {
  const validIdentity: Identity = {
    address: `0x${'11'.repeat(20)}`,
    publicKey: '0x1234',
    privateKey: '0xabcd',
    createdAt: 1,
  };

  it('skips one malformed row without hiding valid identities or deleting the bad row', async () => {
    const malformedIdentity = {
      ...validIdentity,
      address: '0xdeadbeef',
    } as Identity;
    const identityTable = {
      toArray: vi.fn(async () => [malformedIdentity, validIdentity]),
      delete: vi.fn(async () => undefined),
    };
    const driver = new DexieDriver('identity-isolation-test');
    (driver as unknown as { globalDb: { identity: typeof identityTable } }).globalDb = {
      identity: identityTable,
    };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const identities = await driver.listIdentities();

    expect(identities).toEqual([validIdentity]);
    expect(identityTable.delete).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('original row remains in IndexedDB'),
      expect.objectContaining({ address: '0xdeadbeef' })
    );
  });

  it('returns a repaired identity even when persisting the repair fails', async () => {
    const repairableIdentity = {
      ...validIdentity,
      address: validIdentity.address.toUpperCase(),
    };
    const identityTable = {
      toArray: vi.fn(async () => [repairableIdentity]),
    };
    const driver = new DexieDriver('identity-repair-test');
    (driver as unknown as { globalDb: { identity: typeof identityTable } }).globalDb = {
      identity: identityTable,
    };
    const putIdentity = vi
      .spyOn(driver, 'putIdentity')
      .mockRejectedValue(new Error('IndexedDB is read-only'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const identities = await driver.listIdentities();

    expect(identities).toEqual([validIdentity]);
    expect(putIdentity).toHaveBeenCalledWith(repairableIdentity);
    expect(warning).toHaveBeenCalledWith(
      '[Storage] Could not persist an identity address repair.',
      expect.objectContaining({ error: 'IndexedDB is read-only' })
    );
  });

  it('deletes the malformed primary key when persisting an address repair', async () => {
    const repairableIdentity = {
      ...validIdentity,
      address: `0X0x${validIdentity.address.slice(2)}`,
    };
    const identityTable = {
      delete: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    };
    const globalDb = {
      identity: identityTable,
      transaction: vi.fn(async (...args: unknown[]) => {
        const callback = args[args.length - 1] as () => Promise<void>;
        await callback();
      }),
    };
    const driver = new DexieDriver('identity-primary-key-repair-test');
    (driver as unknown as { globalDb: typeof globalDb }).globalDb = globalDb;

    await driver.putIdentity(repairableIdentity);

    expect(identityTable.delete).toHaveBeenCalledWith(repairableIdentity.address);
    expect(identityTable.put).toHaveBeenCalledWith(validIdentity);
  });
});

describe('DexieDriver targeted XMTP cleanup', () => {
  it('does not interpret an explicitly empty target list as a global OPFS wipe', async () => {
    const clear = vi.fn(async () => undefined);
    const table = { clear };
    const dataDb = {
      conversations: table,
      messages: table,
      attachments: table,
      attachmentData: table,
      remoteAttachments: table,
      contacts: table,
      deletedConversations: table,
      transaction: vi.fn(async (...args: unknown[]) => {
        const callback = args[args.length - 1] as () => Promise<void>;
        await callback();
      }),
    };
    const removeEntry = vi.fn(async () => undefined);
    const getDirectory = vi.fn(async () => ({
      entries: () => ({
        async *[Symbol.asyncIterator]() {
          yield ['xmtp-production-first.db3'];
          yield ['xmtp-production-second.db3'];
        },
      }),
      removeEntry,
    }));
    const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory },
    });

    try {
      const driver = new DexieDriver('targeted-opfs-test');
      (driver as unknown as { dataDb: typeof dataDb }).dataDb = dataDb;

      const result = await driver.clearAllData({ opfsAddresses: [] });

      expect(removeEntry).not.toHaveBeenCalled();
      expect(result.deletedOpfsDatabases).toEqual([]);
    } finally {
      if (originalStorage) {
        Object.defineProperty(navigator, 'storage', originalStorage);
      } else {
        Reflect.deleteProperty(navigator, 'storage');
      }
    }
  });
});

describe('DexieDriver attachment cache', () => {
  it('does not recreate deleted or blocked rows while recording a download failure', async () => {
    const attachments = {
      get: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ id: 'blocked', cacheState: 'blocked' }),
      update: vi.fn(async () => undefined),
    };
    const dataDb = {
      attachments,
      transaction: vi.fn(async (...args: unknown[]) => {
        const callback = args[args.length - 1] as () => Promise<unknown>;
        return await callback();
      }),
    };
    const driver = new DexieDriver('attachment-failure-race-test');
    (driver as unknown as { dataDb: typeof dataDb }).dataDb = dataDb;

    expect(await driver.markAttachmentFailed('deleted', 'failed')).toBe(false);
    expect(await driver.markAttachmentFailed('blocked', 'failed')).toBe(false);
    expect(attachments.update).not.toHaveBeenCalled();
  });

  it('touches cached payload access times without rewriting on every read', async () => {
    const attachments = {
      get: vi
        .fn()
        .mockResolvedValueOnce({ id: 'remote', lastAccessedAt: 1 })
        .mockResolvedValueOnce({ id: 'remote', lastAccessedAt: 99_500 }),
      update: vi.fn(async () => undefined),
    };
    const attachmentData = {
      get: vi.fn(async () => ({ id: 'remote', data: new ArrayBuffer(3) })),
    };
    const driver = new DexieDriver('attachment-touch-test');
    (driver as unknown as { dataDb: { attachments: typeof attachments; attachmentData: typeof attachmentData } }).dataDb = {
      attachments,
      attachmentData,
    };
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);

    await driver.getAttachmentData('remote');
    await driver.getAttachmentData('remote');

    expect(attachments.update).toHaveBeenCalledTimes(1);
    expect(attachments.update).toHaveBeenCalledWith('remote', { lastAccessedAt: 100_000 });
    now.mockRestore();
  });

  it('replaces an optimistic attachment and its envelope in one transaction', async () => {
    const staleAttachment = { id: 'att_local', messageId: 'local' };
    const messages = {
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    const attachments = {
      put: vi.fn(async () => undefined),
      bulkDelete: vi.fn(async () => undefined),
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          toArray: vi.fn(async () => [staleAttachment]),
        })),
      })),
    };
    const attachmentData = {
      put: vi.fn(async () => undefined),
      bulkDelete: vi.fn(async () => undefined),
    };
    const remoteAttachments = {
      put: vi.fn(async () => undefined),
      bulkDelete: vi.fn(async () => undefined),
    };
    const conversations = {
      get: vi.fn(async () => conversation('conversation', 1)),
      update: vi.fn(async () => undefined),
    };
    const dataDb = {
      conversations,
      messages,
      attachments,
      attachmentData,
      remoteAttachments,
      transaction: vi.fn(async (...args: unknown[]) => {
        const callback = args[args.length - 1] as () => Promise<unknown>;
        return await callback();
      }),
    };
    const driver = new DexieDriver('attachment-reconcile-test');
    (driver as unknown as { dataDb: typeof dataDb }).dataDb = dataDb;
    const data = new Uint8Array([1, 2, 3]).buffer;

    await driver.reconcilePublishedAttachment({
      optimisticMessageId: 'local',
      message: {
        id: 'remote',
        conversationId: 'conversation',
        sender: 'self',
        sentAt: 10,
        body: 'photo.png',
        type: 'attachment',
        status: 'sent',
        reactions: [],
        attachmentId: 'att_remote',
      },
      attachment: {
        id: 'att_remote',
        messageId: 'remote',
        filename: 'photo.png',
        mimeType: 'image/png',
        size: 3,
        evictable: true,
      },
      data,
      remoteEnvelope: {
        id: 'att_remote',
        messageId: 'remote',
        conversationId: 'conversation',
        url: 'https://example.ipfscdn.io/photo.enc',
        contentDigest: 'digest',
        secret: new Uint8Array(32),
        salt: new Uint8Array(32),
        nonce: new Uint8Array(12),
        scheme: 'https',
        contentLength: 10,
      },
    });

    expect(dataDb.transaction).toHaveBeenCalledTimes(1);
    expect(messages.put).toHaveBeenCalledWith(expect.objectContaining({ id: 'remote' }));
    expect(attachments.put).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'att_remote', cacheState: 'cached', cachedBytes: 3 }),
    );
    expect(attachmentData.put).toHaveBeenCalledWith({ id: 'att_remote', data });
    expect(remoteAttachments.put).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'att_remote' }),
    );
    expect(messages.delete).toHaveBeenCalledWith('local');
    expect(attachments.bulkDelete).toHaveBeenCalledWith(['att_local']);
    expect(conversations.update).toHaveBeenCalledWith(
      'conversation',
      expect.objectContaining({ lastMessageId: 'remote' }),
    );
  });

  it('evicts the oldest recoverable payload while preserving its metadata', async () => {
    const rows = [
      {
        id: 'old-remote',
        messageId: 'message-1',
        filename: 'old.png',
        mimeType: 'image/png',
        size: 90,
        cachedBytes: 90,
        cacheState: 'cached' as const,
        lastAccessedAt: 1,
        evictable: true,
      },
      {
        id: 'new-remote',
        messageId: 'message-2',
        filename: 'new.png',
        mimeType: 'image/png',
        size: 70,
        cachedBytes: 70,
        cacheState: 'cached' as const,
        lastAccessedAt: 2,
        evictable: true,
      },
      {
        id: 'local-only',
        messageId: 'message-3',
        filename: 'local.png',
        mimeType: 'image/png',
        size: 40,
        cachedBytes: 40,
        cacheState: 'cached' as const,
        lastAccessedAt: 0,
        evictable: false,
      },
    ];
    const attachments = {
      toArray: vi.fn(async () => rows),
      put: vi.fn(async () => undefined),
    };
    const attachmentData = {
      toCollection: vi.fn(() => ({
        primaryKeys: vi.fn(async () => rows.map((row) => row.id)),
      })),
      delete: vi.fn(async () => undefined),
    };
    const remoteAttachments = {
      delete: vi.fn(async () => undefined),
    };
    const dataDb = {
      attachments,
      attachmentData,
      remoteAttachments,
      transaction: vi.fn(async (...args: unknown[]) => {
        const callback = args[args.length - 1] as () => Promise<unknown>;
        return await callback();
      }),
    };
    const driver = new DexieDriver('attachment-cache-test');
    (driver as unknown as { dataDb: typeof dataDb }).dataDb = dataDb;

    const result = await driver.pruneAttachmentCache({
      maxBytes: 150,
      requiredBytes: 30,
    });

    expect(result).toEqual({ usageBytes: 110, evictedIds: ['old-remote'] });
    expect(attachmentData.delete).toHaveBeenCalledWith('old-remote');
    expect(attachments.put).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'old-remote',
        cacheState: 'metadata',
        cachedBytes: 0,
      }),
    );
    expect(remoteAttachments.delete).not.toHaveBeenCalled();
  });

  it('reserves cache space and writes remote bytes in the same transaction', async () => {
    const existing = {
      id: 'old-remote',
      messageId: 'old-message',
      filename: 'old.png',
      mimeType: 'image/png',
      size: 90,
      cachedBytes: 90,
      cacheState: 'cached' as const,
      lastAccessedAt: 1,
      evictable: true,
    };
    const attachments = {
      get: vi.fn(async () => ({
        id: 'new-remote',
        messageId: 'new-message',
        cacheState: 'metadata',
      })),
      toArray: vi.fn(async () => [existing]),
      put: vi.fn(async () => undefined),
    };
    const attachmentData = {
      toCollection: vi.fn(() => ({
        primaryKeys: vi.fn(async () => [existing.id]),
      })),
      delete: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    };
    const dataDb = {
      attachments,
      attachmentData,
      transaction: vi.fn(async (...args: unknown[]) => {
        const callback = args[args.length - 1] as () => Promise<unknown>;
        return await callback();
      }),
    };
    const driver = new DexieDriver('attachment-atomic-cache-test');
    (driver as unknown as { dataDb: typeof dataDb }).dataDb = dataDb;
    const data = new ArrayBuffer(70);

    const result = await driver.cacheRemoteAttachment(
      {
        id: 'new-remote',
        messageId: 'new-message',
        filename: 'new.png',
        mimeType: 'image/png',
        size: 70,
        evictable: true,
      },
      data,
      100,
    );

    expect(result).toEqual({ usageBytes: 70, evictedIds: ['old-remote'] });
    expect(dataDb.transaction).toHaveBeenCalledTimes(1);
    expect(attachmentData.delete).toHaveBeenCalledWith('old-remote');
    expect(attachmentData.put).toHaveBeenCalledWith({ id: 'new-remote', data });
    expect(attachments.put).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'new-remote', cacheState: 'cached', cachedBytes: 70 }),
    );
  });

  it('does not resurrect attachment bytes after their metadata was deleted', async () => {
    const attachments = {
      get: vi.fn(async () => undefined),
      toArray: vi.fn(async () => []),
      put: vi.fn(async () => undefined),
    };
    const attachmentData = {
      toCollection: vi.fn(() => ({ primaryKeys: vi.fn(async () => []) })),
      delete: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    };
    const dataDb = {
      attachments,
      attachmentData,
      transaction: vi.fn(async (...args: unknown[]) => {
        const callback = args[args.length - 1] as () => Promise<unknown>;
        return await callback();
      }),
    };
    const driver = new DexieDriver('attachment-delete-race-test');
    (driver as unknown as { dataDb: typeof dataDb }).dataDb = dataDb;

    await expect(
      driver.cacheRemoteAttachment(
        {
          id: 'deleted-attachment',
          messageId: 'deleted-message',
          filename: 'deleted.png',
          mimeType: 'image/png',
          size: 3,
          evictable: true,
        },
        new ArrayBuffer(3),
        100,
      ),
    ).rejects.toThrow('removed or blocked');

    expect(attachments.put).not.toHaveBeenCalled();
    expect(attachmentData.put).not.toHaveBeenCalled();
  });
});
