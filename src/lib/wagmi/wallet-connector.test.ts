import { describe, expect, it } from 'vitest';
import { resolveWalletConnector } from './wallet-connector';

const connectors = [
  { id: 'injected', name: 'Injected' },
  { id: 'walletConnect', name: 'WalletConnect' },
];

describe('resolveWalletConnector', () => {
  it('does not substitute the first connector for a missing explicit id', () => {
    expect(
      resolveWalletConnector({ connectorId: 'coinbaseWalletSDK' }, connectors)
    ).toBeUndefined();
  });

  it('does not substitute the first connector for a missing explicit name', () => {
    expect(
      resolveWalletConnector({ connectorName: 'Coinbase Wallet' }, connectors)
    ).toBeUndefined();
  });

  it('resolves exact explicit choices and retains default-only fallback', () => {
    expect(
      resolveWalletConnector({ connectorName: 'WalletConnect' }, connectors)
    ).toEqual(connectors[1]);
    expect(resolveWalletConnector({}, connectors)).toEqual(connectors[0]);
  });
});
