import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContactStore } from './contact-store';

const mockStorage = {
  putContact: vi.fn(async () => undefined),
  deleteContact: vi.fn(async () => undefined),
  listContacts: vi.fn(async () => []),
  unmarkPeerDeletion: vi.fn(async () => undefined),
};

vi.mock('@/lib/storage', () => ({
  getStorage: vi.fn(async () => mockStorage),
}));

describe('contact store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useContactStore.setState({ contacts: [], isLoading: false });
  });

  it('blocks contacts with a persisted placeholder when missing', async () => {
    const store = useContactStore.getState();
    await store.blockContact('Inbox-123');

    const blocked = store.getContactByInboxId('inbox-123');
    expect(blocked?.isBlocked).toBe(true);
    expect(blocked?.isInboxOnly).toBe(true);
    expect(blocked?.inboxId).toBe('inbox-123');
    expect(mockStorage.putContact).toHaveBeenCalledWith(expect.objectContaining({ inboxId: 'inbox-123' }));
  });

  it('unblocks contacts and clears deletion markers', async () => {
    const store = useContactStore.getState();
    await store.blockContact('Inbox-123');
    await store.unblockContact('Inbox-123');

    const contact = store.getContactByInboxId('inbox-123');
    expect(contact?.isBlocked).toBe(false);
    expect(mockStorage.unmarkPeerDeletion).toHaveBeenCalledWith('inbox-123');
  });

  it('enriches contacts from inline profile payloads', async () => {
    const store = useContactStore.getState();

    const enriched = await store.upsertContactProfile({
      inboxId: '0xABCDEF',
      displayName: 'Inline Name',
      avatarUrl: 'https://example.com/avatar.png',
      primaryAddress: '0xABCDEF0000000000000000000000000000000000',
      addresses: ['0xABCDEF0000000000000000000000000000000000', '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'],
      metadata: {
        preferredName: 'Legacy Name',
        farcasterFollowerCount: 10,
        farcasterPowerBadge: true,
        description: 'test profile',
      },
    });

    expect(enriched.name).toBe('Inline Name');
    expect(enriched.preferredName).toBe('Inline Name');
    expect(enriched.avatar).toBe('https://example.com/avatar.png');
    expect(enriched.primaryAddress?.toLowerCase().startsWith('0xabcdef')).toBe(true);
    expect(enriched.addresses?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(enriched.addresses?.map((addr) => addr.toLowerCase())).toEqual(
      expect.arrayContaining([
        '0xabcdef0000000000000000000000000000000000',
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ])
    );
    expect(enriched.farcasterFollowerCount).toBe(10);
    expect(enriched.farcasterPowerBadge).toBe(true);
    expect(enriched.identities?.length).toBeGreaterThanOrEqual(2);
    expect(mockStorage.putContact).toHaveBeenCalledWith(expect.objectContaining({ inboxId: enriched.inboxId }));
  });
});
