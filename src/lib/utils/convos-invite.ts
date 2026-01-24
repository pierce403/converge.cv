import { Buffer } from 'buffer';
import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { hkdf } from '@noble/hashes/hkdf';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { etc as secpEtc, getPublicKey, sign, verify } from '@noble/secp256k1';

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
};

type ProtobufField = {
  fieldNumber: number;
  wireType: number;
  value: number | Uint8Array;
};

const BASE64URL_CLEAN_RE = /[^A-Za-z0-9_-]/g;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const INVITE_TOKEN_VERSION = 1;
const INVITE_TOKEN_SALT = new TextEncoder().encode('ConvosInviteV1');
const CONVERSATION_TOKEN_MIN_BYTES = 1 + 12 + 3 + 16;
const CONVOS_METADATA_COMPRESSED_MARKER = 0x1f;

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

export function parseConvosGroupMetadata(raw: string | null | undefined): ConvosGroupMetadata {
  if (!raw) {
    return { description: undefined, tag: undefined, expiresAt: undefined, isEncoded: false };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { description: '', tag: undefined, expiresAt: undefined, isEncoded: false };
  }
  if (!isBase64Url(trimmed)) {
    return { description: trimmed, tag: undefined, expiresAt: undefined, isEncoded: false };
  }

  let decoded: Uint8Array;
  try {
    decoded = fromBase64Url(trimmed);
  } catch {
    return { description: trimmed, tag: undefined, expiresAt: undefined, isEncoded: false };
  }

  if (decoded[0] === CONVOS_METADATA_COMPRESSED_MARKER) {
    return { description: trimmed, tag: undefined, expiresAt: undefined, isEncoded: true };
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
    };
  } catch {
    return { description: trimmed, tag: undefined, expiresAt: undefined, isEncoded: false };
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

export function deriveInvitePrivateKeyFromSignature(signatureBytes: Uint8Array): Uint8Array {
  if (signatureBytes.length < 40) {
    throw new Error('Signature is too short for invite key derivation');
  }
  return secpEtc.hashToPrivateKey(signatureBytes);
}
