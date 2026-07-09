import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContactStore } from './contact-store';

const mockStorage = {
  putContact: vi.fn(async (_contact: unknown) => undefined),
  deleteContact: vi.fn(async (_inboxId: string) => undefined),
  listContacts: vi.fn(async () => []),
  unmarkPeerDeletion: vi.fn(async (_inboxId: string) => undefined),
};

const mockFetchFarcasterFollowingWithNeynar = vi.fn();
const mockFetchNeynarUsersBulk = vi.fn();

const mockResolveXmtpAddressFromFarcasterUser = vi.fn();
const mockResolveContactName = vi.fn();

const mockDeriveInboxIdFromAddress = vi.fn(async (_address: string): Promise<string | null> => null);
const mockResolveInboxIdForAddress = vi.fn(async (_address: string): Promise<string | null> => null);
const mockCanMessageWithInbox = vi.fn(async (_inboxId: string) => ({
  canMessage: true,
  inboxId: null as string | null,
}));

vi.mock('@/lib/xmtp', () => ({
  getXmtpClient: () => ({
    deriveInboxIdFromAddress: (address: string) => mockDeriveInboxIdFromAddress(address),
    resolveInboxIdForAddress: (address: string) => mockResolveInboxIdForAddress(address),
    canMessageWithInbox: (inboxId: string) => mockCanMessageWithInbox(inboxId),
    isConnected: () => true,
  }),
}));

vi.mock('./farcaster-store', () => ({
  useFarcasterStore: {
    getState: () => ({
      getEffectiveNeynarApiKey: () => 'test-key',
    }),
  },
}));

vi.mock('@/lib/farcaster/service', () => ({
  fetchFarcasterUserFollowingFromAPI: vi.fn(async () => []),
  resolveXmtpAddressFromFarcasterUser: (...args: unknown[]) =>
    mockResolveXmtpAddressFromFarcasterUser(...args),
  resolveContactName: (...args: unknown[]) => mockResolveContactName(...args),
}));

vi.mock('@/lib/farcaster/neynar', () => ({
  fetchFarcasterFollowingWithNeynar: (...args: unknown[]) =>
    mockFetchFarcasterFollowingWithNeynar(...args),
  fetchNeynarUsersBulk: (...args: unknown[]) => mockFetchNeynarUsersBulk(...args),
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
    mockResolveInboxIdForAddress.mockResolvedValue(null);
    mockCanMessageWithInbox.mockResolvedValue({ canMessage: true, inboxId: null });
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

  it('syncFarcasterContacts enriches contacts with bulk Neynar profiles', async () => {
    const addr1 = '0x1111111111111111111111111111111111111111';
    const addr2 = '0x2222222222222222222222222222222222222222';

    mockFetchFarcasterFollowingWithNeynar.mockResolvedValueOnce([
      {
        fid: 1,
        custody_address: '0x',
        username: 'alice',
        display_name: 'Alice',
        pfp_url: 'https://example.com/a.png',
        profile: { bio: { text: '' } },
        verifications: [addr1],
      },
      {
        fid: 2,
        custody_address: '0x',
        username: 'bob',
        display_name: 'Bob',
        pfp_url: 'https://example.com/b.png',
        profile: { bio: { text: '' } },
        verifications: [addr2],
      },
    ]);

    mockFetchNeynarUsersBulk.mockResolvedValueOnce([
      {
        fid: 1,
        custody_address: '0x',
        username: 'alice',
        display_name: 'Alice',
        pfp_url: 'https://example.com/a.png',
        profile: { bio: { text: '' } },
        verifications: [addr1],
        follower_count: 111,
        following_count: 222,
        active_status: 'active',
        score: 9,
        power_badge: true,
      },
      {
        fid: 2,
        custody_address: '0x',
        username: 'bob',
        display_name: 'Bob',
        pfp_url: 'https://example.com/b.png',
        profile: { bio: { text: '' } },
        verifications: [addr2],
        follower_count: 333,
        following_count: 444,
        active_status: 'inactive',
        score: 1,
        power_badge: false,
      },
    ]);

    mockResolveXmtpAddressFromFarcasterUser.mockImplementation((user: { verifications?: string[] }) =>
      user.verifications?.[0] ?? null
    );
    mockResolveContactName.mockImplementation(async (user: { username?: string; display_name?: string }) => ({
      name: user.display_name || user.username || 'unknown',
      preferredName: user.username ? `${user.username}.fcast.id` : undefined,
    }));

    mockCanMessageWithInbox.mockImplementation(async (address: string) => ({
      canMessage: true,
      inboxId: `inbox:${address.toLowerCase()}`,
    }));

    const store = useContactStore.getState();
    await store.syncFarcasterContacts(123);

    expect(mockFetchFarcasterFollowingWithNeynar).toHaveBeenCalledWith(123, 'test-key');
    expect(mockFetchNeynarUsersBulk).toHaveBeenCalledTimes(1);
    expect(mockFetchNeynarUsersBulk).toHaveBeenCalledWith([1, 2], 'test-key');

    const storedContacts = mockStorage.putContact.mock.calls.map((call) => call[0]) as Array<{ farcasterFid?: number }>;
    const alice = storedContacts.find((contact) => contact.farcasterFid === 1) as unknown as {
      farcasterFollowerCount?: number;
      farcasterFollowingCount?: number;
      farcasterActiveStatus?: string;
      farcasterScore?: number;
      farcasterPowerBadge?: boolean;
      inboxId?: string;
      addresses?: string[];
    };

    expect(alice).toBeTruthy();
    expect(alice.farcasterFollowerCount).toBe(111);
    expect(alice.farcasterFollowingCount).toBe(222);
    expect(alice.farcasterActiveStatus).toBe('active');
    expect(alice.farcasterScore).toBe(9);
    expect(alice.farcasterPowerBadge).toBe(true);
    expect(alice.inboxId).toBe(`inbox:${addr1}`);
    expect(alice.addresses?.map((address) => address.toLowerCase())).toContain(addr1.toLowerCase());
    expect(mockCanMessageWithInbox).toHaveBeenCalledTimes(2);
    expect(mockCanMessageWithInbox).toHaveBeenNthCalledWith(1, addr1);
    expect(mockCanMessageWithInbox).toHaveBeenNthCalledWith(2, addr2);
    expect(mockDeriveInboxIdFromAddress).not.toHaveBeenCalled();

    expect(useContactStore.getState().contacts).toHaveLength(2);
  });
});
