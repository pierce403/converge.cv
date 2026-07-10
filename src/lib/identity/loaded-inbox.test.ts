import { describe, expect, it } from 'vitest';
import type { Identity } from '@/types';
import { findLoadedIdentityForInbox } from './loaded-inbox';

const identity = (overrides: Partial<Identity> = {}): Identity => ({
  address: '0x1111111111111111111111111111111111111111',
  publicKey: '0xpublic',
  createdAt: 1,
  inboxId: 'inbox-one',
  ...overrides,
});

describe('loaded inbox detection', () => {
  it('finds a completed identity even when the switcher registry is missing', () => {
    expect(findLoadedIdentityForInbox([identity()], 'INBOX-ONE')).toBeDefined();
  });

  it('does not classify an interrupted device join as an already-loaded inbox', () => {
    expect(
      findLoadedIdentityForInbox(
        [identity({ provisioningMode: 'device-join', provisioningPending: true })],
        'inbox-one'
      )
    ).toBeUndefined();
  });
});
