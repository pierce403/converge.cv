import { describe, expect, it, vi } from 'vitest';
import { uploadEncryptedAttachment } from './attachment-storage';

const clientId = '1234567890abcdef1234567890abcdef';
const cid = 'bafkreigh2akiscaildcx4zq6v6ht4wz5f6d3t3b5x7k7n4m2p6yq';

describe('Thirdweb attachment storage transport', () => {
  it('uploads opaque bytes using Thirdweb storage without loading its wallet SDK', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      const uploaded = form.get('file') as File;

      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual({ 'x-client-id': clientId });
      expect(uploaded.name).toBe('files');
      expect(uploaded.type).toBe('application/octet-stream');
      expect(uploaded.size).toBe(3);
      expect(form.get('pinataMetadata')).toBe(
        JSON.stringify({ keyvalues: {}, name: 'Storage SDK' }),
      );
      expect(form.get('pinataOptions')).toBe(
        JSON.stringify({ wrapWithDirectory: false }),
      );

      return Response.json({ IpfsHash: cid });
    });

    await expect(
      uploadEncryptedAttachment(new Uint8Array([1, 2, 3]), {
        clientId,
        fetchFn,
      }),
    ).resolves.toEqual({
      uri: `ipfs://${cid}`,
      url: `https://${clientId}.ipfscdn.io/ipfs/${cid}`,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://storage.thirdweb.com/ipfs/upload',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('preserves the actionable Thirdweb storage-limit error', async () => {
    const fetchFn = vi.fn(async () => new Response(null, {
      status: 402,
      statusText: 'Payment Required',
    }));

    await expect(
      uploadEncryptedAttachment(new Uint8Array([1]), { clientId, fetchFn }),
    ).rejects.toThrow(
      'You have reached your storage limit. Please add a valid payment method to continue using the service.',
    );
  });

  it('rejects malformed CIDs instead of constructing an unsafe gateway URL', async () => {
    const fetchFn = vi.fn(async () => Response.json({
      IpfsHash: '../unexpected?target=example.com',
    }));

    await expect(
      uploadEncryptedAttachment(new Uint8Array([1]), { clientId, fetchFn }),
    ).rejects.toThrow('Thirdweb returned an invalid IPFS CID');
  });

  it('aborts uploads that exceed the configured timeout', async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException(
          'Aborted',
          'AbortError',
        )));
      }));
    const upload = uploadEncryptedAttachment(new Uint8Array([1]), {
      clientId,
      fetchFn,
      timeoutMs: 10,
    }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(11);
    await expect(upload).resolves.toEqual(
      expect.objectContaining({ message: 'Thirdweb attachment upload timed out.' }),
    );
    vi.useRealTimers();
  });
});
