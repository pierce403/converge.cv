import type { Identity } from '@/types';
import type { Contact, ContactProfileInput } from '@/lib/stores/contact-store';
import { resolveFidFromAddress } from './service';
import { fetchNeynarUserProfile } from './neynar';

export async function syncSelfFarcasterProfile(args: {
  identity: Identity;
  apiKey: string;
  existingContact?: Contact;
  putIdentity: (next: Identity) => Promise<void>;
  setIdentity: (next: Identity) => void;
  upsertContactProfile: (input: ContactProfileInput) => Promise<Contact>;
  now?: () => number;
}): Promise<void> {
  const { identity, apiKey, existingContact, putIdentity, setIdentity, upsertContactProfile } = args;
  const now = args.now ?? (() => Date.now());

  if (!identity?.address || !identity.inboxId) {
    return;
  }

  const fid = identity.farcasterFid ?? (await resolveFidFromAddress(identity.address, apiKey));
  if (!fid) {
    return;
  }

  if (identity.farcasterFid !== fid) {
    const updatedIdentity = { ...identity, farcasterFid: fid };
    await putIdentity(updatedIdentity);
    setIdentity(updatedIdentity);
  }

  if (!existingContact) {
    return;
  }

  const profile = await fetchNeynarUserProfile(fid, apiKey);
  if (!profile) {
    return;
  }

  await upsertContactProfile({
    inboxId: existingContact.inboxId,
    source: existingContact.source ?? 'inbox',
    metadata: {
      ...existingContact,
      farcasterFid: fid,
      farcasterUsername: profile.username ?? existingContact.farcasterUsername,
      farcasterScore: profile.score ?? existingContact.farcasterScore,
      farcasterFollowerCount: profile.follower_count ?? existingContact.farcasterFollowerCount,
      farcasterFollowingCount: profile.following_count ?? existingContact.farcasterFollowingCount,
      farcasterActiveStatus: profile.active_status ?? existingContact.farcasterActiveStatus,
      farcasterPowerBadge: profile.power_badge ?? existingContact.farcasterPowerBadge,
      lastSyncedAt: now(),
    },
  });
}

