import { describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@/types';
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
