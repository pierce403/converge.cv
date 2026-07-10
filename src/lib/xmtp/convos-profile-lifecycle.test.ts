import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore, useContactStore, useConversationStore } from '@/lib/stores';
import type { Conversation, Identity } from '@/types';
import { XmtpClient } from './client';
import {
  ConvosProfileSnapshotCodec,
  ContentTypeConvosProfileSnapshot,
  ContentTypeConvosProfileUpdate,
} from './convos-codecs';
import type { EncodedContent } from './profile-codec';

const storageMocks = vi.hoisted(() => ({
  getConversation: vi.fn<() => Promise<Conversation | undefined>>(),
  putConversation: vi.fn<(conversation: Conversation) => Promise<void>>(),
}));

vi.mock('@/lib/storage', () => ({
  getStorage: vi.fn(async () => storageMocks),
}));

const ownInbox = '11'.repeat(32);
const requesterInbox = '22'.repeat(32);
const agentInbox = '33'.repeat(32);

function setIdentity(displayName = 'Orange Orca') {
  const identity: Identity = {
    address: '0x1111111111111111111111111111111111111111',
    publicKey: '',
    privateKey: '0x01',
    inboxId: ownInbox,
    displayName,
    createdAt: 1,
  };
  useAuthStore.setState({ identity });
  return identity;
}

describe('Convos profile publication lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMocks.getConversation.mockResolvedValue(undefined);
    storageMocks.putConversation.mockResolvedValue(undefined);
    useContactStore.setState({ contacts: [], isLoading: false });
    useConversationStore.setState({ conversations: [] });
    setIdentity();
  });

  it('builds a post-join snapshot with self, requester, and named agent profiles', async () => {
    const xmtp = new XmtpClient();
    const identity = setIdentity();
    (xmtp as unknown as { client: unknown; identity: unknown }).client = { inboxId: ownInbox };
    (xmtp as unknown as { client: unknown; identity: unknown }).identity = identity;

    const send = vi.fn(async (_content: EncodedContent, _options?: { shouldPush?: boolean }) => 'message-id');
    const group = {
      sync: vi.fn(async () => undefined),
      members: vi.fn(async () => [
        { inboxId: ownInbox },
        { inboxId: requesterInbox },
        { inboxId: agentInbox },
      ]),
      messages: vi.fn(async () => [{
        contentType: ContentTypeConvosProfileUpdate,
        content: {
          name: 'Release Agent',
          memberKind: 1,
          metadata: { templateId: 'release-template', active: true },
        },
        senderInboxId: agentInbox,
        sentAtNs: 10_000_000n,
      }]),
      send,
      appData: '',
    };

    await (xmtp as unknown as {
      sendConvosProfileSnapshot: (
        conversationId: string,
        group: unknown,
        seed: { inboxId: string; profile: { name: string } },
      ) => Promise<void>;
    }).sendConvosProfileSnapshot('group-1', group, {
      inboxId: requesterInbox,
      profile: { name: 'Blue Bear' },
    });

    const encoded = send.mock.calls[0]?.[0];
    const decoded = new ConvosProfileSnapshotCodec().decode(encoded);
    expect(decoded.profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ inboxId: ownInbox, name: 'Orange Orca' }),
      expect.objectContaining({ inboxId: requesterInbox, name: 'Blue Bear' }),
      expect.objectContaining({
        inboxId: agentInbox,
        name: 'Release Agent',
        memberKind: 1,
        metadata: { templateId: 'release-template', active: true },
      }),
    ]));
  });

  it('publishes the self-authored profile without rewriting legacy appData', async () => {
    const xmtp = new XmtpClient();
    const identity = setIdentity();
    (xmtp as unknown as { client: unknown; identity: unknown }).client = { inboxId: ownInbox };
    (xmtp as unknown as { client: unknown; identity: unknown }).identity = identity;

    const send = vi.fn(async (_content: EncodedContent, _options?: { shouldPush?: boolean }) => 'profile-message-id');
    const group = {
      sync: vi.fn(async () => undefined),
      members: vi.fn(async () => []),
      messages: vi.fn(async () => []),
      send,
      updateAppData: vi.fn<(appData: string) => Promise<void>>(),
      appData: '',
    };

    await (xmtp as unknown as {
      ensureConvosGroupProfilePublished: (conversationId: string, group: unknown) => Promise<void>;
    }).ensureConvosGroupProfilePublished('group-2', group);

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toMatchObject({ type: ContentTypeConvosProfileUpdate });
    expect(group.updateAppData).not.toHaveBeenCalled();
  });

  it('does not publish a snapshot when group sync cannot establish a current roster', async () => {
    const xmtp = new XmtpClient();
    const identity = setIdentity();
    (xmtp as unknown as { client: unknown; identity: unknown }).client = { inboxId: ownInbox };
    (xmtp as unknown as { client: unknown; identity: unknown }).identity = identity;

    const send = vi.fn(async (_content: EncodedContent) => 'message-id');
    const group = {
      sync: vi.fn(async () => { throw new Error('sync failed'); }),
      members: vi.fn(async () => [{ inboxId: ownInbox }]),
      messages: vi.fn(async () => []),
      send,
      appData: '',
    };

    await expect((xmtp as unknown as {
      sendConvosProfileSnapshot: (conversationId: string, group: unknown) => Promise<void>;
    }).sendConvosProfileSnapshot('group-sync-failure', group)).rejects.toThrow('sync failed');

    expect(group.sync).toHaveBeenCalledTimes(3);
    expect(group.members).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not publish a snapshot when the authoritative roster cannot be read', async () => {
    const xmtp = new XmtpClient();
    const identity = setIdentity();
    (xmtp as unknown as { client: unknown; identity: unknown }).client = { inboxId: ownInbox };
    (xmtp as unknown as { client: unknown; identity: unknown }).identity = identity;

    const send = vi.fn(async (_content: EncodedContent) => 'message-id');
    const group = {
      sync: vi.fn(async () => undefined),
      members: vi.fn(async () => { throw new Error('roster unavailable'); }),
      messages: vi.fn(async () => []),
      send,
      appData: '',
    };

    await expect((xmtp as unknown as {
      sendConvosProfileSnapshot: (conversationId: string, group: unknown) => Promise<void>;
    }).sendConvosProfileSnapshot('group-roster-failure', group)).rejects.toThrow('roster unavailable');

    expect(send).not.toHaveBeenCalled();
  });

  it('does not republish the same profile revision after reload', async () => {
    const xmtp = new XmtpClient();
    const identity = setIdentity();
    (xmtp as unknown as { client: unknown; identity: unknown }).client = { inboxId: ownInbox };
    (xmtp as unknown as { client: unknown; identity: unknown }).identity = identity;
    storageMocks.getConversation.mockResolvedValue({
      id: 'group-3',
      peerId: 'group-3',
      createdAt: 1,
      lastMessageAt: 1,
      unreadCount: 0,
      pinned: false,
      archived: false,
      isGroup: true,
      convosProfilePublishedRevision: `${ownInbox}:Orange Orca`,
    });

    const send = vi.fn(async (_content: EncodedContent, _options?: { shouldPush?: boolean }) => 'message-id');
    const group = { sync: vi.fn(async () => undefined), send, appData: '' };
    await (xmtp as unknown as {
      ensureConvosGroupProfilePublished: (conversationId: string, group: unknown) => Promise<void>;
    }).ensureConvosGroupProfilePublished('group-3', group);

    expect(send).not.toHaveBeenCalled();
  });

  it('coalesces concurrent publication attempts for the same profile revision', async () => {
    const xmtp = new XmtpClient();
    const identity = setIdentity();
    (xmtp as unknown as { client: unknown; identity: unknown }).client = { inboxId: ownInbox };
    (xmtp as unknown as { client: unknown; identity: unknown }).identity = identity;

    const send = vi.fn(async (_content: EncodedContent) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return 'message-id';
    });
    const group = {
      sync: vi.fn(async () => undefined),
      members: vi.fn(async () => []),
      messages: vi.fn(async () => []),
      send,
      appData: '',
    };
    const publish = (xmtp as unknown as {
      ensureConvosGroupProfilePublished: (conversationId: string, group: unknown) => Promise<void>;
    }).ensureConvosGroupProfilePublished.bind(xmtp);

    await Promise.all([
      publish('group-concurrent', group),
      publish('group-concurrent', group),
    ]);

    expect(send).toHaveBeenCalledOnce();
  });

  it('uses the current XMTP roster when a post-add snapshot races cached membership', async () => {
    const xmtp = new XmtpClient();
    const identity = setIdentity();
    const group = {
      id: 'group-roster-race',
      sync: vi.fn(async () => undefined),
      members: vi.fn(async () => [{ inboxId: ownInbox }, { inboxId: requesterInbox }]),
      messages: vi.fn(async () => []),
      send: vi.fn(async () => 'message-id'),
      addMembers: vi.fn(async () => undefined),
      appData: '',
    };
    (xmtp as unknown as { client: unknown; identity: unknown }).client = {
      inboxId: ownInbox,
      conversations: { getConversationById: vi.fn(async () => group) },
    };
    (xmtp as unknown as { client: unknown; identity: unknown }).identity = identity;
    storageMocks.getConversation.mockResolvedValue({
      id: group.id,
      peerId: group.id,
      createdAt: 1,
      lastMessageAt: 1,
      unreadCount: 0,
      pinned: false,
      archived: false,
      isGroup: true,
      memberInboxes: [ownInbox],
      groupMembers: [{ inboxId: ownInbox, displayName: 'Orange Orca' }],
    });

    await (xmtp as unknown as {
      processProfileSideChannel: (message: unknown) => Promise<boolean>;
    }).processProfileSideChannel({
      conversationId: group.id,
      senderInboxId: ownInbox,
      sentAtNs: 20_000_000n,
      contentType: ContentTypeConvosProfileSnapshot,
      content: { profiles: [{ inboxId: requesterInbox, name: 'Blue Bear' }] },
    });

    const persistedCalls = storageMocks.putConversation.mock.calls;
    const persisted = persistedCalls[persistedCalls.length - 1]?.[0];
    expect(group.sync).toHaveBeenCalledOnce();
    expect(persisted?.groupMembers).toEqual(expect.arrayContaining([
      expect.objectContaining({ inboxId: requesterInbox, displayName: 'Blue Bear' }),
    ]));
  });

  it('persists an approved requester profile locally before relying on snapshot delivery', async () => {
    const xmtp = new XmtpClient();
    storageMocks.getConversation.mockResolvedValue({
      id: 'group-approved-requester',
      peerId: 'group-approved-requester',
      createdAt: 1,
      lastMessageAt: 1,
      unreadCount: 0,
      pinned: false,
      archived: false,
      isGroup: true,
      memberInboxes: [ownInbox],
      groupMembers: [{ inboxId: ownInbox, displayName: 'Orange Orca' }],
    });

    await (xmtp as unknown as {
      persistConvosJoinRequesterProfile: (
        conversationId: string,
        inboxId: string,
        profile: { name: string; memberKind: string },
        metadata: Record<string, string>,
        sentAt: number,
      ) => Promise<void>;
    }).persistConvosJoinRequesterProfile(
      'group-approved-requester',
      requesterInbox,
      { name: 'Release Agent', memberKind: 'agent' },
      { templateId: 'release-template' },
      42,
    );

    const persistedCalls = storageMocks.putConversation.mock.calls;
    const persisted = persistedCalls[persistedCalls.length - 1]?.[0];
    expect(persisted?.memberInboxes).toContain(requesterInbox);
    expect(persisted?.groupMembers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        inboxId: requesterInbox,
        displayName: 'Release Agent',
        memberKind: 1,
        profileMetadata: { templateId: 'release-template' },
        profileSource: 'profileSnapshot',
      }),
    ]));
  });
});
