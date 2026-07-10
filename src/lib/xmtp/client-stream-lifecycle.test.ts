import { afterEach, describe, expect, it, vi } from 'vitest';
import { XmtpClient } from './client';

type StreamHarness = {
  isDone: boolean;
  end: ReturnType<typeof vi.fn>;
};

function attachStream(xmtp: XmtpClient, stream: StreamHarness): void {
  (xmtp as unknown as { messageStream: StreamHarness | null }).messageStream = stream;
}

function attachClient(xmtp: XmtpClient, close: ReturnType<typeof vi.fn>): void {
  (xmtp as unknown as { client: unknown }).client = { close };
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
});
