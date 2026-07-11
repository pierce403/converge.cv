import type { Conversation, GroupMember } from '@/types';

export type ConversationPresentationKind = 'dm' | 'direct-group' | 'group';

export interface ConversationPresentation {
  kind: ConversationPresentationKind;
  memberCount: number | null;
  title: string | undefined;
  avatar: string | undefined;
  otherMembers: GroupMember[];
}

const GENERIC_GROUP_NAME = /^(chat|group chat|group with \d+ members)$/i;

const normalizeIdentifier = (value: string | undefined): string | null => {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
};

export const isGenericGroupName = (value: string | undefined): boolean => {
  const name = value?.trim();
  return !name || GENERIC_GROUP_NAME.test(name);
};

const uniqueCount = (values: Array<string | undefined>): number => {
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = normalizeIdentifier(value);
    if (normalized) {
      unique.add(normalized);
    }
  }
  return unique.size;
};

const getMemberCount = (conversation: Conversation): number | null => {
  const inboxCount = uniqueCount([
    ...(conversation.memberInboxes ?? []),
    ...(conversation.groupMembers ?? []).map((member) => member.inboxId),
  ]);
  if (inboxCount > 0) {
    return inboxCount;
  }

  const identifierCount = uniqueCount(conversation.members ?? []);
  return identifierCount > 0 ? identifierCount : null;
};

const getOtherMembers = (conversation: Conversation, currentInboxId?: string): GroupMember[] => {
  const ownInbox = normalizeIdentifier(currentInboxId);
  const seen = new Set<string>();
  const members: GroupMember[] = [];

  for (const member of conversation.groupMembers ?? []) {
    const inboxId = normalizeIdentifier(member.inboxId);
    if (!inboxId || inboxId === ownInbox || seen.has(inboxId)) {
      continue;
    }
    seen.add(inboxId);
    members.push(member);
  }

  return members;
};

const participantTitle = (members: GroupMember[]): string | undefined => {
  const names = Array.from(
    new Set(
      members
        .map((member) => member.displayName?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  );
  if (names.length === 0) {
    return undefined;
  }
  if (names.length <= 3) {
    return names.join(', ');
  }
  return `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
};

export const getConversationPresentation = (
  conversation: Conversation,
  currentInboxId?: string,
): ConversationPresentation => {
  if (!conversation.isGroup) {
    return {
      kind: 'dm',
      memberCount: null,
      title: conversation.displayName,
      avatar: conversation.displayAvatar,
      otherMembers: [],
    };
  }

  const memberCount = getMemberCount(conversation);
  const otherMembers = getOtherMembers(conversation, currentInboxId);
  const currentName = conversation.groupName?.trim();
  const hasExplicitName = !conversation.groupNameDerived && !isGenericGroupName(currentName);
  const hasMultiplePeers = memberCount !== null && memberCount > 2;
  const hasDirectPeerKey = normalizeIdentifier(conversation.peerId) !== normalizeIdentifier(conversation.id);
  const isDirectGroup =
    !hasMultiplePeers &&
    !hasExplicitName &&
    (conversation.groupNameDerived === true || hasDirectPeerKey || (memberCount !== null && memberCount <= 2));

  if (isDirectGroup) {
    return {
      kind: 'direct-group',
      memberCount,
      title:
        otherMembers.length === 1 && otherMembers[0].displayName?.trim()
          ? otherMembers[0].displayName.trim()
          : conversation.displayName || currentName || 'Chat',
      avatar: conversation.groupImage || conversation.displayAvatar,
      otherMembers,
    };
  }

  return {
    kind: 'group',
    memberCount,
    title: hasExplicitName ? currentName : participantTitle(otherMembers) || 'Group chat',
    avatar: conversation.groupImage,
    otherMembers,
  };
};
