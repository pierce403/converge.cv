import { describe, expect, it } from 'vitest';
import type { Conversation } from '@/types';
import type { GroupDetails } from './client';
import { groupDetailsToConversationUpdates } from './group-conversation';

const details = (overrides: Partial<GroupDetails> = {}): GroupDetails => ({
  id: 'group-1',
  name: 'Current name',
  imageUrl: 'https://example.com/group.png',
  description: 'Current description',
  inviteTag: 'current-tag',
  members: [
    {
      inboxId: 'inbox-member',
      address: '0x1111111111111111111111111111111111111111',
      isAdmin: false,
      isSuperAdmin: false,
      identifiers: [],
    },
  ],
  adminAddresses: [],
  superAdminAddresses: ['0x2222222222222222222222222222222222222222'],
  adminInboxes: [],
  superAdminInboxes: ['inbox-admin'],
  permissions: undefined,
  ...overrides,
});

describe('groupDetailsToConversationUpdates', () => {
  it('promotes a locally DM-shaped record to the authoritative group shape', () => {
    const malformed: Conversation = {
      id: 'group-1',
      peerId: 'inbox-sender',
      createdAt: 1,
      lastMessageAt: 2,
      unreadCount: 0,
      pinned: false,
      archived: false,
      isGroup: false,
    };

    const hydrated = {
      ...malformed,
      ...groupDetailsToConversationUpdates(details()),
    };

    expect(hydrated).toMatchObject({
      id: 'group-1',
      isGroup: true,
      peerId: 'group-1',
      topic: 'group-1',
      groupName: 'Current name',
      groupImage: 'https://example.com/group.png',
      groupDescription: 'Current description',
      inviteTag: 'current-tag',
      memberInboxes: ['inbox-member'],
      superAdminInboxes: ['inbox-admin'],
    });
    expect(hydrated.admins).toEqual(['0x2222222222222222222222222222222222222222']);
  });

  it('clears metadata removed by another installation', () => {
    const stale: Conversation = {
      id: 'group-1',
      peerId: 'group-1',
      topic: 'group-1',
      createdAt: 1,
      lastMessageAt: 2,
      unreadCount: 0,
      pinned: false,
      archived: false,
      isGroup: true,
      groupName: 'Stale name',
      groupImage: 'https://example.com/stale.png',
      groupDescription: 'Stale description',
      inviteTag: 'stale-tag',
    };

    const hydrated = {
      ...stale,
      ...groupDetailsToConversationUpdates(
        details({ name: '', imageUrl: '', description: '', inviteTag: undefined })
      ),
    };

    expect(hydrated.groupName).toBeUndefined();
    expect(hydrated.groupImage).toBeUndefined();
    expect(hydrated.groupDescription).toBeUndefined();
    expect(hydrated.inviteTag).toBeUndefined();
    expect(hydrated.groupNameDerived).toBe(false);
  });

  it('preserves a derived direct-chat title until authoritative metadata changes it', () => {
    const existing = {
      groupName: 'Orange Orca',
      groupNameDerived: true,
    };

    const unchanged = groupDetailsToConversationUpdates(
      details({ name: 'Orange Orca' }),
      existing
    );
    const unnamed = groupDetailsToConversationUpdates(details({ name: '' }), existing);
    const changed = groupDetailsToConversationUpdates(
      details({ name: 'Project Room' }),
      existing
    );
    const expanded = groupDetailsToConversationUpdates(
      details({
        name: 'Orange Orca',
        members: [
          ...details().members,
          { inboxId: 'inbox-two', isAdmin: false, isSuperAdmin: false, identifiers: [] },
          { inboxId: 'inbox-three', isAdmin: false, isSuperAdmin: false, identifiers: [] },
        ],
      }),
      existing
    );

    expect(unchanged.groupName).toBe('Orange Orca');
    expect(unchanged.groupNameDerived).toBe(true);
    expect(unnamed.groupName).toBe('Orange Orca');
    expect(unnamed.groupNameDerived).toBe(true);
    expect(changed.groupName).toBe('Project Room');
    expect(changed.groupNameDerived).toBe(false);
    expect(expanded.groupNameDerived).toBe(false);
  });
});
