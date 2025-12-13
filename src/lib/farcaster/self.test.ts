import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Identity } from '@/types';
import type { Contact } from '@/lib/stores/contact-store';
import { syncSelfFarcasterProfile } from './self';
import { resolveFidFromAddress } from './service';
import { fetchNeynarUserProfile } from './neynar';

vi.mock('./service', () => ({
  resolveFidFromAddress: vi.fn(),
}));

vi.mock('./neynar', () => ({
  fetchNeynarUserProfile: vi.fn(),
}));

describe('syncSelfFarcasterProfile', () => {
  const baseIdentity: Identity = {
    address: '0xabcabcabcabcabcabcabcabcabcabcabcabcabca',
    publicKey: '',
    createdAt: 123,
    inboxId: 'inbox-123',
  };

  const baseContact: Contact = {
    inboxId: 'inbox-123',
    name: 'Self',
    createdAt: 123,
    source: 'inbox',
    addresses: [baseIdentity.address],
    identities: [{ identifier: baseIdentity.address, kind: 'Ethereum', isPrimary: true }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('still updates identity when inboxId is missing (but skips contact upsert)', async () => {
    (resolveFidFromAddress as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(777);
    (fetchNeynarUserProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: 777,
      username: 'alice',
      display_name: 'Alice',
      pfp_url: 'https://example.com/alice.png',
      follower_count: 10,
      following_count: 5,
      active_status: 'active',
      power_badge: true,
      score: 12.34,
      custody_address: baseIdentity.address,
      verifications: [baseIdentity.address],
      profile: { bio: { text: '' } },
    });

    const putIdentity = vi.fn(async (_next: Identity) => undefined);
    const setIdentity = vi.fn();
    const upsertContactProfile = vi.fn(async (_input: unknown) => baseContact);

    await syncSelfFarcasterProfile({
      identity: { ...baseIdentity, inboxId: undefined },
      apiKey: 'key',
      existingContact: baseContact,
      putIdentity,
      setIdentity,
      upsertContactProfile,
    });

    expect(resolveFidFromAddress).toHaveBeenCalledWith(baseIdentity.address, 'key');
    expect(fetchNeynarUserProfile).toHaveBeenCalledWith(777, 'key');
    expect(putIdentity).toHaveBeenCalledWith(expect.objectContaining({ farcasterFid: 777, displayName: 'Alice', avatar: 'https://example.com/alice.png' }));
    expect(setIdentity).toHaveBeenCalledWith(expect.objectContaining({ farcasterFid: 777, displayName: 'Alice', avatar: 'https://example.com/alice.png' }));
    expect(upsertContactProfile).not.toHaveBeenCalled();
  });

  it('resolves FID, persists it, and updates contact metadata', async () => {
    (resolveFidFromAddress as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(777);
    (fetchNeynarUserProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: 777,
      username: 'alice',
      display_name: 'Alice',
      pfp_url: 'https://example.com/alice.png',
      follower_count: 10,
      following_count: 5,
      active_status: 'active',
      power_badge: true,
      score: 12.34,
      custody_address: baseIdentity.address,
      verifications: [baseIdentity.address],
      profile: { bio: { text: '' } },
    });

    const putIdentity = vi.fn(async (_next: Identity) => undefined);
    const setIdentity = vi.fn();
    const upsertContactProfile = vi.fn(async (_input: unknown) => baseContact);

    await syncSelfFarcasterProfile({
      identity: { ...baseIdentity, farcasterFid: undefined },
      apiKey: 'key',
      existingContact: baseContact,
      putIdentity,
      setIdentity,
      upsertContactProfile,
      now: () => 999,
    });

    expect(resolveFidFromAddress).toHaveBeenCalledWith(baseIdentity.address, 'key');
    expect(putIdentity).toHaveBeenCalledWith(expect.objectContaining({ farcasterFid: 777, displayName: 'Alice', avatar: 'https://example.com/alice.png' }));
    expect(setIdentity).toHaveBeenCalledWith(expect.objectContaining({ farcasterFid: 777, displayName: 'Alice', avatar: 'https://example.com/alice.png' }));

    expect(fetchNeynarUserProfile).toHaveBeenCalledWith(777, 'key');
    expect(upsertContactProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        inboxId: baseContact.inboxId,
        metadata: expect.objectContaining({
          farcasterFid: 777,
          farcasterUsername: 'alice',
          farcasterScore: 12.34,
          farcasterFollowerCount: 10,
          farcasterFollowingCount: 5,
          farcasterActiveStatus: 'active',
          farcasterPowerBadge: true,
          lastSyncedAt: 999,
        }),
      })
    );
  });

  it('uses existing identity FID without resolving again (and fills missing profile fields)', async () => {
    (fetchNeynarUserProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: 555,
      username: 'bob',
      display_name: 'Bob',
      pfp_url: 'https://example.com/bob.png',
      follower_count: 1,
      following_count: 2,
      active_status: 'inactive',
      power_badge: false,
      score: 1.2,
      custody_address: baseIdentity.address,
      verifications: [baseIdentity.address],
      profile: { bio: { text: '' } },
    });

    const putIdentity = vi.fn(async (_next: Identity) => undefined);
    const setIdentity = vi.fn();
    const upsertContactProfile = vi.fn(async (_input: unknown) => baseContact);

    await syncSelfFarcasterProfile({
      identity: { ...baseIdentity, farcasterFid: 555 },
      apiKey: 'key',
      existingContact: baseContact,
      putIdentity,
      setIdentity,
      upsertContactProfile,
    });

    expect(resolveFidFromAddress).not.toHaveBeenCalled();
    expect(fetchNeynarUserProfile).toHaveBeenCalledWith(555, 'key');
    expect(putIdentity).toHaveBeenCalledWith(expect.objectContaining({ farcasterFid: 555, displayName: 'Bob', avatar: 'https://example.com/bob.png' }));
    expect(setIdentity).toHaveBeenCalledWith(expect.objectContaining({ farcasterFid: 555, displayName: 'Bob', avatar: 'https://example.com/bob.png' }));
    expect(upsertContactProfile).toHaveBeenCalled();
  });

  it('does not overwrite an existing non-auto display name or avatar', async () => {
    (fetchNeynarUserProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: 555,
      username: 'bob',
      display_name: 'Bob',
      pfp_url: 'https://example.com/bob.png',
      follower_count: 1,
      following_count: 2,
      active_status: 'inactive',
      power_badge: false,
      score: 1.2,
      custody_address: baseIdentity.address,
      verifications: [baseIdentity.address],
      profile: { bio: { text: '' } },
    });

    const putIdentity = vi.fn(async (_next: Identity) => undefined);
    const setIdentity = vi.fn();
    const upsertContactProfile = vi.fn(async (_input: unknown) => baseContact);

    await syncSelfFarcasterProfile({
      identity: {
        ...baseIdentity,
        farcasterFid: 555,
        displayName: 'Custom Name',
        avatar: 'data:image/png;base64,abc',
      },
      apiKey: 'key',
      existingContact: baseContact,
      putIdentity,
      setIdentity,
      upsertContactProfile,
    });

    expect(resolveFidFromAddress).not.toHaveBeenCalled();
    expect(fetchNeynarUserProfile).toHaveBeenCalledWith(555, 'key');
    // No identity changes needed: name/avatar already set and fid already present.
    expect(putIdentity).not.toHaveBeenCalled();
    expect(setIdentity).not.toHaveBeenCalled();
    expect(upsertContactProfile).toHaveBeenCalled();
  });
});
