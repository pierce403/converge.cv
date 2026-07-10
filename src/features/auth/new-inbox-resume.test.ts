import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import type { Identity } from '@/types';
import { planPendingNewInboxAttempts } from './new-inbox-resume';

const privateKey = `0x${'11'.repeat(32)}` as const;
const address = privateKeyToAccount(privateKey).address;
const secondaryPrivateKey = `0x${'33'.repeat(32)}` as const;
const secondaryAddress = privateKeyToAccount(secondaryPrivateKey).address;
const inboxId = 'a'.repeat(64);

const pending = (overrides: Partial<Identity> = {}): Identity => ({
  address,
  publicKey: '',
  privateKey,
  createdAt: 1,
  provisioningMode: 'new-inbox',
  provisioningPending: true,
  xmtpDbPathMode: 'inbox-default',
  ...overrides,
});

describe('planPendingNewInboxAttempts', () => {
  it('resumes the newest fully persisted attempt deterministically', () => {
    const older = pending({ inboxId, installationId: 'install-old', createdAt: 10 });
    const newer = pending({
      inboxId: 'b'.repeat(64),
      installationId: 'install-new',
      createdAt: 20,
    });

    expect(planPendingNewInboxAttempts([older, newer]).resumable).toBe(newer);
  });

  it('does not resume a malformed key, mismatched inbox, or half-persisted attempt', () => {
    const result = planPendingNewInboxAttempts([
      pending({ address: `0x${'22'.repeat(20)}`, inboxId, installationId: 'install' }),
      pending({ inboxId, expectedInboxId: 'b'.repeat(64), installationId: 'install' }),
      pending({ inboxId }),
    ]);

    expect(result.resumable).toBeUndefined();
  });

  it('marks only pre-mutation attempts as safe to discard', () => {
    const beforeMutation = pending();
    const uncertain = pending({ installationId: 'install-only' });

    expect(planPendingNewInboxAttempts([beforeMutation, uncertain]).discardable).toEqual([
      beforeMutation,
    ]);
  });

  it('does not resume the currently loaded inbox for an explicit new-inbox request', () => {
    const currentInboxWithStaleFlag = pending({
      inboxId,
      installationId: 'install-current',
      createdAt: 20,
    });
    const interruptedNewInbox = pending({
      address: secondaryAddress,
      privateKey: secondaryPrivateKey,
      inboxId: 'b'.repeat(64),
      installationId: 'install-new',
      createdAt: 10,
    });

    expect(
      planPendingNewInboxAttempts([currentInboxWithStaleFlag, interruptedNewInbox], {
        excludeAddress: address,
      }).resumable
    ).toBe(interruptedNewInbox);
  });

  it('does not discard an excluded loaded identity with a stale pre-mutation flag', () => {
    const currentInboxWithStaleFlag = pending();

    expect(
      planPendingNewInboxAttempts([currentInboxWithStaleFlag], {
        excludeAddress: address,
      })
    ).toEqual({ resumable: undefined, discardable: [] });
  });
});
