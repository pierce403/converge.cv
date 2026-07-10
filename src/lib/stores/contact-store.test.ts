import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContactStore } from './contact-store';

const mockStorage = {
  putContact: vi.fn(async (_contact: unknown) => undefined),
  deleteContact: vi.fn(async (_inboxId: string) => undefined),
  listContacts: vi.fn(async () => []),
  unmarkPeerDeletion: vi.fn(async (_inboxId: string) => undefined),
};

const mockDeriveInboxIdFromAddress = vi.fn(async (_address: string): Promise<string | null> => null);

vi.mock('@/lib/xmtp', () => ({
  getXmtpClient: () => ({
    deriveInboxIdFromAddress: (address: string) => mockDeriveInboxIdFromAddress(address),
  }),
}));

vi.mock('@/lib/storage', () => ({
  getStorage: vi.fn(async () => mockStorage),
}));

describe('contact store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useContactStore.setState({ contacts: [], isLoading: false });

    mockDeriveInboxIdFromAddress.mockResolvedValue(null);
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

  it('does not persist a discovered profile until the user saves the contact', async () => {
    const store = useContactStore.getState();

    const discovered = await store.upsertContactProfile({
      inboxId: 'inbox-discovered',
      displayName: 'Discovered Name',
      avatarUrl: 'https://example.com/discovered.png',
      source: 'inbox',
    });

    expect(discovered.name).toBe('Discovered Name');
    expect(store.getContactByInboxId('inbox-discovered')).toBeUndefined();
    expect(mockStorage.putContact).not.toHaveBeenCalled();
  });

  it('persists a missing profile when a deliberate participation action requests it', async () => {
    const store = useContactStore.getState();

    await store.upsertContactProfile({
      inboxId: 'inbox-participated',
      displayName: 'Participating Peer',
      source: 'inbox',
      persistIfMissing: true,
    });

    expect(store.getContactByInboxId('inbox-participated')?.name).toBe('Participating Peer');
    expect(mockStorage.putContact).toHaveBeenCalledWith(
      expect.objectContaining({ inboxId: 'inbox-participated' })
    );
  });

  it('enriches explicitly saved contacts from inline profile payloads', async () => {
    const store = useContactStore.getState();

    await store.addContact({
      inboxId: 'inbox-abcdef',
      name: '',
      createdAt: Date.now(),
      source: 'manual',
    });
    mockStorage.putContact.mockClear();

    const enriched = await store.upsertContactProfile({
      inboxId: 'inbox-abcdef',
      displayName: 'Inline Name',
      avatarUrl: 'https://example.com/avatar.png',
      primaryAddress: '0X0xABCDEF0000000000000000000000000000000000',
      addresses: ['0x0XABCDEF0000000000000000000000000000000000', '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'],
      metadata: {
        preferredName: 'Legacy Name',
        farcasterFollowerCount: 10,
        farcasterPowerBadge: true,
        description: 'test profile',
      },
    });

    expect(enriched.name).toBe('Inline Name');
    expect(enriched.preferredName).toBeUndefined();
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

  it('does not overwrite a human name with an Ethereum address', async () => {
    const store = useContactStore.getState();

    await store.addContact({
      inboxId: 'inbox-alice',
      name: 'Alice',
      createdAt: Date.now(),
      primaryAddress: '0x1111111111111111111111111111111111111111',
      addresses: ['0x1111111111111111111111111111111111111111'],
      identities: [
        { identifier: '0x1111111111111111111111111111111111111111', kind: 'Ethereum', isPrimary: true },
      ],
      source: 'manual',
    } as unknown as never);

    const updated = await store.upsertContactProfile({
      inboxId: 'inbox-alice',
      displayName: '0x2222222222222222222222222222222222222222',
      primaryAddress: '0x1111111111111111111111111111111111111111',
      addresses: ['0x1111111111111111111111111111111111111111'],
      source: 'inbox',
    });

    expect(updated.name).toBe('Alice');
    expect(updated.preferredName).not.toBe('0x2222222222222222222222222222222222222222');
    expect(mockStorage.putContact).toHaveBeenCalledWith(expect.objectContaining({ inboxId: 'inbox-alice', name: 'Alice' }));
  });

  it('keeps the published profile when Farcaster metadata is refreshed', async () => {
    const store = useContactStore.getState();
    await store.addContact({
      inboxId: 'inbox-profile-source',
      name: 'Published Name',
      avatar: 'https://example.com/published.png',
      createdAt: Date.now(),
      source: 'inbox',
    } as unknown as never);

    const updated = await store.upsertContactProfile({
      inboxId: 'inbox-profile-source',
      displayName: 'Farcaster Name',
      avatarUrl: 'https://example.com/farcaster.png',
      source: 'farcaster',
      metadata: {
        farcasterUsername: 'farcaster-user',
        farcasterFollowerCount: 42,
      },
    });

    expect(updated.name).toBe('Published Name');
    expect(updated.avatar).toBe('https://example.com/published.png');
    expect(updated.farcasterUsername).toBe('farcaster-user');
    expect(updated.farcasterFollowerCount).toBe(42);
  });

  it('does not persist address-looking names when normalizing inputs', async () => {
    const store = useContactStore.getState();
    await store.addContact({
      inboxId: 'inbox-bob',
      name: '0x3333333333333333333333333333333333333333',
      farcasterUsername: 'bob',
      createdAt: Date.now(),
      primaryAddress: '0x3333333333333333333333333333333333333333',
      addresses: ['0x3333333333333333333333333333333333333333'],
      identities: [{ identifier: '0x3333333333333333333333333333333333333333', kind: 'Ethereum', isPrimary: true }],
      source: 'manual',
    } as unknown as never);

    const bob = store.getContactByInboxId('inbox-bob');
    expect(bob?.name).toBe('bob');
  });

  it('repairs repeated Ethereum prefixes and drops malformed address-like contact data', async () => {
    const body = 'ABCDEFabcdef1234567890abcdefABCDEF123456';
    const canonical = '0xabcdefabcdef1234567890abcdefabcdef123456';
    const store = useContactStore.getState();

    await store.addContact({
      inboxId: 'inbox-repaired-address',
      name: 'Repaired',
      createdAt: Date.now(),
      primaryAddress: `0X0x${body}`,
      addresses: [`0x0X${body}`, '0x0x1234'],
      identities: [
        { identifier: `0x0x${body}`, kind: 'ethereum', isPrimary: true },
        { identifier: '0x0x1234', kind: 'Ethereum' },
      ],
      source: 'manual',
    });

    const repaired = store.getContactByInboxId('inbox-repaired-address');
    expect(repaired?.primaryAddress).toBe(canonical);
    expect(repaired?.addresses).toEqual([canonical]);
    expect(repaired?.identities).toEqual([
      expect.objectContaining({ identifier: canonical, kind: 'Ethereum', isPrimary: true }),
    ]);
    expect(mockStorage.putContact).toHaveBeenCalledWith(
      expect.objectContaining({ primaryAddress: canonical, addresses: [canonical] })
    );
  });

  it('repairs contaminated persisted contacts when loading them', async () => {
    const body = '1111111111111111111111111111111111111111';
    mockStorage.listContacts.mockResolvedValueOnce([
      {
        inboxId: 'inbox-persisted-repair',
        name: 'Persisted',
        createdAt: 1,
        primaryAddress: `0x0x${body}`,
        addresses: [`0X0x${body}`],
        identities: [{ identifier: `0x0X${body}`, kind: 'Ethereum', isPrimary: true }],
      },
    ] as never);

    await useContactStore.getState().loadContacts();

    const canonical = `0x${body}`;
    const repaired = useContactStore.getState().getContactByInboxId('inbox-persisted-repair');
    expect(repaired?.primaryAddress).toBe(canonical);
    expect(repaired?.addresses).toEqual([canonical]);
    expect(repaired?.identities?.[0]?.identifier).toBe(canonical);
    expect(mockStorage.putContact).toHaveBeenCalledWith(
      expect.objectContaining({ inboxId: 'inbox-persisted-repair', primaryAddress: canonical })
    );
  });

  it('drops legacy private aliases and notes when contacts are loaded', async () => {
    mockStorage.listContacts.mockResolvedValueOnce([
      {
        inboxId: 'inbox-published-profile',
        name: 'Published Name',
        preferredName: 'Private Alias',
        preferredAvatar: 'https://example.com/private.png',
        notes: 'private note',
        avatar: 'https://example.com/published.png',
        createdAt: 1,
      },
    ] as never);

    await useContactStore.getState().loadContacts();

    const contact = useContactStore.getState().getContactByInboxId('inbox-published-profile');
    expect(contact?.name).toBe('Published Name');
    expect(contact?.avatar).toBe('https://example.com/published.png');
    expect(contact?.preferredName).toBeUndefined();
    expect(contact?.preferredAvatar).toBeUndefined();
    expect(contact?.notes).toBeUndefined();
  });

});
