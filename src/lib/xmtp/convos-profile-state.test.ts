import { describe, expect, it } from 'vitest';
import type { GroupMember } from '@/types';
import {
  mergeConvosGroupMemberProfile,
  mergeConvosGroupProfiles,
  mergeConvosProfilesForRoster,
} from './convos-profile-state';

const inboxId = 'ab'.repeat(32);

describe('Convos profile state', () => {
  it('applies Convos source precedence and same-source recency', () => {
    let member: GroupMember | undefined;
    member = mergeConvosGroupMemberProfile(member, {
      inboxId,
      source: 'appData',
      sentAt: 10,
      name: 'App Name',
    });
    member = mergeConvosGroupMemberProfile(member, {
      inboxId,
      source: 'profileUpdate',
      sentAt: 20,
      name: 'Orange Orca',
    });
    member = mergeConvosGroupMemberProfile(member, {
      inboxId,
      source: 'profileSnapshot',
      sentAt: 30,
      name: 'Stale Relay',
    });
    member = mergeConvosGroupMemberProfile(member, {
      inboxId,
      source: 'profileUpdate',
      sentAt: 19,
      name: 'Older Update',
    });

    expect(member.displayName).toBe('Orange Orca');
    expect(member.profileSource).toBe('profileUpdate');
    expect(member.profileUpdatedAt).toBe(20);
  });

  it('does not clear known fields with blank or unspecified updates', () => {
    const member = mergeConvosGroupMemberProfile(
      {
        inboxId,
        displayName: 'Build Agent',
        memberKind: 1,
        profileMetadata: { templateId: 'template-1' },
        profileSource: 'profileSnapshot',
        profileUpdatedAt: 10,
      },
      {
        inboxId,
        source: 'profileUpdate',
        sentAt: 20,
        name: '   ',
        memberKind: 0,
      },
    );

    expect(member.displayName).toBe('Build Agent');
    expect(member.memberKind).toBe(1);
    expect(member.profileMetadata).toEqual({ templateId: 'template-1' });
  });

  it('keeps profiles keyed by normalized inbox ID', () => {
    const members = mergeConvosGroupProfiles(
      [{ inboxId: `0x${inboxId}`, address: '0x1111111111111111111111111111111111111111' }],
      [{ inboxId: inboxId.toUpperCase(), source: 'profileUpdate', sentAt: 1, name: 'Orange Orca' }],
    );

    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ inboxId, displayName: 'Orange Orca' });
  });

  it('clears revoked conversation metadata without erasing agent identity metadata', () => {
    const member = mergeConvosGroupMemberProfile(
      {
        inboxId,
        profileSource: 'profileUpdate',
        profileUpdatedAt: 10,
        profileMetadata: {
          connections: '{"grants":[]}',
          timezone: 'UTC',
          templateId: 'template-1',
          attestation: 'signed',
        },
      },
      { inboxId, source: 'profileUpdate', sentAt: 20, metadata: {} },
    );

    expect(member.profileMetadata).toEqual({ templateId: 'template-1', attestation: 'signed' });
  });

  it('does not treat an empty snapshot metadata map as a revocation', () => {
    const member = mergeConvosGroupMemberProfile(
      {
        inboxId,
        profileSource: 'appData',
        profileUpdatedAt: 10,
        profileMetadata: { connections: '{"grants":["chat"]}', timezone: 'UTC' },
      },
      { inboxId, source: 'profileSnapshot', sentAt: 20, metadata: {} },
    );

    expect(member.profileMetadata).toEqual({ connections: '{"grants":["chat"]}', timezone: 'UTC' });
  });

  it('does not turn stale snapshot entries into group members', () => {
    const actualMember = '12'.repeat(32);
    const removedMember = '34'.repeat(32);
    const members = mergeConvosProfilesForRoster(
      [{ inboxId: actualMember }],
      [
        { inboxId: actualMember, source: 'profileSnapshot', sentAt: 10, name: 'Current Member' },
        { inboxId: removedMember, source: 'profileSnapshot', sentAt: 10, name: 'Removed Member' },
      ],
      [actualMember],
    );

    expect(members).toEqual([expect.objectContaining({ inboxId: actualMember, displayName: 'Current Member' })]);
  });
});
