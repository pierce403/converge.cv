const WALLET_APPROVAL_INTENT_KEY = 'converge.walletApprovalIntent.v1';

export function preserveWalletApprovalIntent(): void {
  if (
    typeof window === 'undefined' ||
    !['/', '/onboarding'].includes(window.location.pathname)
  ) {
    return;
  }
  window.sessionStorage.setItem(WALLET_APPROVAL_INTENT_KEY, '1');
}

export function consumeWalletApprovalIntent(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const shouldResume = window.sessionStorage.getItem(WALLET_APPROVAL_INTENT_KEY) === '1';
  window.sessionStorage.removeItem(WALLET_APPROVAL_INTENT_KEY);
  return shouldResume;
}
