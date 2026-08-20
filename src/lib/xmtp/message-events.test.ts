import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XmtpMessage } from './client';

type MessageEventsModule = typeof import('./message-events');

function detail(id: string, conversationId = 'conversation-1') {
  return {
    conversationId,
    message: {
      id,
      conversationId,
      senderAddress: 'inbox-peer',
      sentAt: Date.now(),
      content: `message ${id}`,
      contentType: 'text',
    } as XmtpMessage,
  };
}

describe('XMTP message ingestion bridge', () => {
  let events: MessageEventsModule;

  beforeEach(async () => {
    if (typeof window === 'undefined') {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: new EventTarget(),
      });
    }
    vi.resetModules();
    events = await import('./message-events');
  });

  afterEach(async () => {
    await events.awaitXmtpMessageIngestion();
    vi.restoreAllMocks();
  });

  it('buffers messages before registration, deduplicates by id, and drains FIFO', async () => {
    void events.dispatchXmtpMessage(detail('message-1'));
    void events.dispatchXmtpMessage(detail('message-1'));
    void events.dispatchXmtpMessage(detail('message-2'));

    const received: string[] = [];
    events.registerXmtpMessageConsumer(async ({ message }) => {
      received.push(message.id);
    });

    await events.awaitXmtpMessageIngestion();
    expect(received).toEqual(['message-1', 'message-2']);
  });

  it('serializes asynchronous consumer calls', async () => {
    const received: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    events.registerXmtpMessageConsumer(async ({ message }) => {
      received.push(`start:${message.id}`);
      if (message.id === 'message-1') {
        await firstBlocked;
      }
      received.push(`end:${message.id}`);
    });

    void events.dispatchXmtpMessage(detail('message-1'));
    void events.dispatchXmtpMessage(detail('message-2'));
    await Promise.resolve();
    await Promise.resolve();

    expect(received).toEqual(['start:message-1']);
    releaseFirst?.();
    await events.awaitXmtpMessageIngestion();
    expect(received).toEqual([
      'start:message-1',
      'end:message-1',
      'start:message-2',
      'end:message-2',
    ]);
  });

  it('keeps the DOM event contract without routing it back through the consumer', async () => {
    const domListener = vi.fn();
    const consumer = vi.fn();
    window.addEventListener('xmtp:message', domListener);
    const unregister = events.registerXmtpMessageConsumer(consumer);

    await events.dispatchXmtpMessage(detail('message-1'));

    expect(domListener).toHaveBeenCalledTimes(1);
    expect(consumer).toHaveBeenCalledTimes(1);
    expect((domListener.mock.calls[0]?.[0] as CustomEvent).detail.message.id).toBe(
      'message-1'
    );

    unregister();
    window.removeEventListener('xmtp:message', domListener);
  });

  it('uses token-scoped cleanup when a consumer is replaced', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = events.registerXmtpMessageConsumer(first);
    const unregisterSecond = events.registerXmtpMessageConsumer(second);

    unregisterFirst();
    await events.dispatchXmtpMessage(detail('message-1'));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unregisterSecond();
  });

  it('continues with later messages after a consumer error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const received: string[] = [];
    events.registerXmtpMessageConsumer(async ({ message }) => {
      received.push(message.id);
      if (message.id === 'message-1') {
        throw new Error('bad message');
      }
    });

    const failed = events.dispatchXmtpMessage(detail('message-1'));
    const recovered = events.dispatchXmtpMessage(detail('message-2'));
    const failureCountBefore = events.getXmtpMessageIngestionFailureCount();
    await expect(failed).rejects.toThrow('bad message');
    await expect(recovered).resolves.toBeUndefined();
    await events.awaitXmtpMessageIngestion();

    expect(received).toEqual(['message-1', 'message-2']);
    expect(events.getXmtpMessageIngestionFailureCount()).toBe(
      failureCountBefore + 1
    );
  });

  it('announces when the canonical durable consumer is ready', () => {
    const ready = vi.fn();
    window.addEventListener(events.XMTP_MESSAGE_CONSUMER_READY_EVENT, ready);

    const unregisterMessage = events.registerXmtpMessageConsumer(async () => undefined);
    expect(ready).not.toHaveBeenCalled();
    const unregisterSideEffects =
      events.registerXmtpDurableSideEffectConsumer(async () => undefined);

    expect(ready).toHaveBeenCalledOnce();
    unregisterMessage();
    unregisterSideEffects();
    window.removeEventListener(events.XMTP_MESSAGE_CONSUMER_READY_EVENT, ready);
  });

  it('buffers durable side effects and drains them through the shared FIFO', async () => {
    void events.dispatchXmtpDurableSideEffect({
      type: 'system',
      detail: {
        conversationId: 'conversation-1',
        system: { id: 'system-1', body: 'Member added' },
      },
    });
    const received: string[] = [];
    const unregister = events.registerXmtpDurableSideEffectConsumer(
      async (effect) => {
        received.push(effect.type);
      }
    );

    await events.awaitXmtpMessageIngestion();

    expect(received).toEqual(['system']);
    unregister();
  });
});
