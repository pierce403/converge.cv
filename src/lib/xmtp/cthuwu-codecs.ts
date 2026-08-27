import type { ContentCodec, ContentTypeId, EncodedContent } from './profile-codec';

export type CthuwuTypingControl = {
  type: 'cthuwu.typing.v1';
  active: boolean;
  expiresAtNs: string;
};

export const ContentTypeCthuwuTyping: ContentTypeId = {
  authorityId: 'cthuwu.app',
  typeId: 'typing',
  versionMajor: 1,
  versionMinor: 0,
};

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function parseCthuwuTypingControl(value: unknown): CthuwuTypingControl | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== 'active' ||
    keys[1] !== 'expiresAtNs' ||
    keys[2] !== 'type' ||
    record.type !== 'cthuwu.typing.v1' ||
    typeof record.active !== 'boolean' ||
    typeof record.expiresAtNs !== 'string' ||
    !/^[1-9][0-9]{0,19}$/.test(record.expiresAtNs)
  ) {
    return null;
  }
  return {
    type: 'cthuwu.typing.v1',
    active: record.active,
    expiresAtNs: record.expiresAtNs,
  };
}

export class CthuwuTypingCodec implements ContentCodec<CthuwuTypingControl | null> {
  contentType = ContentTypeCthuwuTyping;

  encode(content: CthuwuTypingControl | null): EncodedContent {
    const parsed = parseCthuwuTypingControl(content);
    if (!parsed) {
      throw new Error('Invalid cthuwu.typing.v1 content');
    }
    return {
      type: this.contentType,
      parameters: {},
      fallback: undefined,
      content: encoder.encode(JSON.stringify(parsed)),
    };
  }

  decode(encoded: EncodedContent): CthuwuTypingControl | null {
    try {
      return parseCthuwuTypingControl(JSON.parse(decoder.decode(encoded.content)));
    } catch {
      return null;
    }
  }

  fallback(): string | undefined {
    return undefined;
  }

  shouldPush(): boolean {
    return false;
  }
}
