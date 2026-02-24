import { describe, expect, it } from 'vitest';
import {
  WALLET_SIGNATURE_STATUS_EVENT,
  runWithWalletSignatureStatus,
  type WalletSignatureStatusDetail,
} from './signature-status';

describe('wallet signature status events', () => {
  it('emits pending then resolved events', async () => {
    const seen: WalletSignatureStatusDetail[] = [];
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<WalletSignatureStatusDetail>).detail;
      seen.push(detail);
    };
    window.addEventListener(WALLET_SIGNATURE_STATUS_EVENT, handler as EventListener);

    try {
      const result = await runWithWalletSignatureStatus({
        provider: 'native',
        message: 'Please sign this message in your wallet',
        run: async () => 'ok',
      });

      expect(result).toBe('ok');
      expect(seen).toHaveLength(2);
      expect(seen[0].state).toBe('pending');
      expect(seen[1].state).toBe('resolved');
      expect(seen[1].id).toBe(seen[0].id);
      expect(seen[0].messagePreview).toContain('Please sign');
      expect(seen[1].endedAt).toBeTypeOf('number');
    } finally {
      window.removeEventListener(WALLET_SIGNATURE_STATUS_EVENT, handler as EventListener);
    }
  });

  it('emits rejected event when signing fails', async () => {
    const seen: WalletSignatureStatusDetail[] = [];
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<WalletSignatureStatusDetail>).detail;
      seen.push(detail);
    };
    window.addEventListener(WALLET_SIGNATURE_STATUS_EVENT, handler as EventListener);

    try {
      await expect(
        runWithWalletSignatureStatus({
          provider: 'thirdweb',
          message: 'A long message '.repeat(40),
          run: async () => {
            throw new Error('User rejected request');
          },
        })
      ).rejects.toThrow('User rejected request');

      expect(seen).toHaveLength(2);
      expect(seen[0].state).toBe('pending');
      expect(seen[1].state).toBe('rejected');
      expect(seen[1].id).toBe(seen[0].id);
      expect(seen[1].error).toContain('User rejected request');
      expect(seen[0].messagePreview.endsWith('...')).toBe(true);
    } finally {
      window.removeEventListener(WALLET_SIGNATURE_STATUS_EVENT, handler as EventListener);
    }
  });
});
