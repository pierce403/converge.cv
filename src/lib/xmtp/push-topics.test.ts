import { ConsentState, type HmacKey, type UserPreferenceUpdate } from '@xmtp/browser-sdk';
import { describe, expect, it, vi } from 'vitest';
import { XmtpClient } from './client';

type PushClientInternals = {
  client: {
    preferences: {
      sync: () => Promise<void>;
      streamPreferences?: (options: {
        disableSync?: boolean;
        onValue?: (updates: UserPreferenceUpdate[]) => void;
        onError?: (error: Error) => void;
      }) => Promise<{
        isDone: boolean;
        end: () => Promise<{ done: true; value: undefined }>;
      }>;
    };
    conversations: {
      list: (options: { consentStates: ConsentState[]; includeDuplicateDms: boolean }) => Promise<Array<{
        hmacKeys: () => Promise<Map<string, HmacKey[]>>;
      }>>;
    };
  } | null;
};

const internals = (client: XmtpClient) => client as unknown as PushClientInternals;

describe('XMTP push topic snapshots', () => {
  it('syncs consent first and retains HMAC keys only for allowed and unknown conversations', async () => {
    const client = new XmtpClient();
    const allowedGroupId = 'a'.repeat(64);
    const unknownDmGroupId = 'b'.repeat(64);
    const duplicateDmGroupId = 'c'.repeat(64);
    const order: string[] = [];
    const sync = vi.fn(async () => {
      order.push('sync');
    });
    const list = vi.fn(async () => {
      order.push('list');
      return [
        {
          hmacKeys: vi.fn(async () => {
            order.push('groupKeys');
            return new Map([
              [allowedGroupId.toUpperCase(), [{ epoch: 1n, key: new Uint8Array([1]) }]],
            ]);
          }),
        },
        {
          hmacKeys: vi.fn(async () => {
            order.push('dmKeys');
            return new Map([
              [unknownDmGroupId, [{ epoch: 2n, key: new Uint8Array([2]) }]],
              [duplicateDmGroupId, [{ epoch: 3n, key: new Uint8Array([3]) }]],
            ]);
          }),
        },
      ];
    });
    internals(client).client = {
      preferences: { sync },
      conversations: { list },
    };

    const snapshot = await client.getPushHmacKeys();

    expect(order).toEqual(['sync', 'list', 'groupKeys', 'dmKeys']);
    expect(list).toHaveBeenCalledWith({
      consentStates: [ConsentState.Allowed, ConsentState.Unknown],
      includeDuplicateDms: true,
    });
    expect(Array.from(snapshot.keys())).toEqual([
      allowedGroupId,
      unknownDmGroupId,
      duplicateDmGroupId,
    ]);
    expect(snapshot.get(unknownDmGroupId)).toEqual([
      { epoch: 2n, key: new Uint8Array([2]) },
    ]);
  });

  it('notifies on HMAC-key and consent preference changes and closes the stream', async () => {
    const client = new XmtpClient();
    const onChange = vi.fn();
    const end = vi.fn(async () => ({ done: true as const, value: undefined }));
    let streamOptions:
      | {
          disableSync?: boolean;
          onValue?: (updates: UserPreferenceUpdate[]) => void;
        }
      | undefined;
    const streamPreferences = vi.fn(async (options) => {
      streamOptions = options;
      return { isDone: false, end };
    });
    internals(client).client = {
      preferences: { sync: vi.fn(async () => undefined), streamPreferences },
      conversations: {
        list: vi.fn(async () => []),
      },
    };

    const stop = await client.watchPushTopicChanges(onChange);
    streamOptions?.onValue?.([
      { type: 'HmacKeyUpdate', key: [1] },
      {
        type: 'ConsentUpdate',
        consent: {
          entity: 'group-id',
          entityType: 0,
          state: ConsentState.Denied,
        },
      },
    ]);
    await stop();

    expect(streamPreferences).toHaveBeenCalledWith(
      expect.objectContaining({ disableSync: true }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });
});
