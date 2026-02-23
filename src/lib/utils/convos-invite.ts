import { Buffer } from 'buffer';
import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { hkdf } from '@noble/hashes/hkdf';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { etc as secpEtc, getPublicKey, sign, verify } from '@noble/secp256k1';
import { hashMessage, recoverPublicKey, hexToBytes } from 'viem';

export type ConvosInvitePayload = {
  conversationToken: string;
  creatorInboxId: string;
  tag?: string;
  name?: string;
  description?: string;
  imageUrl?: string;
  expiresAfterUse?: boolean;
  expiresAt?: Date;
  conversationExpiresAt?: Date;
};

export type ParsedConvosInvite = {
  inviteCode: string;
  payload: ConvosInvitePayload;
  payloadBytes: Uint8Array;
  signatureBytes: Uint8Array;
};

export type ConvosGroupMetadata = {
  description?: string;
  tag?: string;
  expiresAt?: Date;
  isEncoded?: boolean;
  isCompressed?: boolean;
  source?: 'description' | 'appData';
  profiles?: ConvosGroupProfile[];
  imageEncryptionKey?: Uint8Array;
  encryptedGroupImage?: ConvosEncryptedImageRef;
};

export type ConvosEncryptedImageRef = {
  url: string;
  salt?: Uint8Array;
  nonce?: Uint8Array;
};

export type ConvosGroupProfile = {
  inboxId: string;
  name?: string;
  imageUrl?: string;
  encryptedImageUrl?: string;
  encryptedImageSalt?: Uint8Array;
  encryptedImageNonce?: Uint8Array;
};

type ProtobufField = {
  fieldNumber: number;
  wireType: number;
  value: number | bigint | Uint8Array;
};

const BASE64URL_CLEAN_RE = /[^A-Za-z0-9_-]/g;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const INVITE_TOKEN_VERSION = 1;
const INVITE_TOKEN_SALT = new TextEncoder().encode('ConvosInviteV1');
const CONVERSATION_TOKEN_MIN_BYTES = 1 + 12 + 3 + 16;
const CONVOS_METADATA_COMPRESSED_MARKER = 0x1f;
const CONVOS_METADATA_MAX_DECOMPRESSED_BYTES = 10 * 1024 * 1024; // 10MB guardrail against decompression bombs
const CONVOS_METADATA_COMPRESSION_THRESHOLD = 100; // Mirrors Convos iOS threshold
const CONVOS_PROFILE_MAX_DISPLAY_NAME = 50; // Matches Convos NameLimits.maxDisplayNameLength

if (!secpEtc.hmacSha256Sync) {
  secpEtc.hmacSha256Sync = (key, ...msgs) => hmac(sha256, key, concatBytes(...msgs));
}

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

function isBase64Url(input: string): boolean {
  return Boolean(input) && BASE64URL_RE.test(input);
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

function encodeStringField(fieldNumber: number, value: string | undefined): Uint8Array | null {
  if (!value) return null;
  const bytes = new TextEncoder().encode(value);
  return encodeLengthDelimited(fieldNumber, bytes);
}

function encodeBoolField(fieldNumber: number, value: boolean | undefined): Uint8Array | null {
  if (!value) return null;
  return concatBytes(encodeKey(fieldNumber, 0), encodeVarint(value ? 1 : 0));
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
        let value = 0n;
        for (let i = 0; i < 8; i++) {
          value |= BigInt(bytes[offset + i]) << BigInt(i * 8);
        }
        if (value & (1n << 63n)) {
          value -= 1n << 64n;
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

function encodeTimestamp(date: Date): Uint8Array {
  const ms = date.getTime();
  const seconds = Math.floor(ms / 1000);
  const nanos = Math.max(0, Math.floor((ms - seconds * 1000) * 1_000_000));
  const secondsField = concatBytes(encodeKey(1, 0), encodeVarint(BigInt(seconds)));
  const nanosField = concatBytes(encodeKey(2, 0), encodeVarint(nanos));
  return concatBytes(secondsField, nanosField);
}

function parseTimestamp(bytes: Uint8Array): Date | undefined {
  try {
    const fields = parseProtobufFields(bytes);
    let seconds = 0;
    let nanos = 0;
    for (const field of fields) {
      if (field.fieldNumber === 1 && field.wireType === 0 && typeof field.value === 'number') {
        seconds = field.value;
      } else if (field.fieldNumber === 2 && field.wireType === 0 && typeof field.value === 'number') {
        nanos = field.value;
      }
    }
    if (!seconds && !nanos) return undefined;
    return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000));
  } catch {
    return undefined;
  }
}

function toUint8Array(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function encodeSFixed64Field(fieldNumber: number, value: number): Uint8Array {
  let big = BigInt(Math.trunc(value));
  if (big < 0) {
    big = (1n << 64n) + big;
  }
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    bytes[i] = Number((big >> BigInt(i * 8)) & 0xffn);
  }
  return concatBytes(encodeKey(fieldNumber, 1), bytes);
}

function uint32FromBigEndian(bytes: Uint8Array): number {
  return (
    (bytes[0] << 24) |
    (bytes[1] << 16) |
    (bytes[2] << 8) |
    bytes[3]
  ) >>> 0;
}

function uint32ToBigEndian(value: number): Uint8Array {
  return Uint8Array.from([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

async function transformBytes(
  input: Uint8Array,
  transformer: { writable: WritableStream<BufferSource>; readable: ReadableStream<Uint8Array> },
): Promise<Uint8Array | null> {
  try {
    const writer = transformer.writable.getWriter();
    await writer.write(input as unknown as BufferSource);
    await writer.close();
    const transformedBuffer = await new Response(transformer.readable).arrayBuffer();
    return new Uint8Array(transformedBuffer);
  } catch {
    return null;
  }
}

async function compressConvosMetadataPayload(payload: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') {
    return null;
  }

  if (payload.length > 0xffffffff) {
    return null;
  }

  const compressed = await transformBytes(payload, new CompressionStream('deflate'));
  if (!compressed?.length) {
    return null;
  }

  return concatBytes(
    Uint8Array.from([CONVOS_METADATA_COMPRESSED_MARKER]),
    uint32ToBigEndian(payload.length),
    compressed,
  );
}

async function decompressConvosMetadataPayload(data: Uint8Array): Promise<Uint8Array | null> {
  if (data.length < 5 || data[0] !== CONVOS_METADATA_COMPRESSED_MARKER) {
    return null;
  }

  if (typeof DecompressionStream === 'undefined') {
    return null;
  }

  const expectedSize = uint32FromBigEndian(data.slice(1, 5));
  if (
    expectedSize <= 0 ||
    expectedSize > CONVOS_METADATA_MAX_DECOMPRESSED_BYTES
  ) {
    return null;
  }

  const compressedPayload = data.slice(5);
  if (!compressedPayload.length) {
    return null;
  }

  const decompressed = await transformBytes(compressedPayload, new DecompressionStream('deflate'));
  if (!decompressed || decompressed.length !== expectedSize) {
    return null;
  }

  return decompressed;
}

function decodeHex(value: string): Uint8Array | null {
  const normalized = value.trim().replace(/^0x/i, '').toLowerCase();
  if (!normalized || normalized.length % 2 !== 0 || !/^[0-9a-f]+$/.test(normalized)) {
    return null;
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    out[i / 2] = parseInt(normalized.slice(i, i + 2), 16);
  }
  return out;
}

function parseConvosEncryptedImageRef(raw: Uint8Array): ConvosEncryptedImageRef | undefined {
  try {
    const fields = parseProtobufFields(raw);
    const url = fields.find((f) => f.fieldNumber === 1 && f.wireType === 2 && f.value instanceof Uint8Array);
    const salt = fields.find((f) => f.fieldNumber === 2 && f.wireType === 2 && f.value instanceof Uint8Array);
    const nonce = fields.find((f) => f.fieldNumber === 3 && f.wireType === 2 && f.value instanceof Uint8Array);
    const decodedUrl = url && url.value instanceof Uint8Array ? decodeUtf8(url.value)?.trim() ?? '' : '';
    if (!decodedUrl) return undefined;
    return {
      url: decodedUrl,
      salt: salt && salt.value instanceof Uint8Array ? toUint8Array(salt.value) : undefined,
      nonce: nonce && nonce.value instanceof Uint8Array ? toUint8Array(nonce.value) : undefined,
    };
  } catch {
    return undefined;
  }
}

function encodeConvosEncryptedImageRef(ref?: ConvosEncryptedImageRef): Uint8Array | null {
  if (!ref?.url?.trim()) return null;
  const fields: Uint8Array[] = [];
  const urlField = encodeStringField(1, ref.url.trim());
  if (!urlField) return null;
  fields.push(urlField);
  if (ref.salt?.length) fields.push(encodeLengthDelimited(2, ref.salt));
  if (ref.nonce?.length) fields.push(encodeLengthDelimited(3, ref.nonce));
  return concatBytes(...fields);
}

function parseConvosProfile(raw: Uint8Array): ConvosGroupProfile | null {
  try {
    const fields = parseProtobufFields(raw);
    const inboxField = fields.find((f) => f.fieldNumber === 1 && f.wireType === 2 && f.value instanceof Uint8Array);
    if (!inboxField || !(inboxField.value instanceof Uint8Array) || !inboxField.value.length) {
      return null;
    }

    const inboxId = bytesToHex(inboxField.value);
    if (!inboxId) {
      return null;
    }

    const nameField = fields.find((f) => f.fieldNumber === 2 && f.wireType === 2 && f.value instanceof Uint8Array);
    const imageField = fields.find((f) => f.fieldNumber === 3 && f.wireType === 2 && f.value instanceof Uint8Array);
    const encryptedImageField = fields.find(
      (f) => f.fieldNumber === 4 && f.wireType === 2 && f.value instanceof Uint8Array,
    );
    const encryptedImage = encryptedImageField && encryptedImageField.value instanceof Uint8Array
      ? parseConvosEncryptedImageRef(encryptedImageField.value)
      : undefined;

    return {
      inboxId,
      name: nameField && nameField.value instanceof Uint8Array ? decodeUtf8(nameField.value)?.trim() || undefined : undefined,
      imageUrl: imageField && imageField.value instanceof Uint8Array ? decodeUtf8(imageField.value)?.trim() || undefined : undefined,
      encryptedImageUrl: encryptedImage?.url,
      encryptedImageSalt: encryptedImage?.salt,
      encryptedImageNonce: encryptedImage?.nonce,
    };
  } catch {
    return null;
  }
}

function encodeConvosProfile(profile: ConvosGroupProfile): Uint8Array | null {
  const inboxBytes = decodeHex(profile.inboxId);
  if (!inboxBytes?.length) {
    return null;
  }

  const fields: Uint8Array[] = [encodeLengthDelimited(1, inboxBytes)];
  const trimmedName = sanitizeConvosProfileDisplayName(profile.name);
  const nameField = encodeStringField(2, trimmedName);
  if (nameField) fields.push(nameField);

  const imageUrl = typeof profile.imageUrl === 'string' ? profile.imageUrl.trim() : '';
  const imageField = encodeStringField(3, imageUrl || undefined);
  if (imageField) fields.push(imageField);

  const encryptedImage = encodeConvosEncryptedImageRef(
    profile.encryptedImageUrl
      ? {
          url: profile.encryptedImageUrl,
          salt: profile.encryptedImageSalt,
          nonce: profile.encryptedImageNonce,
        }
      : undefined,
  );
  if (encryptedImage) {
    fields.push(encodeLengthDelimited(4, encryptedImage));
  }

  return concatBytes(...fields);
}

export function sanitizeConvosProfileDisplayName(value?: string): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return undefined;
  return trimmed.length > CONVOS_PROFILE_MAX_DISPLAY_NAME
    ? trimmed.slice(0, CONVOS_PROFILE_MAX_DISPLAY_NAME)
    : trimmed;
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

function packConversationId(conversationId: string): Uint8Array {
  const trimmed = conversationId.trim();
  if (!trimmed) {
    throw new Error('Conversation ID cannot be empty');
  }

  const uuidHex = trimmed.replace(/-/g, '').toLowerCase();
  if (/^[0-9a-f]{32}$/.test(uuidHex)) {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      bytes[i] = parseInt(uuidHex.slice(i * 2, i * 2 + 2), 16);
    }
    return concatBytes(Uint8Array.from([0x01]), bytes);
  }

  const utf8 = new TextEncoder().encode(trimmed);
  if (utf8.length > 65535) {
    throw new Error(`Conversation ID too long: ${utf8.length}`);
  }

  const lengthBytes = utf8.length <= 255
    ? Uint8Array.from([utf8.length])
    : Uint8Array.from([0, (utf8.length >> 8) & 0xff, utf8.length & 0xff]);

  return concatBytes(Uint8Array.from([0x02]), lengthBytes, utf8);
}

function unpackConversationId(bytes: Uint8Array): string {
  if (!bytes.length) {
    throw new Error('Conversation ID cannot be empty');
  }
  const tag = bytes[0];
  if (tag === 0x01) {
    if (bytes.length < 17) {
      throw new Error('Conversation UUID payload too short');
    }
    const uuidBytes = bytes.slice(1, 17);
    const hex = bytesToHex(uuidBytes);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  if (tag === 0x02) {
    if (bytes.length < 3) {
      throw new Error('Conversation string payload too short');
    }
    let offset = 1;
    let length = bytes[offset];
    offset += 1;
    if (length === 0) {
      if (bytes.length < offset + 2) {
        throw new Error('Conversation string length missing');
      }
      length = (bytes[offset] << 8) | bytes[offset + 1];
      offset += 2;
    }
    if (!length) {
      throw new Error('Conversation ID cannot be empty');
    }
    if (bytes.length < offset + length) {
      throw new Error('Conversation string payload truncated');
    }
    const value = bytes.slice(offset, offset + length);
    const decoded = decodeUtf8(value);
    if (!decoded) {
      throw new Error('Conversation ID is not valid UTF-8');
    }
    return decoded;
  }
  throw new Error(`Unknown conversation token type: ${tag}`);
}

function deriveInviteKey(privateKeyBytes: Uint8Array, creatorInboxId: string): Uint8Array {
  const info = new TextEncoder().encode(`inbox:${creatorInboxId}`);
  return hkdf(sha256, privateKeyBytes, INVITE_TOKEN_SALT, info, 32);
}

export function createConversationToken(
  conversationId: string,
  creatorInboxId: string,
  privateKeyBytes: Uint8Array,
): string {
  const key = deriveInviteKey(privateKeyBytes, creatorInboxId);
  const aad = new TextEncoder().encode(creatorInboxId);
  const plaintext = packConversationId(conversationId);

  const nonce = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(nonce);
  } else {
    throw new Error('Secure random generator unavailable');
  }

  const cipher = chacha20poly1305(key, nonce, aad);
  const sealed = cipher.encrypt(plaintext);
  const combined = concatBytes(nonce, sealed);
  const out = concatBytes(Uint8Array.from([INVITE_TOKEN_VERSION]), combined);
  return toBase64Url(out);
}

export function decodeConversationToken(
  conversationToken: string,
  creatorInboxId: string,
  privateKeyBytes: Uint8Array,
): string {
  const data = fromBase64Url(conversationToken);
  if (data.length < CONVERSATION_TOKEN_MIN_BYTES) {
    throw new Error('Conversation token is too short');
  }
  const version = data[0];
  if (version !== INVITE_TOKEN_VERSION) {
    throw new Error(`Unsupported invite token version: ${version}`);
  }
  const nonce = data.slice(1, 13);
  const ciphertext = data.slice(13);
  const key = deriveInviteKey(privateKeyBytes, creatorInboxId);
  const aad = new TextEncoder().encode(creatorInboxId);
  const cipher = chacha20poly1305(key, nonce, aad);
  const plaintext = cipher.decrypt(ciphertext);
  return unpackConversationId(plaintext);
}

function encodeInvitePayload(payload: ConvosInvitePayload): Uint8Array {
  const fields: Uint8Array[] = [];
  const conversationTokenField = encodeStringField(1, payload.conversationToken);
  const creatorField = encodeStringField(2, payload.creatorInboxId);
  if (!conversationTokenField || !creatorField) {
    throw new Error('Invite payload requires conversation token and creator inbox ID');
  }
  fields.push(conversationTokenField, creatorField);
  const tagField = encodeStringField(3, payload.tag);
  if (tagField) fields.push(tagField);
  const nameField = encodeStringField(4, payload.name);
  if (nameField) fields.push(nameField);
  const descriptionField = encodeStringField(5, payload.description);
  if (descriptionField) fields.push(descriptionField);
  const imageField = encodeStringField(6, payload.imageUrl);
  if (imageField) fields.push(imageField);
  if (payload.conversationExpiresAt) {
    const tsBytes = encodeTimestamp(payload.conversationExpiresAt);
    fields.push(encodeLengthDelimited(7, tsBytes));
  }
  if (payload.expiresAt) {
    const tsBytes = encodeTimestamp(payload.expiresAt);
    fields.push(encodeLengthDelimited(8, tsBytes));
  }
  const expiresAfterUseField = encodeBoolField(9, payload.expiresAfterUse);
  if (expiresAfterUseField) fields.push(expiresAfterUseField);
  return concatBytes(...fields);
}

function encodeSignedInvite(payloadBytes: Uint8Array, signatureBytes: Uint8Array): Uint8Array {
  const payloadField = encodeLengthDelimited(1, payloadBytes);
  const signatureField = encodeLengthDelimited(2, signatureBytes);
  return concatBytes(payloadField, signatureField);
}

export function signInvitePayload(payloadBytes: Uint8Array, privateKeyBytes: Uint8Array): Uint8Array {
  const hash = sha256(payloadBytes);
  const signature = sign(hash, privateKeyBytes, { lowS: true });
  const compact = signature.toCompactRawBytes();
  const recovery = signature.recovery ?? 0;
  return concatBytes(compact, Uint8Array.from([recovery]));
}

export function verifyInviteSignature(
  payloadBytes: Uint8Array,
  signatureBytes: Uint8Array,
  expectedPublicKey: Uint8Array,
): boolean {
  if (signatureBytes.length < 64) {
    return false;
  }
  const hash = sha256(payloadBytes);
  const compact = signatureBytes.slice(0, 64);
  try {
    return verify(compact, hash, expectedPublicKey, { lowS: false });
  } catch {
    return false;
  }
}

export function createConvosInvite(params: {
  conversationId: string;
  creatorInboxId: string;
  privateKeyBytes: Uint8Array;
  tag: string;
  name?: string;
  description?: string;
  imageUrl?: string;
  expiresAfterUse?: boolean;
  expiresAt?: Date;
  conversationExpiresAt?: Date;
}): { inviteCode: string; payload: ConvosInvitePayload; payloadBytes: Uint8Array; signatureBytes: Uint8Array } {
  const conversationToken = createConversationToken(
    params.conversationId,
    params.creatorInboxId,
    params.privateKeyBytes,
  );

  const payload: ConvosInvitePayload = {
    conversationToken,
    creatorInboxId: params.creatorInboxId,
    tag: params.tag,
    name: params.name,
    description: params.description,
    imageUrl: params.imageUrl,
    expiresAfterUse: params.expiresAfterUse,
    expiresAt: params.expiresAt,
    conversationExpiresAt: params.conversationExpiresAt,
  };

  const payloadBytes = encodeInvitePayload(payload);
  const signatureBytes = signInvitePayload(payloadBytes, params.privateKeyBytes);
  const signedBytes = encodeSignedInvite(payloadBytes, signatureBytes);

  return {
    inviteCode: toBase64Url(signedBytes),
    payload,
    payloadBytes,
    signatureBytes,
  };
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

export function isLikelyConvosInviteCode(input: string): boolean {
  const extracted = extractConvosInviteCode(input);
  if (!extracted) return false;
  const sanitized = sanitizeConvosInviteCode(extracted);
  if (!sanitized || sanitized.length < 40) return false;
  return isBase64Url(sanitized);
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
  const signatureField = signedInviteFields.find(
    (field) => field.fieldNumber === 2 && field.wireType === 2,
  );

  if (!payloadField || !(payloadField.value instanceof Uint8Array)) {
    throw new Error('Invite payload missing or malformed.');
  }
  if (!signatureField || !(signatureField.value instanceof Uint8Array)) {
    throw new Error('Invite signature missing or malformed.');
  }

  const payloadBytes = payloadField.value;
  const signatureBytes = signatureField.value;
  const payloadFields = parseProtobufFields(payloadBytes);
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

  payload.conversationToken = getStringField(1) ?? '';
  payload.tag = getStringField(3);
  payload.name = getStringField(4);
  payload.description = getStringField(5);
  payload.imageUrl = getStringField(6);

  const conversationExpiresField = payloadFields.find(
    (candidate) => candidate.fieldNumber === 7 && candidate.wireType === 2,
  );
  if (conversationExpiresField && conversationExpiresField.value instanceof Uint8Array) {
    payload.conversationExpiresAt = parseTimestamp(conversationExpiresField.value);
  }

  const expiresField = payloadFields.find(
    (candidate) => candidate.fieldNumber === 8 && candidate.wireType === 2,
  );
  if (expiresField && expiresField.value instanceof Uint8Array) {
    payload.expiresAt = parseTimestamp(expiresField.value);
  }

  const expiresAfterUseField = payloadFields.find(
    (candidate) => candidate.fieldNumber === 9 && candidate.wireType === 0,
  );
  if (expiresAfterUseField && typeof expiresAfterUseField.value === 'number') {
    payload.expiresAfterUse = Boolean(expiresAfterUseField.value);
  }

  if (!payload.conversationToken) {
    throw new Error('Invite payload missing conversation token.');
  }

  return {
    inviteCode,
    payload: payload as ConvosInvitePayload,
    payloadBytes,
    signatureBytes,
  };
}

export function tryParseConvosInvite(input: string): ParsedConvosInvite | null {
  try {
    return parseConvosInvite(input);
  } catch {
    return null;
  }
}

export async function parseConvosGroupAppData(raw: string | null | undefined): Promise<ConvosGroupMetadata> {
  if (!raw) {
    return {
      tag: undefined,
      expiresAt: undefined,
      isEncoded: false,
      isCompressed: false,
      source: 'appData',
      profiles: [],
    };
  }

  const trimmed = raw.trim();
  if (!trimmed || !isBase64Url(trimmed)) {
    return {
      tag: undefined,
      expiresAt: undefined,
      isEncoded: false,
      isCompressed: false,
      source: 'appData',
      profiles: [],
    };
  }

  let decoded: Uint8Array;
  try {
    decoded = fromBase64Url(trimmed);
  } catch {
    return {
      tag: undefined,
      expiresAt: undefined,
      isEncoded: false,
      isCompressed: false,
      source: 'appData',
      profiles: [],
    };
  }

  let payload = decoded;
  let isCompressed = false;
  if (payload[0] === CONVOS_METADATA_COMPRESSED_MARKER) {
    isCompressed = true;
    const decompressed = await decompressConvosMetadataPayload(payload);
    if (!decompressed) {
      return {
        tag: undefined,
        expiresAt: undefined,
        isEncoded: false,
        isCompressed: true,
        source: 'appData',
        profiles: [],
      };
    }
    payload = decompressed;
  }

  try {
    const fields = parseProtobufFields(payload);
    const tagField = fields.find((candidate) => candidate.fieldNumber === 1 && candidate.wireType === 2);
    const expiresField = fields.find((candidate) => candidate.fieldNumber === 3 && candidate.wireType === 1);
    const imageKeyField = fields.find((candidate) => candidate.fieldNumber === 4 && candidate.wireType === 2);
    const encryptedGroupImageField = fields.find(
      (candidate) => candidate.fieldNumber === 5 && candidate.wireType === 2,
    );

    const profiles = fields
      .filter((candidate) => candidate.fieldNumber === 2 && candidate.wireType === 2)
      .map((candidate) =>
        candidate.value instanceof Uint8Array
          ? parseConvosProfile(candidate.value)
          : null,
      )
      .filter((candidate): candidate is ConvosGroupProfile => Boolean(candidate));

    let expiresAt: Date | undefined;
    if (expiresField && typeof expiresField.value === 'bigint') {
      const expiresSeconds = Number(expiresField.value);
      if (Number.isFinite(expiresSeconds) && expiresSeconds > 0) {
        expiresAt = new Date(expiresSeconds * 1000);
      }
    }

    const encryptedGroupImage =
      encryptedGroupImageField && encryptedGroupImageField.value instanceof Uint8Array
        ? parseConvosEncryptedImageRef(encryptedGroupImageField.value)
        : undefined;

    return {
      tag:
        tagField && tagField.value instanceof Uint8Array
          ? decodeUtf8(tagField.value)?.trim() || undefined
          : undefined,
      expiresAt,
      isEncoded: true,
      isCompressed,
      source: 'appData',
      profiles,
      imageEncryptionKey:
        imageKeyField && imageKeyField.value instanceof Uint8Array
          ? toUint8Array(imageKeyField.value)
          : undefined,
      encryptedGroupImage,
    };
  } catch {
    return {
      tag: undefined,
      expiresAt: undefined,
      isEncoded: false,
      isCompressed,
      source: 'appData',
      profiles: [],
    };
  }
}

export async function encodeConvosGroupAppData(metadata: ConvosGroupMetadata): Promise<string> {
  const fields: Uint8Array[] = [];

  const tagField = encodeStringField(1, metadata.tag?.trim() || undefined);
  if (tagField) fields.push(tagField);

  for (const profile of metadata.profiles ?? []) {
    const encoded = encodeConvosProfile(profile);
    if (encoded) {
      fields.push(encodeLengthDelimited(2, encoded));
    }
  }

  if (metadata.expiresAt) {
    const seconds = Math.floor(metadata.expiresAt.getTime() / 1000);
    if (Number.isFinite(seconds) && seconds > 0) {
      fields.push(encodeSFixed64Field(3, seconds));
    }
  }

  if (metadata.imageEncryptionKey?.length) {
    fields.push(encodeLengthDelimited(4, metadata.imageEncryptionKey));
  }

  const encryptedGroupImage = encodeConvosEncryptedImageRef(metadata.encryptedGroupImage);
  if (encryptedGroupImage) {
    fields.push(encodeLengthDelimited(5, encryptedGroupImage));
  }

  const payload = fields.length ? concatBytes(...fields) : new Uint8Array();
  if (payload.length > CONVOS_METADATA_COMPRESSION_THRESHOLD) {
    const compressed = await compressConvosMetadataPayload(payload);
    if (compressed && compressed.length < payload.length) {
      return toBase64Url(compressed);
    }
  }

  return toBase64Url(payload);
}

export function upsertConvosGroupProfile(
  profiles: ConvosGroupProfile[] | undefined,
  profile: ConvosGroupProfile,
): ConvosGroupProfile[] {
  const sanitizedInboxId = profile.inboxId.trim().replace(/^0x/i, '').toLowerCase();
  if (!sanitizedInboxId) {
    return Array.isArray(profiles) ? [...profiles] : [];
  }

  const nextProfile: ConvosGroupProfile = {
    inboxId: sanitizedInboxId,
    name: sanitizeConvosProfileDisplayName(profile.name),
    imageUrl: typeof profile.imageUrl === 'string' && profile.imageUrl.trim() ? profile.imageUrl.trim() : undefined,
    encryptedImageUrl:
      typeof profile.encryptedImageUrl === 'string' && profile.encryptedImageUrl.trim()
        ? profile.encryptedImageUrl.trim()
        : undefined,
    encryptedImageSalt: profile.encryptedImageSalt,
    encryptedImageNonce: profile.encryptedImageNonce,
  };

  const existing = Array.isArray(profiles) ? profiles : [];
  const index = existing.findIndex(
    (candidate) => candidate.inboxId.trim().replace(/^0x/i, '').toLowerCase() === sanitizedInboxId,
  );

  if (index < 0) {
    return [...existing, nextProfile];
  }

  const out = [...existing];
  out[index] = nextProfile;
  return out;
}

export function parseConvosGroupMetadata(raw: string | null | undefined): ConvosGroupMetadata {
  if (!raw) {
    return {
      description: undefined,
      tag: undefined,
      expiresAt: undefined,
      isEncoded: false,
      source: 'description',
    };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      description: '',
      tag: undefined,
      expiresAt: undefined,
      isEncoded: false,
      source: 'description',
    };
  }
  if (!isBase64Url(trimmed)) {
    return {
      description: trimmed,
      tag: undefined,
      expiresAt: undefined,
      isEncoded: false,
      source: 'description',
    };
  }

  let decoded: Uint8Array;
  try {
    decoded = fromBase64Url(trimmed);
  } catch {
    return {
      description: trimmed,
      tag: undefined,
      expiresAt: undefined,
      isEncoded: false,
      source: 'description',
    };
  }

  if (decoded[0] === CONVOS_METADATA_COMPRESSED_MARKER) {
    return {
      description: trimmed,
      tag: undefined,
      expiresAt: undefined,
      isEncoded: true,
      isCompressed: true,
      source: 'description',
    };
  }

  try {
    const fields = parseProtobufFields(decoded);
    const descriptionField = fields.find(
      (candidate) => candidate.fieldNumber === 1 && candidate.wireType === 2,
    );
    const tagField = fields.find((candidate) => candidate.fieldNumber === 2 && candidate.wireType === 2);
    const expiresField = fields.find((candidate) => candidate.fieldNumber === 4 && candidate.wireType === 2);

    const description = descriptionField && descriptionField.value instanceof Uint8Array
      ? decodeUtf8(descriptionField.value) ?? ''
      : '';
    const tag = tagField && tagField.value instanceof Uint8Array
      ? decodeUtf8(tagField.value) ?? undefined
      : undefined;
    const expiresAt = expiresField && expiresField.value instanceof Uint8Array
      ? parseTimestamp(expiresField.value)
      : undefined;

    return {
      description,
      tag,
      expiresAt,
      isEncoded: true,
      source: 'description',
    };
  } catch {
    return {
      description: trimmed,
      tag: undefined,
      expiresAt: undefined,
      isEncoded: false,
      source: 'description',
    };
  }
}

export function encodeConvosGroupMetadata(metadata: ConvosGroupMetadata): string {
  const fields: Uint8Array[] = [];
  const descriptionField = encodeStringField(1, metadata.description ?? '');
  if (descriptionField) fields.push(descriptionField);
  const tagField = encodeStringField(2, metadata.tag);
  if (tagField) fields.push(tagField);
  if (metadata.expiresAt) {
    fields.push(encodeLengthDelimited(4, encodeTimestamp(metadata.expiresAt)));
  }
  const payload = fields.length ? concatBytes(...fields) : new Uint8Array();
  return toBase64Url(payload);
}

export function generateConvosInviteTag(length = 10): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    throw new Error('Secure random generator unavailable');
  }
  let out = '';
  for (const byte of bytes) {
    out += alphabet[byte % alphabet.length];
  }
  return out;
}

export function derivePublicKey(privateKeyBytes: Uint8Array): Uint8Array {
  return getPublicKey(privateKeyBytes, false);
}

export async function deriveInvitePrivateKeyFromSignature(
  signatureBytes: Uint8Array,
  message: string
): Promise<Uint8Array> {
  try {
    const hash = hashMessage(message);
    const recovered = await recoverPublicKey({ hash, signature: signatureBytes });
    const publicKeyBytes = hexToBytes(recovered);
    return secpEtc.hashToPrivateKey(publicKeyBytes);
  } catch (error) {
    if (signatureBytes.length < 40) {
      throw new Error('Signature is too short for invite key derivation');
    }
    return secpEtc.hashToPrivateKey(signatureBytes);
  }
}
