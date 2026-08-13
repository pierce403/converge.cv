import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@xmtp/browser-sdk';

const retentionMocks = vi.hoisted(() => ({
  deleteLocalMessage: vi.fn(async () => ({
    deletedMessageIds: [],
    updatedConversations: [],
  })),
}));

vi.mock('@/lib/message-retention', () => ({
  deleteLocalMessage: retentionMocks.deleteLocalMessage,
}));

import { XmtpClient } from './client';
import { useXmtpStore } from '@/lib/stores/xmtp-store';
import { signerIdentityKey } from './device-provisioning';

type StreamHarness = {
  isDone: boolean;
  end: ReturnType<typeof vi.fn>;
};

type StreamMessage = {
  id: string;
  conversationId: string;
  senderInboxId: string;
  content: unknown;
  contentType?: {
    authorityId: string;
    typeId: string;
    versionMajor: number;
    versionMinor: number;
  };
  sentAtNs: bigint;
};

class ControlledStream implements AsyncIterable<StreamMessage> {
  isDone = false;
  private firstMessage: StreamMessage | null;
  private pendingNext: ((result: IteratorResult<StreamMessage>) => void) | null = null;
  readonly end = vi.fn(async (): Promise<IteratorResult<StreamMessage>> => {
    this.isDone = true;
    this.pendingNext?.({ done: true, value: undefined });
    this.pendingNext = null;
    return { done: true, value: undefined };
  });

  constructor(message: StreamMessage) {
    this.firstMessage = message;
  }

  next = async (): Promise<IteratorResult<StreamMessage>> => {
    if (this.firstMessage) {
      const value = this.firstMessage;
      this.firstMessage = null;
      return { done: false, value };
    }
    if (this.isDone) {
      return { done: true, value: undefined };
    }
    return await new Promise<IteratorResult<StreamMessage>>((resolve) => {
      this.pendingNext = resolve;
    });
  };

  return = this.end;

  [Symbol.asyncIterator](): AsyncIterator<StreamMessage> {
    return this;
  }
}

class ControlledDeletionStream implements AsyncIterable<string> {
  isDone = false;
  private firstMessageId: string | null;
  private pendingNext: ((result: IteratorResult<string>) => void) | null = null;
  readonly end = vi.fn(async (): Promise<IteratorResult<string>> => {
    this.isDone = true;
    this.pendingNext?.({ done: true, value: undefined });
    this.pendingNext = null;
    return { done: true, value: undefined };
  });

  constructor(messageId: string) {
    this.firstMessageId = messageId;
  }

  next = async (): Promise<IteratorResult<string>> => {
    if (this.firstMessageId) {
      const value = this.firstMessageId;
      this.firstMessageId = null;
      return { done: false, value };
    }
    if (this.isDone) return { done: true, value: undefined };
    return await new Promise<IteratorResult<string>>((resolve) => {
      this.pendingNext = resolve;
    });
  };

  return = this.end;

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return this;
  }
}

function attachStream(xmtp: XmtpClient, stream: StreamHarness): void {
  (xmtp as unknown as { messageStream: StreamHarness | null }).messageStream = stream;
}

function attachClient(xmtp: XmtpClient, close: ReturnType<typeof vi.fn>): void {
  (xmtp as unknown as { client: unknown }).client = { close };
}

function attachStreamingClient(
  xmtp: XmtpClient,
  stream: ControlledStream,
  close: ReturnType<typeof vi.fn>
): void {
  (xmtp as unknown as { client: unknown }).client = {
    inboxId: 'self-inbox',
    close,
    conversations: {
      streamAllMessages: vi.fn(async () => stream),
    },
  };
}

function attachRevocableClient(
  xmtp: XmtpClient,
  close: ReturnType<typeof vi.fn>,
  options: { inboxId: string; installationId: string; installationIdBytes: Uint8Array }
): void {
  (xmtp as unknown as { client: unknown; identity: unknown }).client = {
    close,
    ...options,
  };
  (xmtp as unknown as { identity: unknown }).identity = {
    address: `0x${'11'.repeat(20)}`,
    privateKey: `0x${'22'.repeat(32)}`,
    inboxId: options.inboxId,
    installationId: options.installationId,
    xmtpDbPathMode: 'inbox-default',
  };
}

describe('XmtpClient message stream cleanup', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    useXmtpStore.setState({
      connectionStatus: 'disconnected',
      installationRecovery: null,
      error: null,
    });
  });

  it('ends the SDK AsyncStreamProxy when disconnecting', async () => {
    const xmtp = new XmtpClient();
    const end = vi.fn(async () => ({ done: true, value: undefined }));
    attachStream(xmtp, { isDone: false, end });

    await xmtp.disconnect();
    await xmtp.disconnect();

    expect(end).toHaveBeenCalledOnce();
  });

  it('serializes concurrent connection lifecycle operations', async () => {
    const xmtp = new XmtpClient();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const result = {
      inboxId: 'inbox',
      installationId: 'installation',
      installationRegistered: false,
      historySyncRequested: false,
      historySyncRequired: false,
    };
    const connectInternal = vi.fn(async (identity: { address: string }) => {
      events.push(`start:${identity.address}`);
      if (identity.address === 'first') await firstGate;
      events.push(`end:${identity.address}`);
      return result;
    });
    (
      xmtp as unknown as {
        connectInternal: typeof connectInternal;
      }
    ).connectInternal = connectInternal;

    const first = xmtp.connect({ address: 'first', privateKey: '0x01' });
    const second = xmtp.connect({ address: 'second', privateKey: '0x02' });
    await vi.waitFor(() => expect(events).toEqual(['start:first']));
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(events).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
  });

  it('does not reuse a different connected installation for an exact repair candidate', async () => {
    const xmtp = new XmtpClient();
    const identity = {
      address: `0x${'11'.repeat(20)}`,
      privateKey: `0x${'22'.repeat(32)}`,
    };
    const onInstallationReady = vi.fn();
    (
      xmtp as unknown as {
        client: unknown;
        identity: unknown;
      }
    ).client = {
      isReady: true,
      inboxId: 'expected-inbox',
      installationId: 'different-installation',
    };
    (xmtp as unknown as { identity: unknown }).identity = identity;
    useXmtpStore.setState({ connectionStatus: 'connected' });

    await expect(
      xmtp.connect(identity, {
        expectedInboxId: 'expected-inbox',
        expectedInstallationId: 'exact-candidate',
        requireExpectedInstallation: true,
        onInstallationReady,
      })
    ).rejects.toThrow(/different browser installation than the exact repair candidate/i);

    expect(onInstallationReady).not.toHaveBeenCalled();
  });

  it('keeps an already-staged retained repair candidate open after an early retry failure', async () => {
    const xmtp = new XmtpClient();
    const inboxId = 'a'.repeat(64);
    const installationId = 'candidate-p';
    const repairIdentity = {
      address: `0x${'11'.repeat(20)}`,
      privateKey: `0x${'22'.repeat(32)}`,
      inboxId,
      installationId,
      xmtpDbPathMode: 'inbox-default' as const,
    };
    const earlyFailure = new Error('local registration state unavailable');
    const close = vi.fn(async () => undefined);
    const candidate = {
      inboxId,
      installationId,
      isRegistered: vi.fn(async () => {
        throw earlyFailure;
      }),
      close,
    };
    const internal = xmtp as unknown as {
      retainedInstallationRepairClient: unknown;
      createSigner: () => Promise<{ getIdentifier: () => Promise<unknown> }>;
      repairInstallationInternal: (
        identity: typeof repairIdentity,
        options: {
          recovery: {
            reason: 'installation-unregistered';
            inboxId: string;
            expectedInstallationId: string;
            localInstallationId: string;
            expectedInstallationVisible: boolean;
            localInstallationVisible: boolean;
            localInstallationRegistered: boolean;
            signerIsRecoveryIdentifier: boolean;
            existingInstallationCount: number;
            databasePathMode: 'inbox-default';
          };
          interruptedRepairCandidateId: string;
          expectedInboxId: string;
          onCandidateReady: () => Promise<void>;
        }
      ) => Promise<unknown>;
    };
    internal.retainedInstallationRepairClient = {
      client: candidate,
      databasePathMode: 'inbox-default',
      inboxId,
      installationId,
      signerIdentity: signerIdentityKey(repairIdentity),
    };
    internal.createSigner = vi.fn(async () => ({
      getIdentifier: vi.fn(async () => ({
        identifier: repairIdentity.address,
        identifierKind: 0,
      })),
    }));

    await expect(
      internal.repairInstallationInternal(repairIdentity, {
        recovery: {
          reason: 'installation-unregistered',
          inboxId,
          expectedInstallationId: installationId,
          localInstallationId: installationId,
          expectedInstallationVisible: false,
          localInstallationVisible: false,
          localInstallationRegistered: false,
          signerIsRecoveryIdentifier: true,
          existingInstallationCount: 8,
          databasePathMode: 'inbox-default',
        },
        interruptedRepairCandidateId: installationId,
        expectedInboxId: inboxId,
        onCandidateReady: vi.fn(async () => undefined),
      })
    ).rejects.toBe(earlyFailure);

    expect(close).not.toHaveBeenCalled();
    expect(internal.retainedInstallationRepairClient).toMatchObject({
      client: candidate,
      inboxId,
      installationId,
    });
  });

  it('closes a different installation produced by durability reopen instead of retaining it', async () => {
    const xmtp = new XmtpClient();
    const inboxId = 'a'.repeat(64);
    const stagedInstallationId = 'candidate-staged';
    const reopenedInstallationId = 'candidate-after-reopen';
    const repairIdentity = {
      address: `0x${'11'.repeat(20)}`,
      privateKey: `0x${'22'.repeat(32)}`,
      inboxId,
      installationId: stagedInstallationId,
      xmtpDbPathMode: 'inbox-default' as const,
    };
    const signerIdentifier = {
      identifier: repairIdentity.address,
      identifierKind: 0,
    };
    let registered = false;
    let visibleInstallationIds: string[] = [];
    const stagedClose = vi.fn(async () => undefined);
    const stagedClient = {
      inboxId,
      installationId: stagedInstallationId,
      isRegistered: vi.fn(async () => registered),
      register: vi.fn(async () => {
        registered = true;
        visibleInstallationIds = [stagedInstallationId];
      }),
      close: stagedClose,
    };
    const reopenedClose = vi.fn(async () => undefined);
    const reopenedClient = {
      inboxId,
      installationId: reopenedInstallationId,
      isRegistered: vi.fn(async () => false),
      register: vi.fn(async () => undefined),
      close: reopenedClose,
    };
    const currentState = () => ({
      inboxId,
      recoveryIdentifier: signerIdentifier,
      accountIdentifiers: [signerIdentifier],
      installations: visibleInstallationIds.map((id, index) => ({
        id,
        bytes: new Uint8Array([index + 1]),
        clientTimestampNs: BigInt(index + 1),
      })),
    });
    const internal = xmtp as unknown as {
      retainedInstallationRepairClient: unknown;
      createSigner: () => Promise<{ getIdentifier: () => Promise<typeof signerIdentifier> }>;
      retryWithBackoff: (
        label: string,
        operation: () => Promise<unknown>
      ) => Promise<unknown>;
      retryWithDelay: (
        label: string,
        operation: () => Promise<unknown>
      ) => Promise<unknown>;
      repairInstallationInternal: (
        identity: typeof repairIdentity,
        options: {
          recovery: {
            reason: 'installation-unregistered';
            inboxId: string;
            expectedInstallationId: string;
            localInstallationId: string;
            expectedInstallationVisible: boolean;
            localInstallationVisible: boolean;
            localInstallationRegistered: boolean;
            signerIsRecoveryIdentifier: boolean;
            existingInstallationCount: number;
            databasePathMode: 'inbox-default';
          };
          interruptedRepairCandidateId: string;
          expectedInboxId: string;
          onCandidateReady: () => Promise<void>;
          onInstallationReady: () => Promise<void>;
        }
      ) => Promise<unknown>;
    };
    internal.retainedInstallationRepairClient = {
      client: stagedClient,
      databasePathMode: 'inbox-default',
      inboxId,
      installationId: stagedInstallationId,
      signerIdentity: signerIdentityKey(repairIdentity),
    };
    internal.createSigner = vi.fn(async () => ({
      getIdentifier: vi.fn(async () => signerIdentifier),
    }));
    internal.retryWithBackoff = vi.fn(
      async (label: string, operation: () => Promise<unknown>) => {
        if (label.includes('getInboxIdForIdentifier')) return inboxId;
        if (label.includes('fetchInboxStates')) return [currentState()];
        return await operation();
      }
    );
    internal.retryWithDelay = vi.fn(
      async (_label: string, operation: () => Promise<unknown>) => await operation()
    );
    const create = vi
      .spyOn(Client, 'create')
      .mockResolvedValue(reopenedClient as unknown as Client);

    await expect(
      internal.repairInstallationInternal(repairIdentity, {
        recovery: {
          reason: 'installation-unregistered',
          inboxId,
          expectedInstallationId: stagedInstallationId,
          localInstallationId: stagedInstallationId,
          expectedInstallationVisible: false,
          localInstallationVisible: false,
          localInstallationRegistered: false,
          signerIsRecoveryIdentifier: true,
          existingInstallationCount: 8,
          databasePathMode: 'inbox-default',
        },
        interruptedRepairCandidateId: stagedInstallationId,
        expectedInboxId: inboxId,
        onCandidateReady: vi.fn(async () => undefined),
        onInstallationReady: vi.fn(async () => undefined),
      })
    ).rejects.toThrow(/installation/i);

    expect(create).toHaveBeenCalledOnce();
    expect(stagedClient.register).toHaveBeenCalledOnce();
    expect(stagedClose).toHaveBeenCalledOnce();
    expect(reopenedClose).toHaveBeenCalledOnce();
    expect(internal.retainedInstallationRepairClient).toBeNull();
  });

  it('closes a retained repair client exactly once when it no longer matches the journal', async () => {
    vi.useFakeTimers();
    const xmtp = new XmtpClient();
    const inboxId = 'a'.repeat(64);
    const repairIdentity = {
      address: `0x${'11'.repeat(20)}`,
      privateKey: `0x${'22'.repeat(32)}`,
    };
    const close = vi.fn(async () => undefined);
    const internal = xmtp as unknown as {
      retainedInstallationRepairClient: unknown;
      takeRetainedInstallationRepairClient: (
        identity: typeof repairIdentity,
        recovery: {
          inboxId: string;
          localInstallationId: string;
        },
        interruptedRepairCandidateId: string,
        expectedInboxId: string,
        databasePathMode: 'inbox-default'
      ) => Promise<unknown>;
    };
    internal.retainedInstallationRepairClient = {
      client: {
        inboxId,
        installationId: 'candidate-old',
        close,
      },
      databasePathMode: 'inbox-default',
      inboxId,
      installationId: 'candidate-old',
      signerIdentity: signerIdentityKey(repairIdentity),
    };

    const pending = internal.takeRetainedInstallationRepairClient(
      repairIdentity,
      {
        inboxId,
        localInstallationId: 'candidate-current',
      },
      'candidate-current',
      inboxId,
      'inbox-default'
    );
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBeNull();
    expect(close).toHaveBeenCalledOnce();
    expect(internal.retainedInstallationRepairClient).toBeNull();
  });

  it('refuses an ordinary reconnect without closing a retained live repair candidate', async () => {
    const xmtp = new XmtpClient();
    const close = vi.fn(async () => undefined);
    const internal = xmtp as unknown as {
      retainedInstallationRepairClient: unknown;
    };
    internal.retainedInstallationRepairClient = {
      client: { close },
      databasePathMode: 'inbox-default',
      inboxId: 'a'.repeat(64),
      installationId: 'candidate-p',
      signerIdentity: signerIdentityKey({
        address: `0x${'11'.repeat(20)}`,
        privateKey: `0x${'22'.repeat(32)}`,
      }),
    };

    await expect(
      xmtp.connect({
        address: `0x${'11'.repeat(20)}`,
        privateKey: `0x${'22'.repeat(32)}`,
      })
    ).rejects.toThrow(/in-progress XMTP repair candidate/i);

    expect(close).not.toHaveBeenCalled();
    expect(internal.retainedInstallationRepairClient).not.toBeNull();
  });

  it('does not close the client underneath an in-flight manual sync', async () => {
    const xmtp = new XmtpClient();
    const events: string[] = [];
    let releaseSync: (() => void) | undefined;
    const syncGate = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    (
      xmtp as unknown as { syncConversationsInternal: () => Promise<void> }
    ).syncConversationsInternal = vi.fn(async () => {
      events.push('sync:start');
      await syncGate;
      events.push('sync:end');
    });
    (
      xmtp as unknown as { disconnectInternal: () => Promise<void> }
    ).disconnectInternal = vi.fn(async () => {
      events.push('disconnect');
    });

    const sync = xmtp.syncConversations({ force: true });
    const disconnect = xmtp.disconnect();
    await vi.waitFor(() => expect(events).toEqual(['sync:start']));
    releaseSync?.();
    await Promise.all([sync, disconnect]);

    expect(events).toEqual(['sync:start', 'sync:end', 'disconnect']);
  });

  it('preserves a disconnect requested after an intervening connect', async () => {
    const xmtp = new XmtpClient();
    const events: string[] = [];
    let releaseFirstDisconnect: (() => void) | undefined;
    const firstDisconnectGate = new Promise<void>((resolve) => {
      releaseFirstDisconnect = resolve;
    });
    let disconnectCount = 0;
    (
      xmtp as unknown as { disconnectInternal: () => Promise<void> }
    ).disconnectInternal = vi.fn(async () => {
      disconnectCount += 1;
      const current = disconnectCount;
      events.push(`disconnect:${current}:start`);
      if (current === 1) await firstDisconnectGate;
      events.push(`disconnect:${current}:end`);
    });
    (
      xmtp as unknown as { connectInternal: () => Promise<unknown> }
    ).connectInternal = vi.fn(async () => {
      events.push('connect');
      return {
        inboxId: 'inbox',
        installationId: 'installation',
        installationRegistered: true,
        historySyncRequested: false,
        historySyncRequired: false,
      };
    });

    const firstDisconnect = xmtp.disconnect();
    const connect = xmtp.connect({ address: 'identity', privateKey: '0x01' });
    const finalDisconnect = xmtp.disconnect();
    await vi.waitFor(() => expect(events).toEqual(['disconnect:1:start']));
    releaseFirstDisconnect?.();
    await Promise.all([firstDisconnect, connect, finalDisconnect]);

    expect(events).toEqual([
      'disconnect:1:start',
      'disconnect:1:end',
      'connect',
      'disconnect:2:start',
      'disconnect:2:end',
    ]);
  });

  it('propagates conversation sync failures for strict manual syncs', async () => {
    const xmtp = new XmtpClient();
    const failure = new Error('network sync failed');
    (xmtp as unknown as { client: unknown }).client = {};
    (
      xmtp as unknown as { conversationsSyncWithRecovery: () => Promise<void> }
    ).conversationsSyncWithRecovery = vi.fn(async () => {
      throw failure;
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      xmtp.syncConversations({ force: true, strict: true, reason: 'manual-full-sync' }),
    ).rejects.toBe(failure);
  });

  it('invalidates queued background maintenance when its client generation stops', async () => {
    vi.useFakeTimers();
    const xmtp = new XmtpClient();
    let releaseLifecycle: (() => void) | undefined;
    const lifecycleGate = new Promise<void>((resolve) => {
      releaseLifecycle = resolve;
    });
    const enqueueLifecycle = (
      xmtp as unknown as {
        enqueueLifecycle: <T>(operation: () => Promise<T>) => Promise<T>;
      }
    ).enqueueLifecycle.bind(xmtp);
    const blocker = enqueueLifecycle(async () => await lifecycleGate);
    const oldClient = {};
    (xmtp as unknown as { client: unknown }).client = oldClient;
    const startMessages = vi.fn(async () => undefined);
    const startDeletions = vi.fn(async () => undefined);
    const sync = vi.fn(async () => undefined);
    const scan = vi.fn(async () => undefined);
    (
      xmtp as unknown as {
        startMessageStream: typeof startMessages;
        startMessageDeletionStream: typeof startDeletions;
        syncConversationsInternal: typeof sync;
        scanInviteJoinRequests: typeof scan;
        startBackgroundDiscoveryLoop: () => void;
        stopBackgroundDiscoveryLoop: () => void;
      }
    ).startMessageStream = startMessages;
    (
      xmtp as unknown as { startMessageDeletionStream: typeof startDeletions }
    ).startMessageDeletionStream = startDeletions;
    (
      xmtp as unknown as { syncConversationsInternal: typeof sync }
    ).syncConversationsInternal = sync;
    (
      xmtp as unknown as { scanInviteJoinRequests: typeof scan }
    ).scanInviteJoinRequests = scan;

    (
      xmtp as unknown as { startBackgroundDiscoveryLoop: () => void }
    ).startBackgroundDiscoveryLoop();
    vi.advanceTimersByTime(60_000);
    await Promise.resolve();
    (
      xmtp as unknown as { stopBackgroundDiscoveryLoop: () => void }
    ).stopBackgroundDiscoveryLoop();
    (xmtp as unknown as { client: unknown }).client = {};
    releaseLifecycle?.();
    await blocker;
    await (
      xmtp as unknown as { lifecycleTail: Promise<void> }
    ).lifecycleTail;

    expect(startMessages).not.toHaveBeenCalled();
    expect(startDeletions).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
  });

  it('ends the message stream before closing the XMTP client', async () => {
    vi.useFakeTimers();
    const xmtp = new XmtpClient();
    const events: string[] = [];
    const end = vi.fn(async () => {
      events.push('stream:end');
      return { done: true, value: undefined };
    });
    const close = vi.fn(async () => {
      events.push('client:close');
    });
    attachStream(xmtp, { isDone: false, end });
    attachClient(xmtp, close);

    const disconnect = xmtp.disconnect();
    await vi.runAllTimersAsync();
    await disconnect;

    expect(events).toEqual(['stream:end', 'client:close']);
  });

  it('mirrors native message deletions locally and ends that stream before close', async () => {
    vi.useFakeTimers();
    retentionMocks.deleteLocalMessage.mockClear();
    const xmtp = new XmtpClient();
    const events: string[] = [];
    const stream = new ControlledDeletionStream('expired-message');
    const originalEnd = stream.end.getMockImplementation();
    stream.end.mockImplementation(async () => {
      events.push('deletion-stream:end');
      return await originalEnd!();
    });
    const close = vi.fn(async () => {
      events.push('client:close');
    });
    (xmtp as unknown as { client: unknown }).client = {
      close,
      conversations: {
        streamMessageDeletions: vi.fn(async () => stream),
      },
    };

    await (
      xmtp as unknown as { startMessageDeletionStream: () => Promise<void> }
    ).startMessageDeletionStream();
    await vi.waitFor(() => {
      expect(retentionMocks.deleteLocalMessage).toHaveBeenCalledWith('expired-message');
    });

    const disconnect = xmtp.disconnect();
    await vi.runAllTimersAsync();
    await disconnect;

    expect(events).toEqual(['deletion-stream:end', 'client:close']);
  });

  it('waits for in-flight message handling before closing the XMTP client', async () => {
    vi.useFakeTimers();
    const xmtp = new XmtpClient();
    const events: string[] = [];
    const stream = new ControlledStream({
      id: 'message-1',
      conversationId: 'conversation-1',
      senderInboxId: 'peer-inbox',
      content: 'hello',
      sentAtNs: 1n,
    });
    const originalEnd = stream.end.getMockImplementation();
    stream.end.mockImplementation(async () => {
      events.push('stream:end');
      return await originalEnd!();
    });
    const close = vi.fn(async () => {
      events.push('client:close');
    });
    attachStreamingClient(xmtp, stream, close);

    let releaseConsumer: ((handled: boolean) => void) | undefined;
    let markConsumerStarted: (() => void) | undefined;
    const consumerStarted = new Promise<void>((resolve) => {
      markConsumerStarted = resolve;
    });
    const processProfile = vi.fn(
      async () =>
        await new Promise<boolean>((resolve) => {
          releaseConsumer = (handled) => {
            events.push('consumer:done');
            resolve(handled);
          };
          markConsumerStarted?.();
        })
    );
    (xmtp as unknown as { dispatchConvosJoinRequest: () => boolean }).dispatchConvosJoinRequest =
      () => false;
    (xmtp as unknown as { processProfileSideChannel: typeof processProfile }).processProfileSideChannel =
      processProfile;

    await xmtp.startMessageStream();
    await consumerStarted;

    const disconnect = xmtp.disconnect();
    await Promise.resolve();
    expect(stream.end).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();

    releaseConsumer?.(true);
    await vi.runAllTimersAsync();
    await disconnect;

    expect(events).toEqual(['stream:end', 'consumer:done', 'client:close']);
  });

  it('dispatches an application message sent by another installation in the same inbox', async () => {
    const xmtp = new XmtpClient();
    const stream = new ControlledStream({
      id: 'same-inbox-message',
      conversationId: 'conversation-1',
      senderInboxId: 'self-inbox',
      content: 'sent from another installation',
      sentAtNs: 2n,
    });
    attachStreamingClient(xmtp, stream, vi.fn(async () => undefined));

    const received = new Promise<CustomEvent>((resolve) => {
      window.addEventListener('xmtp:message', (event) => resolve(event as CustomEvent), { once: true });
    });

    await xmtp.startMessageStream();
    const event = await received;

    expect(event.detail).toMatchObject({
      conversationId: 'conversation-1',
      message: {
        id: 'same-inbox-message',
        senderAddress: 'self-inbox',
        content: 'sent from another installation',
      },
      isHistory: false,
    });

    await xmtp.disconnect();
  });

  it('dispatches a group update sent by another installation in the same inbox', async () => {
    const xmtp = new XmtpClient();
    const content = {
      initiatedByInboxId: 'self-inbox',
      addedInboxes: [],
      removedInboxes: [],
      metadataFieldChanges: [
        { fieldName: 'group_name', oldValue: 'Old name', newValue: 'New name' },
      ],
    };
    const stream = new ControlledStream({
      id: 'same-inbox-group-update',
      conversationId: 'group-1',
      senderInboxId: 'self-inbox',
      content,
      contentType: {
        authorityId: 'xmtp.org',
        typeId: 'groupUpdated',
        versionMajor: 1,
        versionMinor: 0,
      },
      sentAtNs: 3n,
    });
    attachStreamingClient(xmtp, stream, vi.fn(async () => undefined));

    const received = new Promise<CustomEvent>((resolve) => {
      window.addEventListener('xmtp:group-updated', (event) => resolve(event as CustomEvent), { once: true });
    });

    await xmtp.startMessageStream();
    const event = await received;

    expect(event.detail).toEqual({
      conversationId: 'group-1',
      content,
    });

    await xmtp.disconnect();
  });

  it('coalesces concurrent disconnects so the client closes once', async () => {
    vi.useFakeTimers();
    const xmtp = new XmtpClient();
    const end = vi.fn(async () => ({ done: true, value: undefined }));
    const close = vi.fn(async () => undefined);
    attachStream(xmtp, { isDone: false, end });
    attachClient(xmtp, close);

    const first = xmtp.disconnect();
    const second = xmtp.disconnect();
    await vi.runAllTimersAsync();
    await Promise.all([first, second]);

    expect(end).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('still closes the XMTP client when ending the stream fails', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const xmtp = new XmtpClient();
    const streamError = new Error('stream end failed');
    const end = vi.fn(async () => {
      throw streamError;
    });
    const close = vi.fn(async () => undefined);
    attachStream(xmtp, { isDone: false, end });
    attachClient(xmtp, close);

    const disconnect = xmtp.disconnect();
    await vi.runAllTimersAsync();
    await disconnect;

    expect(end).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith('[XMTP] Error closing message stream:', streamError);
  });

  it('does not hang client close when ending the deletion stream fails', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const xmtp = new XmtpClient();
    const streamError = new Error('deletion stream end failed');
    const deletionStream = {
      isDone: false,
      end: vi.fn(async () => {
        throw streamError;
      }),
    };
    const neverSettles = new Promise<void>(() => undefined);
    const close = vi.fn(async () => undefined);
    (
      xmtp as unknown as {
        client: unknown;
        messageDeletionStream: unknown;
        messageDeletionStreamTask: Promise<void>;
      }
    ).client = { close };
    (
      xmtp as unknown as {
        messageDeletionStream: unknown;
      }
    ).messageDeletionStream = deletionStream;
    (
      xmtp as unknown as {
        messageDeletionStreamTask: Promise<void>;
      }
    ).messageDeletionStreamTask = neverSettles;

    const disconnect = xmtp.disconnect();
    await vi.runAllTimersAsync();
    await disconnect;

    expect(deletionStream.end).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith(
      '[XMTP] Error closing message deletion stream:',
      streamError,
    );
  });

  it('closes the current client before statically revoking its installation', async () => {
    vi.useFakeTimers();
    const xmtp = new XmtpClient();
    const events: string[] = [];
    const inboxId = 'a'.repeat(64);
    const installationId = 'b'.repeat(64);
    const installationIdBytes = new Uint8Array([1, 2, 3]);
    const close = vi.fn(async () => {
      events.push('client:close');
    });
    const revoke = vi
      .spyOn(Client, 'revokeInstallations')
      .mockImplementation(async () => {
        events.push('static:revoke');
      });
    attachRevocableClient(xmtp, close, {
      inboxId,
      installationId,
      installationIdBytes,
    });

    const pending = xmtp.revokeCurrentInstallation({
      expectedInboxId: inboxId,
      expectedInstallationId: `0x${installationId}`,
    });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ inboxId, installationId });

    expect(events).toEqual(['client:close', 'static:revoke']);
    expect(revoke).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'EOA' }),
      inboxId,
      [installationIdBytes],
      'production'
    );
  });
});
