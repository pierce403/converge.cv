import { describe, expect, it } from 'vitest';
import type { Conversation } from '@/types';
import { getConversationPresentation } from './conversation-presentation';

const conversation = (updates: Partial<Conversation> = {}): Conversation => ({
  id: 'conversation-id',
  peerId: 'peer-inbox',
  lastMessageAt: 0,
  unreadCount: 0,
  pinned: false,
  archived: false,
  createdAt: 0,
  ...updates,
});

describe('getConversationPresentation', () => {
  it('keeps a legacy XMTP DM direct', () => {
    expect(
      getConversationPresentation(
        conversation({ displayName: 'Orange Orca', displayAvatar: 'orca.png' }),
        'self-inbox',
      ),
    ).toMatchObject({
      kind: 'dm',
      memberCount: null,
      title: 'Orange Orca',
      avatar: 'orca.png',
    });
  });

  it('presents a two-member Convos group as a direct chat', () => {
    expect(
      getConversationPresentation(
        conversation({
          isGroup: true,
          groupName: 'Chat',
          groupNameDerived: true,
          displayName: 'Orange Orca',
          displayAvatar: 'orca.png',
          memberInboxes: ['self-inbox', 'peer-inbox'],
          groupMembers: [
            { inboxId: 'self-inbox', displayName: 'Blue Bear' },
            { inboxId: 'peer-inbox', displayName: 'Orange Orca' },
          ],
        }),
        'self-inbox',
      ),
    ).toMatchObject({
      kind: 'direct-group',
      memberCount: 2,
      title: 'Orange Orca',
      avatar: 'orca.png',
    });
  });

  it('does not leak stale peer identity into a multi-person group', () => {
    expect(
      getConversationPresentation(
        conversation({
          isGroup: true,
          groupName: 'Chat',
          groupNameDerived: true,
          displayName: 'Orange Orca',
          displayAvatar: 'orca.png',
          memberInboxes: ['self-inbox', 'peer-inbox', 'third-inbox'],
          groupMembers: [
            { inboxId: 'self-inbox', displayName: 'Blue Bear' },
            { inboxId: 'peer-inbox', displayName: 'Orange Orca' },
            { inboxId: 'third-inbox', displayName: 'Green Gecko' },
          ],
        }),
        'self-inbox',
      ),
    ).toMatchObject({
      kind: 'group',
      memberCount: 3,
      title: 'Orange Orca, Green Gecko',
      avatar: undefined,
    });
  });

  it('treats an explicitly named two-member group as a group', () => {
    expect(
      getConversationPresentation(
        conversation({
          id: 'group-id',
          peerId: 'group-id',
          isGroup: true,
          groupName: 'Launch team',
          groupImage: 'group.png',
          displayName: 'Stale peer name',
          displayAvatar: 'stale-peer.png',
          memberInboxes: ['self-inbox', 'peer-inbox'],
        }),
        'self-inbox',
      ),
    ).toMatchObject({
      kind: 'group',
      memberCount: 2,
      title: 'Launch team',
      avatar: 'group.png',
    });
  });
});
