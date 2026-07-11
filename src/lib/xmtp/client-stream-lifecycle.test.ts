import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@xmtp/browser-sdk';
import { XmtpClient } from './client';

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
  });

  it('ends the SDK AsyncStreamProxy when disconnecting', async () => {
    const xmtp = new XmtpClient();
    const end = vi.fn(async () => ({ done: true, value: undefined }));
    attachStream(xmtp, { isDone: false, end });

    await xmtp.disconnect();
    await xmtp.disconnect();

    expect(end).toHaveBeenCalledOnce();
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
