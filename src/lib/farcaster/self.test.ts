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

  it('no-ops when inboxId is missing', async () => {
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

    expect(resolveFidFromAddress).not.toHaveBeenCalled();
    expect(fetchNeynarUserProfile).not.toHaveBeenCalled();
    expect(putIdentity).not.toHaveBeenCalled();
    expect(upsertContactProfile).not.toHaveBeenCalled();
  });

  it('resolves FID, persists it, and updates contact metadata', async () => {
    (resolveFidFromAddress as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(777);
    (fetchNeynarUserProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: 777,
      username: 'alice',
      follower_count: 10,
      following_count: 5,
      active_status: 'active',
      power_badge: true,
      score: 12.34,
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
    expect(putIdentity).toHaveBeenCalledWith(expect.objectContaining({ farcasterFid: 777 }));
    expect(setIdentity).toHaveBeenCalledWith(expect.objectContaining({ farcasterFid: 777 }));

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

  it('uses existing identity FID without resolving again', async () => {
    (fetchNeynarUserProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: 555,
      username: 'bob',
      follower_count: 1,
      following_count: 2,
      active_status: 'inactive',
      power_badge: false,
      score: 1.2,
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
    expect(putIdentity).not.toHaveBeenCalled();
    expect(setIdentity).not.toHaveBeenCalled();
    expect(fetchNeynarUserProfile).toHaveBeenCalledWith(555, 'key');
    expect(upsertContactProfile).toHaveBeenCalled();
  });
});
