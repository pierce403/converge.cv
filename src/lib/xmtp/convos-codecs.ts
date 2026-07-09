import type { ContentCodec, ContentTypeId, EncodedContent } from './profile-codec';

export type ConvosEncryptedProfileImageRef = {
  url: string;
  salt?: Uint8Array;
  nonce?: Uint8Array;
};

export type ConvosProfileUpdateContent = {
  name?: string;
  encryptedImage?: ConvosEncryptedProfileImageRef;
  memberKind?: number;
  metadata?: Record<string, string | number | boolean>;
};

export type ConvosMemberProfileContent = {
  inboxId: string;
  name?: string;
  encryptedImage?: ConvosEncryptedProfileImageRef;
  memberKind?: number;
  metadata?: Record<string, string | number | boolean>;
};

export type ConvosProfileSnapshotContent = {
  profiles: ConvosMemberProfileContent[];
};

export type ConvosTypingIndicatorContent = {
  isTyping: boolean;
};

export type ConvosJoinRequestContent = {
  inviteSlug: string;
  profile?: {
    name?: string;
    imageURL?: string;
    memberKind?: string;
  };
  metadata?: Record<string, string>;
};

type ProtobufField = {
  fieldNumber: number;
  wireType: number;
  value: number | bigint | Uint8Array;
};

export const ContentTypeConvosProfileUpdate: ContentTypeId = {
  authorityId: 'convos.org',
  typeId: 'profile_update',
  versionMajor: 1,
  versionMinor: 0,
};

export const ContentTypeConvosProfileSnapshot: ContentTypeId = {
  authorityId: 'convos.org',
  typeId: 'profile_snapshot',
  versionMajor: 1,
  versionMinor: 0,
};

export const ContentTypeConvosTypingIndicator: ContentTypeId = {
  authorityId: 'convos.org',
  typeId: 'typing_indicator',
  versionMajor: 1,
  versionMinor: 0,
};

export const ContentTypeConvosThinking: ContentTypeId = {
  authorityId: 'convos.org',
  typeId: 'thinking',
  versionMajor: 1,
  versionMinor: 0,
};

export const ContentTypeConvosJoinRequest: ContentTypeId = {
  authorityId: 'convos.org',
  typeId: 'join_request',
  versionMajor: 1,
  versionMinor: 0,
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_CONVOS_DISPLAY_NAME_CHARS = 50;

export function contentTypeMatches(value: unknown, expected: ContentTypeId): boolean {
  if (!value || typeof value !== 'object') return false;
  const ct = value as Record<string, unknown>;
  return (
    ct.authorityId === expected.authorityId &&
    ct.typeId === expected.typeId &&
    ct.versionMajor === expected.versionMajor &&
    ct.versionMinor === expected.versionMinor
  );
}

export function isConvosSilentContentType(value: unknown): boolean {
  return (
    contentTypeMatches(value, ContentTypeConvosTypingIndicator) ||
    contentTypeMatches(value, ContentTypeConvosThinking) ||
    contentTypeMatches(value, ContentTypeConvosProfileUpdate) ||
    contentTypeMatches(value, ContentTypeConvosProfileSnapshot)
  );
}

export function sanitizeConvosDisplayName(value?: string): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return undefined;
  return trimmed.length > MAX_CONVOS_DISPLAY_NAME_CHARS
    ? trimmed.slice(0, MAX_CONVOS_DISPLAY_NAME_CHARS)
    : trimmed;
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
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

function encodeVarint(value: number | bigint): Uint8Array {
  let v = typeof value === 'bigint' ? value : BigInt(value);
  const out: number[] = [];
  while (v >= 0x80n) {
    out.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  out.push(Number(v));
  return Uint8Array.from(out);
}

function encodeKey(fieldNumber: number, wireType: number): Uint8Array {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeLengthDelimited(fieldNumber: number, value: Uint8Array): Uint8Array {
  return concatBytes(encodeKey(fieldNumber, 2), encodeVarint(value.length), value);
}

function encodeStringField(fieldNumber: number, value?: string): Uint8Array | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return null;
  return encodeLengthDelimited(fieldNumber, encoder.encode(trimmed));
}

function encodeEnumField(fieldNumber: number, value?: number): Uint8Array | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return concatBytes(encodeKey(fieldNumber, 0), encodeVarint(value));
}

function readLengthDelimited(bytes: Uint8Array, offset: number): { value: Uint8Array; offset: number } {
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
        let value = 0n;
        for (let i = 0; i < 8; i++) {
          value |= BigInt(bytes[offset + i]) << BigInt(i * 8);
        }
        fields.push({ fieldNumber, wireType, value });
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

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

function parseEncryptedImage(raw: Uint8Array): ConvosEncryptedProfileImageRef | undefined {
  try {
    const fields = parseProtobufFields(raw);
    const urlField = fields.find((field) => field.fieldNumber === 1 && field.value instanceof Uint8Array);
    const saltField = fields.find((field) => field.fieldNumber === 2 && field.value instanceof Uint8Array);
    const nonceField = fields.find((field) => field.fieldNumber === 3 && field.value instanceof Uint8Array);
    const url = urlField?.value instanceof Uint8Array ? decoder.decode(urlField.value).trim() : '';
    if (!url) return undefined;
    return {
      url,
      salt: saltField?.value instanceof Uint8Array ? saltField.value : undefined,
      nonce: nonceField?.value instanceof Uint8Array ? nonceField.value : undefined,
    };
  } catch {
    return undefined;
  }
}

function encodeEncryptedImage(ref?: ConvosEncryptedProfileImageRef): Uint8Array | null {
  if (!ref?.url?.trim()) return null;
  const fields: Uint8Array[] = [];
  const url = encodeStringField(1, ref.url);
  if (!url) return null;
  fields.push(url);
  if (ref.salt?.length) fields.push(encodeLengthDelimited(2, ref.salt));
  if (ref.nonce?.length) fields.push(encodeLengthDelimited(3, ref.nonce));
  return concatBytes(...fields);
}

function parseMetadataValue(raw: Uint8Array): string | number | boolean | undefined {
  try {
    const fields = parseProtobufFields(raw);
    const stringValue = fields.find((field) => field.fieldNumber === 1 && field.value instanceof Uint8Array);
    if (stringValue?.value instanceof Uint8Array) {
      return decoder.decode(stringValue.value);
    }
    const numberValue = fields.find((field) => field.fieldNumber === 2 && typeof field.value === 'bigint');
    if (typeof numberValue?.value === 'bigint') {
      return Number(numberValue.value);
    }
    const boolValue = fields.find((field) => field.fieldNumber === 3 && typeof field.value === 'number');
    if (typeof boolValue?.value === 'number') {
      return boolValue.value !== 0;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function parseMetadataEntry(raw: Uint8Array): [string, string | number | boolean] | null {
  try {
    const fields = parseProtobufFields(raw);
    const key = fields.find((field) => field.fieldNumber === 1 && field.value instanceof Uint8Array);
    const value = fields.find((field) => field.fieldNumber === 2 && field.value instanceof Uint8Array);
    const keyText = key?.value instanceof Uint8Array ? decoder.decode(key.value).trim() : '';
    const valueParsed = value?.value instanceof Uint8Array ? parseMetadataValue(value.value) : undefined;
    if (!keyText || valueParsed === undefined) return null;
    return [keyText, valueParsed];
  } catch {
    return null;
  }
}

function parseMetadata(fields: ProtobufField[], fieldNumber: number): Record<string, string | number | boolean> | undefined {
  const entries = fields
    .filter((field) => field.fieldNumber === fieldNumber && field.value instanceof Uint8Array)
    .map((field) => (field.value instanceof Uint8Array ? parseMetadataEntry(field.value) : null))
    .filter((entry): entry is [string, string | number | boolean] => Boolean(entry));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function parseProfileUpdateBytes(bytes: Uint8Array): ConvosProfileUpdateContent {
  try {
    const fields = parseProtobufFields(bytes);
    const nameField = fields.find((field) => field.fieldNumber === 1 && field.value instanceof Uint8Array);
    const encryptedImageField = fields.find((field) => field.fieldNumber === 2 && field.value instanceof Uint8Array);
    const memberKindField = fields.find((field) => field.fieldNumber === 3 && typeof field.value === 'number');
    return {
      name: nameField?.value instanceof Uint8Array
        ? sanitizeConvosDisplayName(decoder.decode(nameField.value))
        : undefined,
      encryptedImage: encryptedImageField?.value instanceof Uint8Array
        ? parseEncryptedImage(encryptedImageField.value)
        : undefined,
      memberKind: typeof memberKindField?.value === 'number' ? memberKindField.value : undefined,
      metadata: parseMetadata(fields, 4),
    };
  } catch {
    return {};
  }
}

function encodeProfileUpdateBytes(content: ConvosProfileUpdateContent): Uint8Array {
  const fields: Uint8Array[] = [];
  const name = encodeStringField(1, sanitizeConvosDisplayName(content.name));
  if (name) fields.push(name);
  const encryptedImage = encodeEncryptedImage(content.encryptedImage);
  if (encryptedImage) fields.push(encodeLengthDelimited(2, encryptedImage));
  const memberKind = encodeEnumField(3, content.memberKind);
  if (memberKind) fields.push(memberKind);
  return fields.length ? concatBytes(...fields) : new Uint8Array();
}

function parseMemberProfile(raw: Uint8Array): ConvosMemberProfileContent | null {
  try {
    const fields = parseProtobufFields(raw);
    const inboxField = fields.find((field) => field.fieldNumber === 1 && field.value instanceof Uint8Array);
    if (!(inboxField?.value instanceof Uint8Array) || inboxField.value.length === 0) {
      return null;
    }
    const nameField = fields.find((field) => field.fieldNumber === 2 && field.value instanceof Uint8Array);
    const encryptedImageField = fields.find((field) => field.fieldNumber === 3 && field.value instanceof Uint8Array);
    const memberKindField = fields.find((field) => field.fieldNumber === 4 && typeof field.value === 'number');
    return {
      inboxId: bytesToHex(inboxField.value),
      name: nameField?.value instanceof Uint8Array
        ? sanitizeConvosDisplayName(decoder.decode(nameField.value))
        : undefined,
      encryptedImage: encryptedImageField?.value instanceof Uint8Array
        ? parseEncryptedImage(encryptedImageField.value)
        : undefined,
      memberKind: typeof memberKindField?.value === 'number' ? memberKindField.value : undefined,
      metadata: parseMetadata(fields, 5),
    };
  } catch {
    return null;
  }
}

function parseJsonContent<T>(encoded: EncodedContent, fallback: T): T {
  try {
    const raw = decoder.decode(encoded.content);
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export class ConvosProfileUpdateCodec implements ContentCodec<ConvosProfileUpdateContent> {
  contentType = ContentTypeConvosProfileUpdate;

  encode(content: ConvosProfileUpdateContent): EncodedContent {
    return {
      type: this.contentType,
      parameters: {},
      fallback: undefined,
      content: encodeProfileUpdateBytes(content),
    };
  }

  decode(encoded: EncodedContent): ConvosProfileUpdateContent {
    return parseProfileUpdateBytes(encoded.content);
  }

  fallback(): string | undefined {
    return undefined;
  }

  shouldPush(): boolean {
    return false;
  }
}

export class ConvosProfileSnapshotCodec implements ContentCodec<ConvosProfileSnapshotContent> {
  contentType = ContentTypeConvosProfileSnapshot;

  encode(content: ConvosProfileSnapshotContent): EncodedContent {
    const fields = (content.profiles ?? [])
      .map((profile) => {
        const inbox = profile.inboxId.trim().replace(/^0x/i, '').toLowerCase();
        if (!/^[0-9a-f]+$/.test(inbox) || inbox.length % 2 !== 0) return null;
        const inboxBytes = new Uint8Array(inbox.length / 2);
        for (let i = 0; i < inbox.length; i += 2) {
          inboxBytes[i / 2] = parseInt(inbox.slice(i, i + 2), 16);
        }
        const memberFields: Uint8Array[] = [encodeLengthDelimited(1, inboxBytes)];
        const name = encodeStringField(2, sanitizeConvosDisplayName(profile.name));
        if (name) memberFields.push(name);
        const encryptedImage = encodeEncryptedImage(profile.encryptedImage);
        if (encryptedImage) memberFields.push(encodeLengthDelimited(3, encryptedImage));
        const memberKind = encodeEnumField(4, profile.memberKind);
        if (memberKind) memberFields.push(memberKind);
        return encodeLengthDelimited(1, concatBytes(...memberFields));
      })
      .filter((value): value is Uint8Array => Boolean(value));

    return {
      type: this.contentType,
      parameters: {},
      fallback: undefined,
      content: fields.length ? concatBytes(...fields) : new Uint8Array(),
    };
  }

  decode(encoded: EncodedContent): ConvosProfileSnapshotContent {
    try {
      const fields = parseProtobufFields(encoded.content);
      const profiles = fields
        .filter((field) => field.fieldNumber === 1 && field.value instanceof Uint8Array)
        .map((field) => (field.value instanceof Uint8Array ? parseMemberProfile(field.value) : null))
        .filter((profile): profile is ConvosMemberProfileContent => Boolean(profile));
      return { profiles };
    } catch {
      return { profiles: [] };
    }
  }

  fallback(): string | undefined {
    return undefined;
  }

  shouldPush(): boolean {
    return false;
  }
}

export class ConvosTypingIndicatorCodec implements ContentCodec<ConvosTypingIndicatorContent> {
  contentType = ContentTypeConvosTypingIndicator;

  encode(content: ConvosTypingIndicatorContent): EncodedContent {
    return {
      type: this.contentType,
      parameters: {},
      fallback: undefined,
      content: encoder.encode(JSON.stringify({ isTyping: Boolean(content.isTyping) })),
    };
  }

  decode(encoded: EncodedContent): ConvosTypingIndicatorContent {
    const parsed = parseJsonContent<Record<string, unknown>>(encoded, {});
    return { isTyping: parsed.isTyping === true };
  }

  fallback(): string | undefined {
    return undefined;
  }

  shouldPush(): boolean {
    return false;
  }
}

export class ConvosJoinRequestCodec implements ContentCodec<ConvosJoinRequestContent> {
  contentType = ContentTypeConvosJoinRequest;

  encode(content: ConvosJoinRequestContent): EncodedContent {
    const inviteSlug = content.inviteSlug.trim();
    const payload: ConvosJoinRequestContent = {
      inviteSlug,
      profile: content.profile,
      metadata: content.metadata,
    };
    return {
      type: this.contentType,
      parameters: {},
      fallback: inviteSlug,
      content: encoder.encode(JSON.stringify(payload)),
    };
  }

  decode(encoded: EncodedContent): ConvosJoinRequestContent {
    const parsed = parseJsonContent<Record<string, unknown>>(encoded, {});
    const inviteSlug =
      typeof parsed.inviteSlug === 'string'
        ? parsed.inviteSlug.trim()
        : typeof encoded.fallback === 'string'
          ? encoded.fallback.trim()
          : '';
    const rawProfile = parsed.profile && typeof parsed.profile === 'object'
      ? parsed.profile as Record<string, unknown>
      : undefined;
    const profile = rawProfile
      ? {
          name: typeof rawProfile.name === 'string' ? sanitizeConvosDisplayName(rawProfile.name) : undefined,
          imageURL: typeof rawProfile.imageURL === 'string' ? rawProfile.imageURL.trim() || undefined : undefined,
          memberKind: typeof rawProfile.memberKind === 'string' ? rawProfile.memberKind.trim() || undefined : undefined,
        }
      : undefined;
    const metadata =
      parsed.metadata && typeof parsed.metadata === 'object'
        ? Object.fromEntries(
            Object.entries(parsed.metadata as Record<string, unknown>)
              .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
          )
        : undefined;

    return {
      inviteSlug,
      profile,
      metadata,
    };
  }

  fallback(content: ConvosJoinRequestContent): string | undefined {
    return content.inviteSlug.trim() || undefined;
  }

  shouldPush(): boolean {
    return true;
  }
}
