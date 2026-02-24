import type { Identity } from '@/types';
import type { Contact, ContactProfileInput } from '@/lib/stores/contact-store';
import { resolveFidFromAddress } from './service';
import { fetchNeynarUserProfile } from './neynar';
import { pickFarcasterDisplayName } from './display-name';

const isAutoLabel = (val?: string | null): boolean => {
  if (!val) return true;
  const v = val.trim();
  if (!v) return true;
  return v.startsWith('Identity ') || v.startsWith('Wallet ');
};

const isAddressLikeLabel = (val?: string | null): boolean => {
  if (!val) return false;
  const v = val.trim().toLowerCase();
  return v.startsWith('0x');
};

const shouldFillDisplayName = (displayName?: string | null): boolean => {
  const raw = displayName?.trim();
  if (!raw) return true;
  if (isAutoLabel(raw)) return true;
  if (isAddressLikeLabel(raw)) return true;
  return false;
};

const shouldFillAvatar = (avatar?: string | null): boolean => {
  const raw = avatar?.trim();
  return !raw;
};

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

  if (!identity?.address) {
    return;
  }

  const fid = identity.farcasterFid ?? (await resolveFidFromAddress(identity.address, apiKey));
  if (!fid) {
    return;
  }

  const needsName = shouldFillDisplayName(identity.displayName);
  const needsAvatar = shouldFillAvatar(identity.avatar);
  const shouldFetchProfile = Boolean(existingContact && identity.inboxId) || needsName || needsAvatar;

  let profile: Awaited<ReturnType<typeof fetchNeynarUserProfile>> | null = null;
  if (shouldFetchProfile) {
    profile = await fetchNeynarUserProfile(fid, apiKey);
  }

  // Update identity: always persist the FID, and opportunistically fill displayName/avatar
  // when missing (preferring XMTP/locally chosen names if already set).
  let nextIdentity = identity;
  let identityChanged = false;

  if (nextIdentity.farcasterFid !== fid) {
    nextIdentity = { ...nextIdentity, farcasterFid: fid };
    identityChanged = true;
  }

  if (profile) {
    if (needsName) {
      const candidateName = pickFarcasterDisplayName(profile);
      if (candidateName) {
        nextIdentity = { ...nextIdentity, displayName: candidateName };
        identityChanged = true;
      }
    }

    if (needsAvatar) {
      const avatarUrl = profile.pfp_url?.trim();
      if (avatarUrl) {
        nextIdentity = { ...nextIdentity, avatar: avatarUrl };
        identityChanged = true;
      }
    }
  }

  if (identityChanged) {
    await putIdentity(nextIdentity);
    setIdentity(nextIdentity);
  }

  // Update the self contact record only when we have a confirmed inboxId. This avoids
  // accidentally mutating a non-self contact during early identity bootstrapping.
  if (!existingContact || !identity.inboxId) {
    return;
  }

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
