import { Buffer } from 'buffer';

export type ConvosInvitePayload = {
  creatorInboxId: string;
  tag?: string;
  name?: string;
  description?: string;
  imageUrl?: string;
  expiresAfterUse?: boolean;
};

export type ParsedConvosInvite = {
  inviteCode: string;
  payload: ConvosInvitePayload;
};

type ProtobufField = {
  fieldNumber: number;
  wireType: number;
  value: number | Uint8Array;
};

const BASE64URL_CLEAN_RE = /[^A-Za-z0-9_-]/g;

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(input: string): Uint8Array {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  return Uint8Array.from(Buffer.from(`${base64}${padding}`, 'base64'));
}

function readVarint(bytes: Uint8Array, offset: number): { value: number; offset: number } {
  let result = 0;
  let shift = 0;
  let currentOffset = offset;

  while (currentOffset < bytes.length) {
    const byte = bytes[currentOffset++];
    result += (byte & 0x7f) * Math.pow(2, shift);
    if ((byte & 0x80) === 0) {
      return { value: result, offset: currentOffset };
    }
    shift += 7;
    if (shift > 63) {
      throw new Error('Malformed varint');
    }
  }

  throw new Error('Unexpected end of buffer while reading varint');
}

function readLengthDelimited(
  bytes: Uint8Array,
  offset: number,
): { value: Uint8Array; offset: number } {
  const { value: length, offset: nextOffset } = readVarint(bytes, offset);
  const end = nextOffset + length;
  if (end > bytes.length) {
    throw new Error('Length-delimited field exceeds buffer length');
  }
  return { value: bytes.slice(nextOffset, end), offset: end };
}

function parseProtobufFields(bytes: Uint8Array): ProtobufField[] {
  const fields: ProtobufField[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    const { value: key, offset: nextOffset } = readVarint(bytes, offset);
    offset = nextOffset;
    const fieldNumber = key >> 3;
    const wireType = key & 0x7;

    switch (wireType) {
      case 0: {
        const { value, offset: valueOffset } = readVarint(bytes, offset);
        fields.push({ fieldNumber, wireType, value });
        offset = valueOffset;
        break;
      }
      case 1: {
        const end = offset + 8;
        if (end > bytes.length) {
          throw new Error('Fixed64 field exceeds buffer length');
        }
        offset = end;
        break;
      }
      case 2: {
        const { value, offset: valueOffset } = readLengthDelimited(bytes, offset);
        fields.push({ fieldNumber, wireType, value });
        offset = valueOffset;
        break;
      }
      case 5: {
        const end = offset + 4;
        if (end > bytes.length) {
          throw new Error('Fixed32 field exceeds buffer length');
        }
        offset = end;
        break;
      }
      default:
        throw new Error(`Unsupported wire type ${wireType}`);
    }
  }

  return fields;
}

export function extractConvosInviteCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    const protocol = url.protocol.toLowerCase();

    if (protocol.startsWith('convos') && url.host === 'join') {
      const segments = url.pathname.split('/').filter(Boolean);
      return segments[0] ?? null;
    }

    if (url.searchParams.has('i')) {
      return url.searchParams.get('i');
    }
  } catch {
    // Not a URL, treat as raw invite code.
  }

  return trimmed;
}

export function sanitizeConvosInviteCode(input: string): string {
  return input.trim().replace(BASE64URL_CLEAN_RE, '');
}

function normalizeCreatorInboxId(bytes: Uint8Array, decodedString?: string | null): string {
  if (decodedString) {
    const trimmed = decodedString.trim();
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return trimmed.toLowerCase();
    }
    if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length >= 40) {
      return trimmed.toLowerCase();
    }
  }

  if (bytes.length === 32) {
    return bytesToHex(bytes);
  }

  return toBase64Url(bytes);
}

export function parseConvosInvite(input: string): ParsedConvosInvite {
  const extracted = extractConvosInviteCode(input);
  if (!extracted) {
    throw new Error('Invite code is empty.');
  }

  const inviteCode = sanitizeConvosInviteCode(extracted);
  if (!inviteCode) {
    throw new Error('Invite code is invalid.');
  }

  const signedInviteBytes = fromBase64Url(inviteCode);
  const signedInviteFields = parseProtobufFields(signedInviteBytes);
  const payloadField = signedInviteFields.find(
    (field) => field.fieldNumber === 1 && field.wireType === 2,
  );

  if (!payloadField || !(payloadField.value instanceof Uint8Array)) {
    throw new Error('Invite payload missing or malformed.');
  }

  const payloadFields = parseProtobufFields(payloadField.value);
  const payload: Partial<ConvosInvitePayload> = {};

  const getStringField = (fieldNumber: number): string | undefined => {
    const field = payloadFields.find(
      (candidate) => candidate.fieldNumber === fieldNumber && candidate.wireType === 2,
    );
    if (!field || !(field.value instanceof Uint8Array)) {
      return undefined;
    }
    return decodeUtf8(field.value) ?? undefined;
  };

  const creatorField = payloadFields.find(
    (candidate) => candidate.fieldNumber === 2 && candidate.wireType === 2,
  );

  if (!creatorField || !(creatorField.value instanceof Uint8Array)) {
    throw new Error('Invite creator inbox ID is missing.');
  }

  const creatorBytes = creatorField.value;
  const creatorString = decodeUtf8(creatorBytes);
  payload.creatorInboxId = normalizeCreatorInboxId(creatorBytes, creatorString);

  payload.tag = getStringField(3);
  payload.name = getStringField(4);
  payload.description = getStringField(5);
  payload.imageUrl = getStringField(6);

  const expiresAfterUseField = payloadFields.find(
    (candidate) => candidate.fieldNumber === 9 && candidate.wireType === 0,
  );
  if (expiresAfterUseField && typeof expiresAfterUseField.value === 'number') {
    payload.expiresAfterUse = Boolean(expiresAfterUseField.value);
  }

  return {
    inviteCode,
    payload: payload as ConvosInvitePayload,
  };
}
