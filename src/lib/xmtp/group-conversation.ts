import { getAddress } from 'viem';
import type { Conversation, GroupMember } from '@/types';
import type { GroupDetails } from './client';

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

const normalizeMemberIdentifier = (value: string): string => {
  const trimmed = value.trim();
  if (!ETH_ADDRESS_REGEX.test(trimmed)) {
    return trimmed;
  }

  try {
    return getAddress(trimmed as `0x${string}`);
  } catch {
    return trimmed;
  }
};

/**
 * Convert the SDK's current group state into the authoritative local fields.
 * Undefined metadata values are intentional: they clear values removed by
 * another installation instead of preserving stale local copies.
 */
export const groupDetailsToConversationUpdates = (
  details: GroupDetails,
  existing?: Pick<Conversation, 'groupName' | 'groupNameDerived'>
): Partial<Conversation> => {
  const memberIdentifiers = details.members.map((member) =>
    member.address ? normalizeMemberIdentifier(member.address) : member.inboxId
  );
  const uniqueMembers = Array.from(new Set(memberIdentifiers.filter(Boolean)));
  const uniqueAdmins = Array.from(
    new Set(
      [...(details.adminAddresses ?? []), ...(details.superAdminAddresses ?? [])]
        .filter(Boolean)
        .map(normalizeMemberIdentifier)
    )
  );
  const memberInboxes = Array.from(
    new Set(details.members.map((member) => member.inboxId).filter(Boolean))
  );
  const adminInboxes = Array.from(new Set((details.adminInboxes ?? []).filter(Boolean)));
  const superAdminInboxes = Array.from(new Set((details.superAdminInboxes ?? []).filter(Boolean)));
  const groupMembers: GroupMember[] = details.members.map((member) => ({
    inboxId: member.inboxId,
    address: member.address ? normalizeMemberIdentifier(member.address) : undefined,
    permissionLevel: member.permissionLevel,
    isAdmin: member.isAdmin,
    isSuperAdmin: member.isSuperAdmin,
    displayName: member.displayName,
    avatar: member.avatar,
    memberKind: member.memberKind,
    profileMetadata: member.profileMetadata,
    profileSource: member.profileSource,
    profileUpdatedAt: member.profileUpdatedAt,
    encryptedProfileImageUrl: member.encryptedProfileImageUrl,
    encryptedProfileImageSalt: member.encryptedProfileImageSalt,
    encryptedProfileImageNonce: member.encryptedProfileImageNonce,
  }));
  const authoritativeName = details.name?.trim() || undefined;
  const existingDerivedName = existing?.groupName?.trim() || undefined;
  const hasDirectMembership = details.members.length <= 2;
  const preserveDerivedName = Boolean(
    hasDirectMembership &&
      existing?.groupNameDerived &&
      (!authoritativeName || authoritativeName === existingDerivedName)
  );

  return {
    isGroup: true,
    topic: details.id,
    peerId: details.id,
    members: uniqueMembers,
    admins: uniqueAdmins,
    memberInboxes,
    adminInboxes,
    superAdminInboxes,
    groupMembers,
    groupName: authoritativeName ?? (preserveDerivedName ? existingDerivedName : undefined),
    groupNameDerived: preserveDerivedName,
    groupImage: details.imageUrl?.trim() || undefined,
    groupDescription: details.description?.trim() || undefined,
    inviteTag: details.inviteTag?.trim() || undefined,
    groupPermissions: details.permissions
      ? {
          policyType: details.permissions.policyType,
          policySet: { ...details.permissions.policySet },
        }
      : undefined,
  };
};
