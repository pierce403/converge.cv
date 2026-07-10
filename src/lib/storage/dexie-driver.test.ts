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
        const callback = args.at(-1) as () => Promise<void>;
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
      contacts: table,
      deletedConversations: table,
      transaction: vi.fn(async (...args: unknown[]) => {
        const callback = args.at(-1) as () => Promise<void>;
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
