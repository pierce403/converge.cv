import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearWalletConnectionIntent,
  createWalletConnectionIntent,
  persistWalletConnectionIntent,
  readWalletConnectionIntent,
  WALLET_CONNECTION_INTENT_STORAGE_KEY,
  WALLET_CONNECTION_INTENT_TTL_MS,
} from './wallet-connection-intent';

describe('wallet connection intent', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists only the connector handoff metadata needed to resume', () => {
    const intent = createWalletConnectionIntent({
      attemptId: 'attempt-1',
      flow: 'onboarding',
      connectorId: 'walletConnect',
      connectorName: 'WalletConnect',
      now: 1_000,
    });

    persistWalletConnectionIntent(intent);

    expect(readWalletConnectionIntent(localStorage, 1_001)).toEqual(intent);
    expect(localStorage.getItem(WALLET_CONNECTION_INTENT_STORAGE_KEY)).not.toContain(
      '0x'
    );
  });

  it('removes expired, future-dated, and malformed intents', () => {
    const expired = createWalletConnectionIntent({
      attemptId: 'expired',
      connectorId: 'metaMaskSDK',
      connectorName: 'MetaMask',
      now: 100,
    });
    persistWalletConnectionIntent(expired);
    expect(
      readWalletConnectionIntent(localStorage, 100 + WALLET_CONNECTION_INTENT_TTL_MS + 1)
    ).toBeNull();

    const future = createWalletConnectionIntent({
      attemptId: 'future',
      connectorId: 'metaMaskSDK',
      connectorName: 'MetaMask',
      now: WALLET_CONNECTION_INTENT_TTL_MS + 2_000,
    });
    persistWalletConnectionIntent(future);
    expect(readWalletConnectionIntent(localStorage, 1_000)).toBeNull();

    localStorage.setItem(WALLET_CONNECTION_INTENT_STORAGE_KEY, '{"flow":"onboarding"}');
    expect(readWalletConnectionIntent(localStorage, 1_000)).toBeNull();
    expect(localStorage.getItem(WALLET_CONNECTION_INTENT_STORAGE_KEY)).toBeNull();
  });

  it('does not let a late attempt clear a newer handoff', () => {
    persistWalletConnectionIntent(
      createWalletConnectionIntent({
        attemptId: 'new-attempt',
        flow: 'settings-inbox',
        connectorId: 'walletConnect',
        connectorName: 'WalletConnect',
      })
    );

    clearWalletConnectionIntent('old-attempt');
    expect(readWalletConnectionIntent()?.attemptId).toBe('new-attempt');

    clearWalletConnectionIntent('new-attempt');
    expect(readWalletConnectionIntent()).toBeNull();
  });
});
