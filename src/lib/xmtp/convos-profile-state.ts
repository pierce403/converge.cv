import type { ConvosProfileSource, GroupMember } from '@/types';
import { sanitizeConvosDisplayName } from './convos-codecs';

export type ConvosProfileMetadata = Record<string, string | number | boolean>;

export interface ConvosProfileEvent {
  inboxId: string;
  source: ConvosProfileSource;
  sentAt: number;
  name?: string;
  encryptedImageUrl?: string;
  encryptedImageSalt?: Uint8Array;
  encryptedImageNonce?: Uint8Array;
  memberKind?: number;
  metadata?: ConvosProfileMetadata;
}

const SOURCE_RANK: Record<ConvosProfileSource, number> = {
  contact: 0,
  appData: 1,
  profileSnapshot: 2,
  profileUpdate: 3,
};

export function normalizeConvosInboxId(value: string): string {
  return value.trim().replace(/^0x/i, '').toLowerCase();
}

const CONVERSATION_SCOPED_METADATA_KEYS = ['connections', 'timezone'] as const;

function mergeWinningMetadata(
  existing: ConvosProfileMetadata | undefined,
  incoming: ConvosProfileMetadata | undefined,
  source: ConvosProfileSource,
): ConvosProfileMetadata | undefined {
  if (incoming === undefined) return existing;
  if (Object.keys(incoming).length > 0) return { ...incoming };
  if (source !== 'profileUpdate') return existing;
  if (!existing) return undefined;
  const cleared = { ...existing };
  for (const key of CONVERSATION_SCOPED_METADATA_KEYS) delete cleared[key];
  return cleared;
}

function sourceWins(existing: GroupMember, incoming: ConvosProfileEvent): boolean {
  if (!existing.profileSource) return true;
  const rankDifference = SOURCE_RANK[incoming.source] - SOURCE_RANK[existing.profileSource];
  return rankDifference > 0 || (rankDifference === 0 && incoming.sentAt >= (existing.profileUpdatedAt ?? 0));
}

/** Mirrors Convos profile precedence: update > snapshot > appData > contact. */
export function mergeConvosGroupMemberProfile(
  existing: GroupMember | undefined,
  incoming: ConvosProfileEvent,
): GroupMember {
  const inboxId = normalizeConvosInboxId(incoming.inboxId);
  const current: GroupMember = existing ? { ...existing, inboxId } : { inboxId };
  const name = sanitizeConvosDisplayName(incoming.name);
  const metadata = incoming.metadata && Object.keys(incoming.metadata).length > 0
    ? { ...incoming.metadata }
    : undefined;

  if (sourceWins(current, incoming)) {
    return {
      ...current,
      displayName: name ?? current.displayName,
      encryptedProfileImageUrl: incoming.encryptedImageUrl?.trim() || current.encryptedProfileImageUrl,
      encryptedProfileImageSalt: incoming.encryptedImageSalt ?? current.encryptedProfileImageSalt,
      encryptedProfileImageNonce: incoming.encryptedImageNonce ?? current.encryptedProfileImageNonce,
      // Proto value 0 means unspecified, so it must not erase a known agent kind.
      memberKind: incoming.memberKind && incoming.memberKind > 0 ? incoming.memberKind : current.memberKind,
      profileMetadata: mergeWinningMetadata(current.profileMetadata, incoming.metadata, incoming.source),
      profileSource: incoming.source,
      profileUpdatedAt: incoming.sentAt,
    };
  }

  return {
    ...current,
    displayName: current.displayName ?? name,
    encryptedProfileImageUrl: current.encryptedProfileImageUrl ?? incoming.encryptedImageUrl?.trim() ?? undefined,
    encryptedProfileImageSalt: current.encryptedProfileImageSalt ?? incoming.encryptedImageSalt,
    encryptedProfileImageNonce: current.encryptedProfileImageNonce ?? incoming.encryptedImageNonce,
    memberKind: current.memberKind ?? (incoming.memberKind && incoming.memberKind > 0 ? incoming.memberKind : undefined),
    profileMetadata: current.profileMetadata ?? metadata,
  };
}

export function mergeConvosGroupProfiles(
  members: GroupMember[] | undefined,
  incomingProfiles: ConvosProfileEvent[],
): GroupMember[] {
  const byInboxId = new Map<string, GroupMember>();
  for (const member of members ?? []) {
    const inboxId = normalizeConvosInboxId(member.inboxId);
    if (inboxId) byInboxId.set(inboxId, { ...member, inboxId });
  }
  for (const profile of incomingProfiles) {
    const inboxId = normalizeConvosInboxId(profile.inboxId);
    if (!inboxId) continue;
    byInboxId.set(inboxId, mergeConvosGroupMemberProfile(byInboxId.get(inboxId), { ...profile, inboxId }));
  }
  return Array.from(byInboxId.values());
}

export function mergeConvosProfilesForRoster(
  members: GroupMember[] | undefined,
  incomingProfiles: ConvosProfileEvent[],
  rosterInboxIds: Iterable<string>,
): GroupMember[] {
  const roster = new Set(Array.from(rosterInboxIds, normalizeConvosInboxId).filter(Boolean));
  const currentMembers = (members ?? []).filter((member) => roster.has(normalizeConvosInboxId(member.inboxId)));
  return mergeConvosGroupProfiles(
    currentMembers,
    incomingProfiles.filter((profile) => roster.has(normalizeConvosInboxId(profile.inboxId))),
  );
}

export function hasConvosSnapshotContent(member: GroupMember): boolean {
  const hasValidEncryptedImage = Boolean(
    member.encryptedProfileImageUrl &&
      member.encryptedProfileImageSalt?.length === 32 &&
      member.encryptedProfileImageNonce?.length === 12,
  );
  return Boolean(
    sanitizeConvosDisplayName(member.displayName) ||
      hasValidEncryptedImage ||
      (member.memberKind && member.memberKind > 0) ||
      (member.profileMetadata && Object.keys(member.profileMetadata).length > 0),
  );
}
