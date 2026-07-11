import type { Attachment, EncryptedAttachment, RemoteAttachment } from '@xmtp/browser-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createRemoteAttachment, verifyUploadedRemoteAttachment } from './remote-attachment';

const encrypted: EncryptedAttachment = {
  payload: new Uint8Array([1, 2, 3]),
  contentDigest: 'abc123',
  contentLength: 3,
  filename: 'photo.png',
  nonce: new Uint8Array(12).fill(1),
  salt: new Uint8Array(32).fill(2),
  secret: new Uint8Array(32).fill(3),
};

function remoteAttachment(overrides: Partial<RemoteAttachment> = {}): RemoteAttachment {
  return {
    url: 'https://cdn.example.com/photo.enc',
    contentDigest: 'abc123',
    contentLength: 3,
    filename: 'photo.png',
    nonce: new Uint8Array(12).fill(1),
    salt: new Uint8Array(32).fill(2),
    secret: new Uint8Array(32).fill(3),
    scheme: 'https',
    ...overrides,
  };
}

describe('remote attachment publishing', () => {
  it('builds canonical XMTP metadata from the encrypted upload', () => {
    const result = createRemoteAttachment(
      encrypted,
      'https://cdn.example.com/photo.enc',
      'fallback.jpg',
    );

    expect(result).toEqual({
      url: 'https://cdn.example.com/photo.enc',
      contentDigest: encrypted.contentDigest,
      contentLength: encrypted.contentLength,
      filename: encrypted.filename,
      nonce: encrypted.nonce,
      salt: encrypted.salt,
      secret: encrypted.secret,
      scheme: 'https',
    });
  });

  it('rejects storage URLs that are not HTTPS', () => {
    expect(() => createRemoteAttachment(encrypted, 'ipfs://cid')).toThrow(
      'Attachment storage must return an HTTPS URL',
    );
  });

  it('downloads and decrypts the uploaded payload before publishing', async () => {
    const payload = new Uint8Array([1, 2, 3]);
    const fetchFn = vi.fn(async () => new Response(payload, { status: 200 }));
    const decryptFn = vi.fn(async () => ({
      content: payload,
      filename: 'photo.png',
      mimeType: 'image/png',
    } satisfies Attachment));
    const remote = remoteAttachment();

    await verifyUploadedRemoteAttachment(remote, {
      fetchFn,
      decryptFn,
      retryDelaysMs: [],
    });

    expect(fetchFn).toHaveBeenCalledWith(
      remote.url,
      expect.objectContaining({ cache: 'no-store', method: 'GET' }),
    );
    expect(decryptFn).toHaveBeenCalledWith(payload, remote);
  });

  it('retries transient storage misses before verification succeeds', async () => {
    const payload = new Uint8Array([1, 2, 3]);
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(payload, { status: 200 }));
    const decryptFn = vi.fn(async () => ({
      content: payload,
      filename: 'photo.png',
      mimeType: 'image/png',
    } satisfies Attachment));
    const sleepFn = vi.fn(async () => undefined);

    await verifyUploadedRemoteAttachment(remoteAttachment(), {
      fetchFn,
      decryptFn,
      retryDelaysMs: [10, 20],
      sleepFn,
    });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenNthCalledWith(1, 10);
    expect(sleepFn).toHaveBeenNthCalledWith(2, 20);
    expect(decryptFn).toHaveBeenCalledOnce();
  });

  it('rejects an uploaded payload whose bytes do not match the descriptor', async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([1, 2]), { status: 200 }));
    const decryptFn = vi.fn();

    await expect(
      verifyUploadedRemoteAttachment(remoteAttachment(), {
        fetchFn,
        decryptFn,
        retryDelaysMs: [0],
        sleepFn: async () => undefined,
      }),
    ).rejects.toThrow('storage returned 2 bytes; expected 3');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(decryptFn).not.toHaveBeenCalled();
  });

  it('rejects same-length ciphertext that cannot be authenticated and decrypted', async () => {
    const payload = new Uint8Array([9, 9, 9]);
    const fetchFn = vi.fn(async () => new Response(payload, { status: 200 }));
    const decryptFn = vi.fn(async () => {
      throw new Error('content digest mismatch');
    });

    await expect(
      verifyUploadedRemoteAttachment(remoteAttachment(), {
        fetchFn,
        decryptFn,
        retryDelaysMs: [],
      }),
    ).rejects.toThrow('content digest mismatch');
    expect(decryptFn).toHaveBeenCalledWith(payload, remoteAttachment());
  });
});
