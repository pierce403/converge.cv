import type { WalletProvider } from '@/lib/wallets/providers';

export type WalletSignatureStatusState = 'pending' | 'resolved' | 'rejected';

export interface WalletSignatureStatusDetail {
  id: string;
  state: WalletSignatureStatusState;
  provider: WalletProvider | 'unknown';
  startedAt: number;
  endedAt?: number;
  messagePreview: string;
  error?: string;
}

export const WALLET_SIGNATURE_STATUS_EVENT = 'ui:wallet-signature-status';

let signatureRequestCounter = 0;

function buildRequestId(): string {
  signatureRequestCounter += 1;
  return `wallet-signature-${Date.now()}-${signatureRequestCounter}`;
}

function buildMessagePreview(message: string): string {
  const compact = message.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return 'Signature request';
  }
  if (compact.length > 160) {
    return `${compact.slice(0, 157)}...`;
  }
  return compact;
}

function emitWalletSignatureStatus(detail: WalletSignatureStatusDetail): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent<WalletSignatureStatusDetail>(WALLET_SIGNATURE_STATUS_EVENT, { detail }));
}

export async function runWithWalletSignatureStatus<T>(params: {
  provider: WalletProvider | 'unknown';
  message: string;
  run: () => Promise<T>;
}): Promise<T> {
  const id = buildRequestId();
  const startedAt = Date.now();
  const messagePreview = buildMessagePreview(params.message);

  emitWalletSignatureStatus({
    id,
    state: 'pending',
    provider: params.provider,
    startedAt,
    messagePreview,
  });

  try {
    const result = await params.run();
    emitWalletSignatureStatus({
      id,
      state: 'resolved',
      provider: params.provider,
      startedAt,
      endedAt: Date.now(),
      messagePreview,
    });
    return result;
  } catch (error) {
    emitWalletSignatureStatus({
      id,
      state: 'rejected',
      provider: params.provider,
      startedAt,
      endedAt: Date.now(),
      messagePreview,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
