import { beforeEach, describe, expect, it } from 'vitest';
import { consumeWalletApprovalIntent, preserveWalletApprovalIntent } from './wallet-approval-state';

describe('wallet approval intent', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    window.sessionStorage.clear();
  });

  it('survives one provider-tree remount on onboarding', () => {
    window.history.replaceState({}, '', '/onboarding');
    preserveWalletApprovalIntent();
    expect(consumeWalletApprovalIntent()).toBe(true);
    expect(consumeWalletApprovalIntent()).toBe(false);
  });

  it('does not redirect settings provider changes into onboarding approval', () => {
    window.history.replaceState({}, '', '/settings');
    preserveWalletApprovalIntent();
    expect(consumeWalletApprovalIntent()).toBe(false);
  });
});
