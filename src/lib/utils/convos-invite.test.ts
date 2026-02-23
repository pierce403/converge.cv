import { Buffer } from 'buffer';
import { describe, expect, it } from 'vitest';

import {
  encodeConvosGroupAppData,
  parseConvosGroupAppData,
  sanitizeConvosProfileDisplayName,
  upsertConvosGroupProfile,
} from './convos-invite';

function encodeVarint(value: number): Uint8Array {
  const out: number[] = [];
  let v = value >>> 0;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return Uint8Array.from(out);
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function encodeStringField(fieldNumber: number, value: string): Uint8Array {
  const key = (fieldNumber << 3) | 2;
  const encodedValue = new TextEncoder().encode(value);
  return concatBytes(Uint8Array.from([key]), encodeVarint(encodedValue.length), encodedValue);
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function compressConvosPayload(payload: Uint8Array): Promise<Uint8Array> {
  const compressionStream = new CompressionStream('deflate');
  const writer = compressionStream.writable.getWriter();
  await writer.write(payload as unknown as BufferSource);
  await writer.close();

  const compressedBytes = new Uint8Array(await new Response(compressionStream.readable).arrayBuffer());
  const sizeBytes = Uint8Array.from([
    (payload.length >>> 24) & 0xff,
    (payload.length >>> 16) & 0xff,
    (payload.length >>> 8) & 0xff,
    payload.length & 0xff,
  ]);
  return concatBytes(Uint8Array.from([0x1f]), sizeBytes, compressedBytes);
}

describe('convos invite metadata utils', () => {
  it('round-trips Convos appData metadata with profiles', async () => {
    const inboxId = 'ab'.repeat(32);
    const expiresAt = new Date('2026-02-19T18:21:08.000Z');
    const encoded = await encodeConvosGroupAppData({
      tag: 'TakobotTag',
      expiresAt,
      profiles: [
        {
          inboxId,
          name: 'DantoBot',
          imageUrl: 'https://cdn.example.com/danto.png',
        },
      ],
    });

    const decoded = await parseConvosGroupAppData(encoded);

    expect(decoded.isEncoded).toBe(true);
    expect(decoded.tag).toBe('TakobotTag');
    expect(decoded.expiresAt?.toISOString()).toBe(expiresAt.toISOString());
    expect(decoded.profiles).toEqual([
      {
        inboxId,
        name: 'DantoBot',
        imageUrl: 'https://cdn.example.com/danto.png',
        encryptedImageUrl: undefined,
        encryptedImageSalt: undefined,
        encryptedImageNonce: undefined,
      },
    ]);
  });

  it('parses compressed appData payloads used by Convos', async () => {
    const protobufPayload = encodeStringField(1, 'compressed-tag');
    const compressed = await compressConvosPayload(protobufPayload);
    const encoded = toBase64Url(compressed);

    const parsed = await parseConvosGroupAppData(encoded);

    expect(parsed.isEncoded).toBe(true);
    expect(parsed.isCompressed).toBe(true);
    expect(parsed.tag).toBe('compressed-tag');
  });

  it('upserts member profile by normalized inbox id', () => {
    const existing = [
      {
        inboxId: `0x${'cd'.repeat(32)}`,
        name: 'Old Name',
      },
    ];

    const result = upsertConvosGroupProfile(existing, {
      inboxId: 'CD'.repeat(32),
      name: '  New Name  ',
      imageUrl: ' https://cdn.example.com/new.png ',
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      inboxId: 'cd'.repeat(32),
      name: 'New Name',
      imageUrl: 'https://cdn.example.com/new.png',
      encryptedImageUrl: undefined,
      encryptedImageSalt: undefined,
      encryptedImageNonce: undefined,
    });
  });

  it('trims and caps profile display names to Convos limits', () => {
    expect(sanitizeConvosProfileDisplayName('   ')).toBeUndefined();
    const longName = 'x'.repeat(70);
    expect(sanitizeConvosProfileDisplayName(longName)).toHaveLength(50);
    expect(sanitizeConvosProfileDisplayName('  Alice  ')).toBe('Alice');
  });
});
