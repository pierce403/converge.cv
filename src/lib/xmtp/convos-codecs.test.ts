import { describe, expect, it } from 'vitest';

import {
  ConvosJoinRequestCodec,
  ConvosProfileSnapshotCodec,
  ConvosProfileUpdateCodec,
  ConvosTypingIndicatorCodec,
  ContentTypeConvosJoinRequest,
  ContentTypeConvosProfileSnapshot,
  ContentTypeConvosProfileUpdate,
  ContentTypeConvosTypingIndicator,
  contentTypeMatches,
  isConvosSilentContentType,
} from './convos-codecs';

describe('Convos XMTP codecs', () => {
  it('encodes and decodes profile_update names as silent protobuf content', () => {
    const codec = new ConvosProfileUpdateCodec();
    const encoded = codec.encode({ name: '  Alice  ' });

    expect(encoded.type).toEqual(ContentTypeConvosProfileUpdate);
    expect(encoded.fallback).toBeUndefined();
    expect(codec.shouldPush()).toBe(false);
    expect(codec.decode(encoded)).toEqual({
      name: 'Alice',
      encryptedImage: undefined,
      memberKind: undefined,
      metadata: {},
    });
  });

  it('decodes an empty profile update as an empty authoritative metadata map', () => {
    const codec = new ConvosProfileUpdateCodec();

    expect(codec.decode(codec.encode({}))).toEqual({
      name: undefined,
      encryptedImage: undefined,
      memberKind: undefined,
      metadata: {},
    });
  });

  it('round-trips typed agent metadata in profile updates', () => {
    const codec = new ConvosProfileUpdateCodec();
    const encoded = codec.encode({
      name: 'Build Agent',
      memberKind: 1,
      metadata: {
        templateId: 'template-1',
        score: 4.25,
        active: true,
      },
    });

    expect(codec.decode(encoded)).toEqual({
      name: 'Build Agent',
      encryptedImage: undefined,
      memberKind: 1,
      metadata: {
        templateId: 'template-1',
        score: 4.25,
        active: true,
      },
    });
  });

  it('encodes and decodes profile_snapshot member names', () => {
    const codec = new ConvosProfileSnapshotCodec();
    const inboxId = 'ab'.repeat(32);
    const encoded = codec.encode({
      profiles: [
        {
          inboxId,
          name: 'Bob',
        },
      ],
    });

    expect(encoded.type).toEqual(ContentTypeConvosProfileSnapshot);
    expect(codec.decode(encoded)).toEqual({
      profiles: [
        {
          inboxId,
          name: 'Bob',
          encryptedImage: undefined,
          memberKind: undefined,
          metadata: undefined,
        },
      ],
    });
  });

  it('round-trips member kind and metadata in profile snapshots', () => {
    const codec = new ConvosProfileSnapshotCodec();
    const inboxId = 'cd'.repeat(32);
    const encoded = codec.encode({
      profiles: [{ inboxId, name: 'Deploy Agent', memberKind: 1, metadata: { emoji: 'bot', ready: true } }],
    });

    expect(codec.decode(encoded).profiles[0]).toMatchObject({
      inboxId,
      name: 'Deploy Agent',
      memberKind: 1,
      metadata: { emoji: 'bot', ready: true },
    });
  });

  it('encodes typing indicators as silent JSON content', () => {
    const codec = new ConvosTypingIndicatorCodec();
    const encoded = codec.encode({ isTyping: true });

    expect(encoded.type).toEqual(ContentTypeConvosTypingIndicator);
    expect(encoded.fallback).toBeUndefined();
    expect(codec.shouldPush()).toBe(false);
    expect(codec.decode(encoded)).toEqual({ isTyping: true });
  });

  it('encodes join requests with invite slug fallback and push enabled', () => {
    const codec = new ConvosJoinRequestCodec();
    const encoded = codec.encode({
      inviteSlug: ' invite-slug ',
      profile: {
        name: 'Alice',
        imageURL: 'https://cdn.example.com/alice.png',
      },
    });

    expect(encoded.type).toEqual(ContentTypeConvosJoinRequest);
    expect(encoded.fallback).toBe('invite-slug');
    expect(codec.shouldPush()).toBe(true);
    expect(codec.decode(encoded)).toEqual({
      inviteSlug: 'invite-slug',
      profile: {
        name: 'Alice',
        imageURL: 'https://cdn.example.com/alice.png',
        memberKind: undefined,
      },
      metadata: undefined,
    });
  });

  it('identifies Convos silent side-channel content types by full type id', () => {
    expect(contentTypeMatches(ContentTypeConvosProfileUpdate, ContentTypeConvosProfileUpdate)).toBe(true);
    expect(isConvosSilentContentType(ContentTypeConvosProfileUpdate)).toBe(true);
    expect(isConvosSilentContentType(ContentTypeConvosProfileSnapshot)).toBe(true);
    expect(isConvosSilentContentType(ContentTypeConvosTypingIndicator)).toBe(true);
    expect(isConvosSilentContentType(ContentTypeConvosJoinRequest)).toBe(false);
  });
});
