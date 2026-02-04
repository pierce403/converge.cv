export type ContentTypeId = {
  authorityId: string;
  typeId: string;
  versionMajor: number;
  versionMinor: number;
};

export type EncodedContent = {
  type?: ContentTypeId;
  parameters: Record<string, string>;
  fallback?: string;
  compression?: number;
  content: Uint8Array;
};

export type ContentCodec<ContentType = unknown> = {
  contentType: ContentTypeId;
  encode: (content: ContentType) => EncodedContent;
  decode: (content: EncodedContent) => ContentType;
  fallback: (content: ContentType) => string | undefined;
  shouldPush: (content: ContentType) => boolean;
};

export type ConvergeProfileContent = {
  type: 'profile';
  v: 1;
  displayName?: string;
  avatarUrl?: string;
  ts: number;
};

export const ContentTypeConvergeProfile: ContentTypeId = {
  authorityId: 'converge.cv',
  typeId: 'profile',
  versionMajor: 1,
  versionMinor: 0,
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const MAX_PROFILE_AVATAR_BYTES = 256 * 1024;
const MAX_PROFILE_AVATAR_URL_CHARS = 4096;
const MAX_PROFILE_DISPLAY_NAME_CHARS = 256;

const estimateDataUrlBytes = (dataUrl: string): number | null => {
  try {
    const commaIndex = dataUrl.indexOf(',');
    if (commaIndex < 0) return null;
    const meta = dataUrl.slice(0, commaIndex);
    if (!/;base64/i.test(meta)) {
      return dataUrl.length - commaIndex - 1;
    }
    const base64 = dataUrl
      .slice(commaIndex + 1)
      .replace(/\s+/g, '');
    if (!base64) return 0;
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    const bytes = Math.floor((base64.length * 3) / 4) - padding;
    return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
  } catch {
    return null;
  }
};

const sanitizeAvatarUrl = (value?: string): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return undefined;
  if (/^data:/i.test(trimmed)) {
    const bytes = estimateDataUrlBytes(trimmed);
    if (bytes == null) return undefined;
    return bytes <= MAX_PROFILE_AVATAR_BYTES ? trimmed : undefined;
  }
  return trimmed.length <= MAX_PROFILE_AVATAR_URL_CHARS ? trimmed : undefined;
};

const sanitizeDisplayName = (value?: string): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_PROFILE_DISPLAY_NAME_CHARS) {
    return trimmed.slice(0, MAX_PROFILE_DISPLAY_NAME_CHARS);
  }
  return trimmed;
};

export class ConvergeProfileCodec implements ContentCodec<ConvergeProfileContent> {
  contentType = ContentTypeConvergeProfile;

  encode(content: ConvergeProfileContent): EncodedContent {
    const safe: ConvergeProfileContent = {
      type: 'profile',
      v: 1,
      displayName: sanitizeDisplayName(content.displayName),
      avatarUrl: sanitizeAvatarUrl(content.avatarUrl),
      ts: Number.isFinite(content.ts) && content.ts > 0 ? content.ts : Date.now(),
    };

    return {
      type: this.contentType,
      parameters: {},
      content: encoder.encode(JSON.stringify(safe)),
      // Silent metadata message: omit fallback so other apps can ignore it.
      fallback: undefined,
    };
  }

  decode(encoded: EncodedContent): ConvergeProfileContent {
    try {
      const raw = decoder.decode(encoded.content);
      const obj = JSON.parse(raw) as Partial<ConvergeProfileContent> | null;
      return {
        type: 'profile',
        v: 1,
        displayName: sanitizeDisplayName(typeof obj?.displayName === 'string' ? obj.displayName : undefined),
        avatarUrl: sanitizeAvatarUrl(typeof obj?.avatarUrl === 'string' ? obj.avatarUrl : undefined),
        ts: typeof obj?.ts === 'number' && Number.isFinite(obj.ts) ? obj.ts : Date.now(),
      };
    } catch {
      return { type: 'profile', v: 1, ts: Date.now() };
    }
  }

  fallback(): string | undefined {
    return undefined;
  }

  shouldPush(): boolean {
    return false;
  }
}
