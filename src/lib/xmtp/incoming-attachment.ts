import {
  decryptAttachment,
  type Attachment,
  type RemoteAttachment,
} from '@xmtp/browser-sdk';

export const MAX_INCOMING_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_CONCURRENT_INCOMING_ATTACHMENTS = 2;
export const DEFAULT_INCOMING_ATTACHMENT_TIMEOUT_MS = 15_000;
export const MAX_INCOMING_IMAGE_DIMENSION = 8_192;
export const MAX_INCOMING_IMAGE_PIXELS = 32_000_000;

export const ALLOWED_INCOMING_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedIncomingImageMimeType =
  (typeof ALLOWED_INCOMING_IMAGE_MIME_TYPES)[number];

export type TrustedAttachmentHostKind =
  | 'converge'
  | 'convos'
  | 'thirdweb'
  | 'ipfs'
  | 'untrusted';

type KnownTrustedAttachmentHostKind = Exclude<TrustedAttachmentHostKind, 'untrusted'>;

export type TrustedAttachmentHostConfig = Partial<
  Record<KnownTrustedAttachmentHostKind, readonly string[]>
>;

export const DEFAULT_TRUSTED_ATTACHMENT_HOSTS: Readonly<
  Record<KnownTrustedAttachmentHostKind, readonly string[]>
> = Object.freeze({
  converge: Object.freeze(['converge.cv']),
  convos: Object.freeze(['convos.org', 'convos.app', 'convos.xyz']),
  thirdweb: Object.freeze(['ipfscdn.io', 'thirdwebcdn.com']),
  ipfs: Object.freeze(['ipfs.io', 'dweb.link', 'w3s.link', 'nftstorage.link']),
});

type FetchAttachment = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type DecryptRemoteAttachment = (
  payload: Uint8Array,
  remoteAttachment: RemoteAttachment,
) => Promise<Attachment>;

export interface FetchIncomingAttachmentOptions {
  fetchFn?: FetchAttachment;
  decryptFn?: DecryptRemoteAttachment;
  authorize?: () => Promise<void>;
  timeoutMs?: number;
  maxBytes?: number;
}

const ALLOWED_MIME_TYPES = new Set<string>(ALLOWED_INCOMING_IMAGE_MIME_TYPES);
const ACTIVE_CONTENT_MIME_TYPES = new Set([
  'image/svg+xml',
  'text/html',
  'application/xhtml+xml',
]);
const LOCAL_HOSTNAME_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.intranet',
  '.lan',
  '.home',
  '.home.arpa',
  '.corp',
] as const;

let activeIncomingAttachmentCount = 0;
const incomingAttachmentWaiters: Array<() => void> = [];

function normalizeHostnameRule(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\*\./, '')
    .replace(/^\./, '')
    .replace(/\.$/, '');
}

function hostnameMatchesRule(hostname: string, rule: string): boolean {
  const normalizedRule = normalizeHostnameRule(rule);
  return Boolean(
    normalizedRule &&
      (hostname === normalizedRule || hostname.endsWith(`.${normalizedRule}`)),
  );
}

function isIpv4Address(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

function parseIpv4Address(hostname: string): number[] | null {
  if (!isIpv4Address(hostname)) return null;
  const octets = hostname.split('.').map(Number);
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : null;
}

function isNonPublicIpv4(octets: readonly number[]): boolean {
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function parseIpv6Address(hostname: string): number[] | null {
  const raw = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (!raw.includes(':') || raw.includes('%')) return null;

  const doubleColonIndex = raw.indexOf('::');
  if (doubleColonIndex !== -1 && raw.indexOf('::', doubleColonIndex + 1) !== -1) {
    return null;
  }

  const parseParts = (value: string): number[] | null => {
    if (!value) return [];
    const parts = value.split(':');
    const output: number[] = [];
    for (const part of parts) {
      if (!part) return null;
      if (part.includes('.')) {
        const ipv4 = parseIpv4Address(part);
        if (!ipv4) return null;
        output.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
      output.push(Number.parseInt(part, 16));
    }
    return output;
  };

  const leftRaw = doubleColonIndex === -1 ? raw : raw.slice(0, doubleColonIndex);
  const rightRaw = doubleColonIndex === -1 ? '' : raw.slice(doubleColonIndex + 2);
  const left = parseParts(leftRaw);
  const right = parseParts(rightRaw);
  if (!left || !right) return null;

  if (doubleColonIndex === -1) {
    return left.length === 8 ? left : null;
  }
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

function isNonPublicIpv6(parts: readonly number[]): boolean {
  if (parts.length !== 8) return true;

  const isIpv4Mapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
  const isIpv4Compatible = parts.slice(0, 6).every((part) => part === 0);
  if (isIpv4Mapped || isIpv4Compatible) {
    return true;
  }

  // Public IPv6 global-unicast addresses currently occupy 2000::/3.
  if ((parts[0] & 0xe000) !== 0x2000) return true;

  return (
    (parts[0] === 0x2001 && parts[1] === 0x0002) ||
    (parts[0] === 0x2001 && parts[1] === 0x0010) ||
    (parts[0] === 0x2001 && parts[1] === 0x0db8)
  );
}

function isObviousLocalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    !hostname.includes('.') ||
    LOCAL_HOSTNAME_SUFFIXES.some(
      (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
    )
  );
}

export function validateIncomingAttachmentUrl(value: string): URL {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Remote attachment URL is missing');
  }
  if (value !== value.trim()) {
    throw new Error('Remote attachment URL is not canonical');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Remote attachment URL is invalid');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Remote attachment URL must use HTTPS');
  }
  if (url.username || url.password) {
    throw new Error('Remote attachment URL must not contain credentials');
  }
  if (url.port) {
    throw new Error('Remote attachment URL must use the default HTTPS port');
  }
  if (url.hash) {
    throw new Error('Remote attachment URL must not contain a fragment');
  }

  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname.endsWith('.')) {
    throw new Error('Remote attachment URL has an invalid hostname');
  }

  const ipv4 = parseIpv4Address(hostname);
  if (ipv4 && isNonPublicIpv4(ipv4)) {
    throw new Error('Remote attachment URL must not target a private or reserved address');
  }

  const ipv6 = parseIpv6Address(hostname);
  if (ipv6 && isNonPublicIpv6(ipv6)) {
    throw new Error('Remote attachment URL must not target a private or reserved address');
  }

  if (!ipv4 && !ipv6 && isObviousLocalHostname(hostname)) {
    throw new Error('Remote attachment URL must not target a local hostname');
  }

  return url;
}

export function classifyTrustedAttachmentHost(
  value: string | URL,
  config: TrustedAttachmentHostConfig = {},
): TrustedAttachmentHostKind {
  let url: URL;
  try {
    url = validateIncomingAttachmentUrl(value instanceof URL ? value.href : value);
  } catch {
    return 'untrusted';
  }

  const hostname = url.hostname.toLowerCase();
  const kinds: KnownTrustedAttachmentHostKind[] = [
    'converge',
    'convos',
    'thirdweb',
    'ipfs',
  ];

  for (const kind of kinds) {
    const rules = config[kind] ?? DEFAULT_TRUSTED_ATTACHMENT_HOSTS[kind];
    if (rules.some((rule) => hostnameMatchesRule(hostname, rule))) {
      return kind;
    }
  }
  return 'untrusted';
}

function validatePositiveInteger(
  value: number,
  label: string,
  maximum: number,
  unit = 'bytes',
): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${label} must be a positive integer no larger than ${maximum} ${unit}`);
  }
  return value;
}

async function acquireIncomingAttachmentSlot(): Promise<void> {
  if (activeIncomingAttachmentCount < MAX_CONCURRENT_INCOMING_ATTACHMENTS) {
    activeIncomingAttachmentCount += 1;
    return;
  }
  await new Promise<void>((resolve) => incomingAttachmentWaiters.push(resolve));
}

function releaseIncomingAttachmentSlot(): void {
  const waiter = incomingAttachmentWaiters.shift();
  if (waiter) {
    waiter();
    return;
  }
  activeIncomingAttachmentCount -= 1;
}

async function withIncomingAttachmentSlot<T>(operation: () => Promise<T>): Promise<T> {
  await acquireIncomingAttachmentSlot();
  try {
    return await operation();
  } finally {
    releaseIncomingAttachmentSlot();
  }
}

function parseContentLength(response: Response, declaredLength: number, maximum: number): void {
  const raw = response.headers.get('content-length');
  if (raw === null) return;
  if (!/^\d+$/.test(raw)) {
    throw new Error('Remote attachment response has an invalid Content-Length');
  }
  const contentLength = Number(raw);
  validatePositiveInteger(contentLength, 'Remote attachment Content-Length', maximum);
  if (contentLength !== declaredLength) {
    throw new Error(
      `Remote attachment Content-Length was ${contentLength} bytes; expected ${declaredLength}`,
    );
  }
}

function hasBytesAt(
  content: Uint8Array,
  offset: number,
  expected: readonly number[],
): boolean {
  return expected.every((value, index) => content[offset + index] === value);
}

function readUint16BigEndian(content: Uint8Array, offset: number): number {
  return content[offset] * 0x100 + content[offset + 1];
}

function readUint16LittleEndian(content: Uint8Array, offset: number): number {
  return content[offset] + content[offset + 1] * 0x100;
}

function readUint24LittleEndian(content: Uint8Array, offset: number): number {
  return content[offset] + content[offset + 1] * 0x100 + content[offset + 2] * 0x10000;
}

function readUint32BigEndian(content: Uint8Array, offset: number): number {
  return (
    content[offset] * 0x1000000 +
    content[offset + 1] * 0x10000 +
    content[offset + 2] * 0x100 +
    content[offset + 3]
  );
}

function readUint32LittleEndian(content: Uint8Array, offset: number): number {
  return (
    content[offset] +
    content[offset + 1] * 0x100 +
    content[offset + 2] * 0x10000 +
    content[offset + 3] * 0x1000000
  );
}

interface ImageDimensions {
  width: number;
  height: number;
}

function validateImageDimensions({ width, height }: ImageDimensions): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Remote attachment image has invalid dimensions');
  }
  if (width > MAX_INCOMING_IMAGE_DIMENSION || height > MAX_INCOMING_IMAGE_DIMENSION) {
    throw new Error(
      `Remote attachment image dimensions exceed ${MAX_INCOMING_IMAGE_DIMENSION}px`,
    );
  }
  if (width * height > MAX_INCOMING_IMAGE_PIXELS) {
    throw new Error(
      `Remote attachment image exceeds the ${MAX_INCOMING_IMAGE_PIXELS}-pixel limit`,
    );
  }
}

function parsePngDimensions(content: Uint8Array): ImageDimensions {
  if (
    content.byteLength < 37 ||
    readUint32BigEndian(content, 8) !== 13 ||
    !hasBytesAt(content, 12, [0x49, 0x48, 0x44, 0x52])
  ) {
    throw new Error('Remote attachment PNG header is malformed');
  }
  let chunkOffset = 8;
  while (chunkOffset + 12 <= content.byteLength) {
    const chunkLength = readUint32BigEndian(content, chunkOffset);
    const nextChunkOffset = chunkOffset + 12 + chunkLength;
    if (nextChunkOffset > content.byteLength) {
      throw new Error('Remote attachment PNG chunk is malformed');
    }
    if (fourCc(content, chunkOffset + 4) === 'acTL') {
      throw new Error('Animated PNG attachments are not allowed');
    }
    chunkOffset = nextChunkOffset;
  }
  return {
    width: readUint32BigEndian(content, 16),
    height: readUint32BigEndian(content, 20),
  };
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

function parseJpegDimensions(content: Uint8Array): ImageDimensions {
  let offset = 2;
  while (offset < content.byteLength) {
    if (content[offset] !== 0xff) {
      throw new Error('Remote attachment JPEG marker stream is malformed');
    }
    while (content[offset] === 0xff) offset += 1;
    if (offset >= content.byteLength) break;

    const marker = content[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > content.byteLength) {
      throw new Error('Remote attachment JPEG segment is truncated');
    }

    const segmentLength = readUint16BigEndian(content, offset);
    if (segmentLength < 2 || offset + segmentLength > content.byteLength) {
      throw new Error('Remote attachment JPEG segment is malformed');
    }
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7) {
        throw new Error('Remote attachment JPEG frame header is malformed');
      }
      return {
        height: readUint16BigEndian(content, offset + 3),
        width: readUint16BigEndian(content, offset + 5),
      };
    }
    offset += segmentLength;
  }
  throw new Error('Remote attachment JPEG is missing a frame header');
}

function fourCc(content: Uint8Array, offset: number): string {
  return String.fromCharCode(
    content[offset],
    content[offset + 1],
    content[offset + 2],
    content[offset + 3],
  );
}

function parseLossyWebpDimensions(content: Uint8Array, offset: number, length: number): ImageDimensions {
  if (length < 10 || !hasBytesAt(content, offset + 3, [0x9d, 0x01, 0x2a])) {
    throw new Error('Remote attachment WebP VP8 frame is malformed');
  }
  return {
    width: readUint16LittleEndian(content, offset + 6) & 0x3fff,
    height: readUint16LittleEndian(content, offset + 8) & 0x3fff,
  };
}

function parseLosslessWebpDimensions(content: Uint8Array, offset: number, length: number): ImageDimensions {
  if (length < 5 || content[offset] !== 0x2f) {
    throw new Error('Remote attachment WebP VP8L frame is malformed');
  }
  const packed =
    content[offset + 1] +
    content[offset + 2] * 0x100 +
    content[offset + 3] * 0x10000 +
    content[offset + 4] * 0x1000000;
  return {
    width: (packed & 0x3fff) + 1,
    height: (Math.floor(packed / 0x4000) & 0x3fff) + 1,
  };
}

function parseExtendedWebpDimensions(content: Uint8Array, offset: number, length: number): ImageDimensions {
  if (length < 10) {
    throw new Error('Remote attachment WebP VP8X header is malformed');
  }
  if ((content[offset] & 0x02) !== 0) {
    throw new Error('Animated WebP attachments are not allowed');
  }
  return {
    width: readUint24LittleEndian(content, offset + 4) + 1,
    height: readUint24LittleEndian(content, offset + 7) + 1,
  };
}

function parseWebpDimensions(content: Uint8Array): ImageDimensions {
  if (content.byteLength < 20) {
    throw new Error('Remote attachment WebP header is truncated');
  }
  const riffLength = readUint32LittleEndian(content, 4) + 8;
  if (riffLength !== content.byteLength) {
    throw new Error('Remote attachment WebP RIFF length is invalid');
  }

  let dimensions: ImageDimensions | null = null;
  let sawImageFrame = false;
  let offset = 12;
  while (offset < content.byteLength) {
    if (offset + 8 > content.byteLength) {
      throw new Error('Remote attachment WebP chunk header is truncated');
    }
    const chunkType = fourCc(content, offset);
    const chunkLength = readUint32LittleEndian(content, offset + 4);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + chunkLength;
    const nextOffset = dataEnd + (chunkLength % 2);
    if (dataEnd > content.byteLength || nextOffset > content.byteLength) {
      throw new Error('Remote attachment WebP chunk is truncated');
    }

    let chunkDimensions: ImageDimensions | null = null;
    if (chunkType === 'ANIM' || chunkType === 'ANMF') {
      throw new Error('Animated WebP attachments are not allowed');
    } else if (chunkType === 'VP8X') {
      chunkDimensions = parseExtendedWebpDimensions(content, dataOffset, chunkLength);
    } else if (chunkType === 'VP8 ') {
      chunkDimensions = parseLossyWebpDimensions(content, dataOffset, chunkLength);
      sawImageFrame = true;
    } else if (chunkType === 'VP8L') {
      chunkDimensions = parseLosslessWebpDimensions(content, dataOffset, chunkLength);
      sawImageFrame = true;
    }

    if (chunkDimensions) {
      if (
        dimensions &&
        (dimensions.width !== chunkDimensions.width || dimensions.height !== chunkDimensions.height)
      ) {
        throw new Error('Remote attachment WebP headers disagree on image dimensions');
      }
      dimensions = chunkDimensions;
    }
    offset = nextOffset;
  }

  if (!dimensions || !sawImageFrame) {
    throw new Error('Remote attachment WebP is missing an image frame');
  }
  return dimensions;
}

function inspectRasterImage(content: Uint8Array): {
  mimeType: AllowedIncomingImageMimeType;
  dimensions: ImageDimensions;
} {
  if (hasBytesAt(content, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mimeType: 'image/png', dimensions: parsePngDimensions(content) };
  }
  if (hasBytesAt(content, 0, [0xff, 0xd8, 0xff])) {
    return { mimeType: 'image/jpeg', dimensions: parseJpegDimensions(content) };
  }
  if (
    hasBytesAt(content, 0, [0x52, 0x49, 0x46, 0x46]) &&
    hasBytesAt(content, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return { mimeType: 'image/webp', dimensions: parseWebpDimensions(content) };
  }
  throw new Error('Remote attachment bytes are not a supported raster image');
}

async function readResponseWithLimit(
  response: Response,
  declaredLength: number,
  maximum: number,
): Promise<Uint8Array> {
  if (!response.body) {
    throw new Error('Remote attachment response body is missing');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel('Remote attachment exceeded the download limit');
        throw new Error(`Remote attachment exceeds the ${maximum}-byte download limit`);
      }
      if (total > declaredLength) {
        await reader.cancel('Remote attachment exceeded its declared length');
        throw new Error(
          `Remote attachment exceeded its declared ${declaredLength}-byte length`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (total !== declaredLength) {
    throw new Error(`Remote attachment returned ${total} bytes; expected ${declaredLength}`);
  }

  const payload = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return payload;
}

export function validateIncomingAttachmentContent(
  attachment: Attachment,
  maximum = MAX_INCOMING_ATTACHMENT_BYTES,
): Attachment {
  if (!(attachment.content instanceof Uint8Array)) {
    throw new Error('Decrypted attachment content is invalid');
  }
  validatePositiveInteger(
    attachment.content.byteLength,
    'Decrypted attachment size',
    maximum,
  );

  const mimeType = attachment.mimeType?.split(';', 1)[0]?.trim().toLowerCase();
  if (ACTIVE_CONTENT_MIME_TYPES.has(mimeType)) {
    throw new Error(`Active attachment type ${mimeType} is not allowed`);
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error(`Remote attachment type ${mimeType || 'unknown'} is not an allowed raster image`);
  }

  const inspected = inspectRasterImage(attachment.content);
  if (inspected.mimeType !== mimeType) {
    throw new Error(
      `Remote attachment MIME ${mimeType} does not match ${inspected.mimeType} bytes`,
    );
  }
  validateImageDimensions(inspected.dimensions);

  return { ...attachment, mimeType };
}

export async function fetchIncomingAttachment(
  remoteAttachment: RemoteAttachment,
  options: FetchIncomingAttachmentOptions = {},
): Promise<Attachment> {
  const url = validateIncomingAttachmentUrl(remoteAttachment.url);
  const maximum = options.maxBytes === undefined
    ? MAX_INCOMING_ATTACHMENT_BYTES
    : validatePositiveInteger(
        options.maxBytes,
        'Incoming attachment byte limit',
        MAX_INCOMING_ATTACHMENT_BYTES,
      );
  const declaredLength = validatePositiveInteger(
    remoteAttachment.contentLength,
    'Remote attachment declared length',
    maximum,
  );
  const timeoutMs = validatePositiveInteger(
    options.timeoutMs ?? DEFAULT_INCOMING_ATTACHMENT_TIMEOUT_MS,
    'Incoming attachment timeout',
    5 * 60_000,
    'ms',
  );
  const fetchFn = options.fetchFn ?? fetch;
  const decryptFn = options.decryptFn ?? decryptAttachment;

  return withIncomingAttachmentSlot(async () => {
    await options.authorize?.();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    let payload: Uint8Array;
    try {
      const response = await fetchFn(url.href, {
        method: 'GET',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Remote attachment storage returned HTTP ${response.status}`);
      }

      parseContentLength(response, declaredLength, maximum);
      payload = await readResponseWithLimit(response, declaredLength, maximum);
    } catch (error) {
      controller.abort();
      if (timedOut) {
        throw new Error(`Remote attachment download timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const decrypted = await decryptFn(payload, remoteAttachment);
    return validateIncomingAttachmentContent(decrypted, maximum);
  });
}
