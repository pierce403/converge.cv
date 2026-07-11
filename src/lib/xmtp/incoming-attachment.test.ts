import type { Attachment, RemoteAttachment } from '@xmtp/browser-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  ALLOWED_INCOMING_IMAGE_MIME_TYPES,
  classifyTrustedAttachmentHost,
  fetchIncomingAttachment,
  MAX_CONCURRENT_INCOMING_ATTACHMENTS,
  MAX_INCOMING_ATTACHMENT_BYTES,
  MAX_INCOMING_IMAGE_DIMENSION,
  MAX_INCOMING_IMAGE_PIXELS,
  validateIncomingAttachmentUrl,
} from './incoming-attachment';

function writeFourCc(target: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    target[offset + index] = value.charCodeAt(index);
  }
}

function pngBytes(width = 1, height = 1): Uint8Array {
  const content = new Uint8Array(37);
  content.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(content.buffer);
  view.setUint32(8, 13, false);
  writeFourCc(content, 12, 'IHDR');
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  content[24] = 8;
  content[25] = 6;
  return content;
}

function animatedPngBytes(): Uint8Array {
  const content = new Uint8Array(45);
  content.set(pngBytes());
  writeFourCc(content, 37, 'acTL');
  return content;
}

function jpegBytes(width = 1, height = 1): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

function webpBytes(width = 1, height = 1): Uint8Array {
  const content = new Uint8Array(30);
  const view = new DataView(content.buffer);
  writeFourCc(content, 0, 'RIFF');
  view.setUint32(4, 22, true);
  writeFourCc(content, 8, 'WEBP');
  writeFourCc(content, 12, 'VP8 ');
  view.setUint32(16, 10, true);
  content.set([0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a], 20);
  view.setUint16(26, width, true);
  view.setUint16(28, height, true);
  return content;
}

function animatedWebpBytes(): Uint8Array {
  const content = new Uint8Array(30);
  const view = new DataView(content.buffer);
  writeFourCc(content, 0, 'RIFF');
  view.setUint32(4, 22, true);
  writeFourCc(content, 8, 'WEBP');
  writeFourCc(content, 12, 'VP8X');
  view.setUint32(16, 10, true);
  content[20] = 0x02;
  return content;
}

function rasterBytes(mimeType: string, width = 1, height = 1): Uint8Array {
  if (mimeType === 'image/jpeg') return jpegBytes(width, height);
  if (mimeType === 'image/webp') return webpBytes(width, height);
  return pngBytes(width, height);
}

function descriptor(overrides: Partial<RemoteAttachment> = {}): RemoteAttachment {
  return {
    url: 'https://files.public-example.com/photo.enc',
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

function decryptedAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    content: pngBytes(),
    filename: 'photo.png',
    mimeType: 'image/png',
    ...overrides,
  };
}

describe('incoming attachment URL validation', () => {
  it('canonicalizes valid public HTTPS URLs', () => {
    expect(validateIncomingAttachmentUrl('HTTPS://FILES.PUBLIC-EXAMPLE.COM/a/../photo.enc').href)
      .toBe('https://files.public-example.com/photo.enc');
  });

  it.each([
    'http://files.public-example.com/photo.enc',
    'https://user:secret@files.public-example.com/photo.enc',
    'https://files.public-example.com:8443/photo.enc',
    'https://files.public-example.com/photo.enc#ignored',
    ' https://files.public-example.com/photo.enc',
  ])('rejects unsafe or ambiguous URL %s', (url) => {
    expect(() => validateIncomingAttachmentUrl(url)).toThrow();
  });

  it.each([
    'https://localhost/photo.enc',
    'https://printer.lan/photo.enc',
    'https://service.internal/photo.enc',
    'https://single-label/photo.enc',
    'https://127.0.0.1/photo.enc',
    'https://10.0.0.1/photo.enc',
    'https://169.254.169.254/latest/meta-data',
    'https://192.168.1.1/photo.enc',
    'https://100.64.0.1/photo.enc',
    'https://192.0.2.1/photo.enc',
    'https://[::1]/photo.enc',
    'https://[fc00::1]/photo.enc',
    'https://[fe80::1]/photo.enc',
    'https://[::ffff:127.0.0.1]/photo.enc',
    'https://[2001:db8::1]/photo.enc',
  ])('rejects local, private, or reserved target %s', (url) => {
    expect(() => validateIncomingAttachmentUrl(url)).toThrow(
      /local hostname|private or reserved/,
    );
  });

  it('allows public IPv4 and IPv6 literals', () => {
    expect(validateIncomingAttachmentUrl('https://8.8.8.8/photo.enc').hostname).toBe('8.8.8.8');
    expect(validateIncomingAttachmentUrl('https://[2606:4700:4700::1111]/photo.enc').hostname)
      .toBe('[2606:4700:4700::1111]');
  });
});

describe('trusted incoming attachment hosts', () => {
  it.each([
    ['https://converge.cv/file', 'converge'],
    ['https://media.convos.org/file', 'convos'],
    ['https://media.convos.xyz/file', 'convos'],
    ['https://client-id.ipfscdn.io/ipfs/cid', 'thirdweb'],
    ['https://bafy.example.ipfs.dweb.link/file', 'ipfs'],
    ['https://unrelated.example.com/file', 'untrusted'],
  ] as const)('classifies %s as %s', (url, expected) => {
    expect(classifyTrustedAttachmentHost(url)).toBe(expected);
  });

  it('supports per-category host overrides without suffix confusion', () => {
    expect(
      classifyTrustedAttachmentHost('https://media.partner.example/file', {
        convos: ['partner.example'],
      }),
    ).toBe('convos');
    expect(
      classifyTrustedAttachmentHost('https://evilpartner.example/file', {
        convos: ['partner.example'],
      }),
    ).toBe('untrusted');
    expect(classifyTrustedAttachmentHost('https://localhost/file', { convos: ['localhost'] }))
      .toBe('untrusted');
  });
});

describe('incoming attachment fetching', () => {
  it('authorizes inside the download slot before contacting the host', async () => {
    const fetchFn = vi.fn();
    const authorize = vi.fn(async () => {
      throw new Error('Conversation is no longer allowed');
    });

    await expect(
      fetchIncomingAttachment(descriptor(), { authorize, fetchFn }),
    ).rejects.toThrow('Conversation is no longer allowed');

    expect(authorize).toHaveBeenCalledTimes(1);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('uses privacy-preserving fetch options, streams exact bytes, and normalizes MIME', async () => {
    const payload = new Uint8Array([1, 2, 3]);
    const fetchFn = vi.fn(async () => new Response(payload, {
      status: 200,
      headers: { 'Content-Length': '3' },
    }));
    const decryptFn = vi.fn(async () => decryptedAttachment({ mimeType: 'IMAGE/PNG; charset=binary' }));

    const result = await fetchIncomingAttachment(descriptor(), { fetchFn, decryptFn });

    expect(result.mimeType).toBe('image/png');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://files.public-example.com/photo.enc',
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(decryptFn).toHaveBeenCalledWith(payload, expect.objectContaining({ contentLength: 3 }));
  });

  it.each(ALLOWED_INCOMING_IMAGE_MIME_TYPES)('allows raster MIME type %s', async (mimeType) => {
    const result = await fetchIncomingAttachment(descriptor(), {
      fetchFn: async () => new Response(new Uint8Array([1, 2, 3])),
      decryptFn: async () => decryptedAttachment({
        mimeType,
        content: rasterBytes(mimeType),
      }),
    });
    expect(result.mimeType).toBe(mimeType);
  });

  it.each(['image/gif', 'image/avif'])('rejects unsupported image type %s', async (mimeType) => {
    await expect(fetchIncomingAttachment(descriptor(), {
      fetchFn: async () => new Response(new Uint8Array([1, 2, 3])),
      decryptFn: async () => decryptedAttachment({ mimeType }),
    })).rejects.toThrow('not an allowed raster image');
  });

  it('requires the declared MIME type to match the decrypted magic bytes', async () => {
    await expect(fetchIncomingAttachment(descriptor(), {
      fetchFn: async () => new Response(new Uint8Array([1, 2, 3])),
      decryptFn: async () => decryptedAttachment({
        mimeType: 'image/jpeg',
        content: pngBytes(),
      }),
    })).rejects.toThrow('MIME image/jpeg does not match image/png bytes');
  });

  it('rejects an allowed MIME type with unrecognized bytes', async () => {
    await expect(fetchIncomingAttachment(descriptor(), {
      fetchFn: async () => new Response(new Uint8Array([1, 2, 3])),
      decryptFn: async () => decryptedAttachment({
        mimeType: 'image/png',
        content: new Uint8Array([1, 2, 3, 4]),
      }),
    })).rejects.toThrow('bytes are not a supported raster image');
  });

  it.each([
    ['PNG', pngBytes(MAX_INCOMING_IMAGE_DIMENSION + 1, 1)],
    ['JPEG', jpegBytes(MAX_INCOMING_IMAGE_DIMENSION + 1, 1)],
    ['WebP', webpBytes(MAX_INCOMING_IMAGE_DIMENSION + 1, 1)],
  ] as const)('rejects oversized %s dimensions', async (_format, content) => {
    const mimeType = content[0] === 0x89
      ? 'image/png'
      : content[0] === 0xff
        ? 'image/jpeg'
        : 'image/webp';
    await expect(fetchIncomingAttachment(descriptor(), {
      fetchFn: async () => new Response(new Uint8Array([1, 2, 3])),
      decryptFn: async () => decryptedAttachment({ content, mimeType }),
    })).rejects.toThrow(`dimensions exceed ${MAX_INCOMING_IMAGE_DIMENSION}px`);
  });

  it('rejects an image whose dimensions exceed the total pixel budget', async () => {
    expect(8_000 * 5_000).toBeGreaterThan(MAX_INCOMING_IMAGE_PIXELS);
    await expect(fetchIncomingAttachment(descriptor(), {
      fetchFn: async () => new Response(new Uint8Array([1, 2, 3])),
      decryptFn: async () => decryptedAttachment({ content: pngBytes(8_000, 5_000) }),
    })).rejects.toThrow(`${MAX_INCOMING_IMAGE_PIXELS}-pixel limit`);
  });

  it('rejects animated WebP content', async () => {
    await expect(fetchIncomingAttachment(descriptor(), {
      fetchFn: async () => new Response(new Uint8Array([1, 2, 3])),
      decryptFn: async () => decryptedAttachment({
        content: animatedWebpBytes(),
        mimeType: 'image/webp',
      }),
    })).rejects.toThrow('Animated WebP attachments are not allowed');
  });

  it('rejects animated PNG content', async () => {
    await expect(fetchIncomingAttachment(descriptor(), {
      fetchFn: async () => new Response(new Uint8Array([1, 2, 3])),
      decryptFn: async () => decryptedAttachment({ content: animatedPngBytes() }),
    })).rejects.toThrow('Animated PNG attachments are not allowed');
  });

  it.each(['image/svg+xml', 'text/html', 'application/xhtml+xml'])(
    'explicitly rejects active content type %s',
    async (mimeType) => {
    await expect(fetchIncomingAttachment(descriptor(), {
      fetchFn: async () => new Response(new Uint8Array([1, 2, 3])),
      decryptFn: async () => decryptedAttachment({ mimeType }),
    })).rejects.toThrow('Active attachment type');
    },
  );

  it('rejects non-raster decrypted content', async () => {
    await expect(fetchIncomingAttachment(descriptor(), {
      fetchFn: async () => new Response(new Uint8Array([1, 2, 3])),
      decryptFn: async () => decryptedAttachment({ mimeType: 'application/pdf' }),
    })).rejects.toThrow('not an allowed raster image');
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, MAX_INCOMING_ATTACHMENT_BYTES + 1])(
    'rejects invalid declared length %s before fetching',
    async (contentLength) => {
      const fetchFn = vi.fn();
      await expect(fetchIncomingAttachment(descriptor({ contentLength }), { fetchFn }))
        .rejects.toThrow('declared length');
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );

  it('rejects a mismatched Content-Length before reading or decrypting', async () => {
    const decryptFn = vi.fn();
    let requestSignal: AbortSignal | undefined;
    await expect(fetchIncomingAttachment(descriptor(), {
      fetchFn: async (_input, init) => {
        requestSignal = init?.signal ?? undefined;
        return new Response(new Uint8Array([1, 2]), {
          headers: { 'Content-Length': '2' },
        });
      },
      decryptFn,
    })).rejects.toThrow('Content-Length was 2 bytes; expected 3');
    expect(requestSignal?.aborted).toBe(true);
    expect(decryptFn).not.toHaveBeenCalled();
  });

  it('hard-stops a chunked response as soon as actual bytes exceed the declared length', async () => {
    let cancelCalled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4]));
      },
      cancel() {
        cancelCalled = true;
      },
    });
    const decryptFn = vi.fn();

    await expect(fetchIncomingAttachment(descriptor(), {
      fetchFn: async () => new Response(body),
      decryptFn,
    })).rejects.toThrow('exceeded its declared 3-byte length');
    expect(cancelCalled).toBe(true);
    expect(decryptFn).not.toHaveBeenCalled();
  });

  it('hard-stops a response that exceeds the configured limit', async () => {
    let cancelCalled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
      },
      cancel() {
        cancelCalled = true;
      },
    });

    await expect(fetchIncomingAttachment(descriptor({ contentLength: 3 }), {
      maxBytes: 3,
      fetchFn: async () => new Response(body),
      decryptFn: async () => decryptedAttachment(),
    })).rejects.toThrow('exceeds the 3-byte download limit');
    expect(cancelCalled).toBe(true);
  });

  it('rejects truncated responses and oversized decrypted content', async () => {
    await expect(fetchIncomingAttachment(descriptor(), {
      fetchFn: async () => new Response(new Uint8Array([1, 2])),
      decryptFn: async () => decryptedAttachment(),
    })).rejects.toThrow('returned 2 bytes; expected 3');

    await expect(fetchIncomingAttachment(descriptor(), {
      maxBytes: 3,
      fetchFn: async () => new Response(new Uint8Array([1, 2, 3])),
      decryptFn: async () => decryptedAttachment({ content: new Uint8Array([1, 2, 3, 4]) }),
    })).rejects.toThrow('Decrypted attachment size');
  });

  it('aborts a timed-out request', async () => {
    const fetchFn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      }));

    await expect(fetchIncomingAttachment(descriptor(), { fetchFn, timeoutMs: 5 }))
      .rejects.toThrow('timed out after 5ms');
  });

  it('limits global fetch/decrypt concurrency to two', async () => {
    let active = 0;
    let maximumActive = 0;
    const releases: Array<() => void> = [];
    const fetchFn = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const requests = Array.from({ length: 4 }, () =>
      fetchIncomingAttachment(descriptor(), {
        fetchFn,
        decryptFn: async () => decryptedAttachment(),
      }),
    );

    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(MAX_CONCURRENT_INCOMING_ATTACHMENTS));
    expect(maximumActive).toBe(MAX_CONCURRENT_INCOMING_ATTACHMENTS);

    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(4));
    releases.splice(0).forEach((release) => release());
    await Promise.all(requests);
    expect(maximumActive).toBe(MAX_CONCURRENT_INCOMING_ATTACHMENTS);
  });
});
