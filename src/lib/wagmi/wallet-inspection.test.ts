import { describe, expect, it } from 'vitest';
import {
  isWalletInspectionRequiredError,
  requireWalletTypeHintChain,
  WalletInspectionRequiredError,
  walletInspectionChainIds,
  withWalletInspectionTimeout,
} from './wallet-inspection';

describe('wallet inspection chains', () => {
  it('inspects the connector chain before the Base fallback', () => {
    expect(walletInspectionChainIds(1)).toEqual([1, 8453]);
    expect(walletInspectionChainIds(84532)).toEqual([84532, 8453]);
  });

  it('deduplicates Base and ignores unsupported connector chains', () => {
    expect(walletInspectionChainIds(8453)).toEqual([8453]);
    expect(walletInspectionChainIds(137)).toEqual([8453]);
  });

  it('requires a connected chain for an explicit smart-account fallback', () => {
    expect(requireWalletTypeHintChain('EOA')).toBeUndefined();
    expect(requireWalletTypeHintChain('SCW', 8453)).toBe(8453);
    expect(() => requireWalletTypeHintChain('SCW')).toThrow(
      'Reconnect the smart account on its network before continuing.'
    );
  });

  it('marks inspection failures without depending only on instanceof', () => {
    expect(isWalletInspectionRequiredError(new WalletInspectionRequiredError())).toBe(true);
    expect(
      isWalletInspectionRequiredError({ code: 'WALLET_INSPECTION_REQUIRED' })
    ).toBe(true);
    expect(isWalletInspectionRequiredError(new Error('network failed'))).toBe(false);
  });

  it('bounds a wallet bytecode inspection that never settles', async () => {
    await expect(
      withWalletInspectionTimeout(new Promise<never>(() => undefined), 1)
    ).rejects.toThrow('Wallet inspection timed out.');
  });
});
