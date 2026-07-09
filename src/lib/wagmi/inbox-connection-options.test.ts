import { describe, expect, it } from 'vitest';
import type { WalletOption } from './hooks';
import { getInboxConnectionWalletOptions } from './inbox-connection-options';

const option = (id: string, name = id): WalletOption => ({
  id,
  name,
  icon: '*',
  provider: 'native',
});

describe('getInboxConnectionWalletOptions', () => {
  it('keeps only WalletConnect and browser wallet options', () => {
    const options = [
      option('coinbase', 'Coinbase Wallet'),
      option('metamask', 'MetaMask'),
      option('walletconnect', 'WalletConnect'),
      option('injected', 'Browser Wallet'),
      option('thirdweb-email', 'Email'),
    ];

    expect(getInboxConnectionWalletOptions(options).map((item) => item.id)).toEqual([
      'walletconnect',
      'injected',
    ]);
  });
});
