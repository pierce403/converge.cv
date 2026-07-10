export const WALLET_INSPECTION_CHAIN_IDS = [1, 8453, 84532] as const;
export type WalletInspectionChainId = (typeof WALLET_INSPECTION_CHAIN_IDS)[number];
export type WalletTypeHint = 'EOA' | 'SCW';

export const WALLET_INSPECTION_TIMEOUT_MS = 5_000;

export class WalletInspectionRequiredError extends Error {
  readonly code = 'WALLET_INSPECTION_REQUIRED';

  constructor() {
    super(
      'Converge could not inspect this account. Choose whether it is a regular wallet or a smart account.'
    );
    this.name = 'WalletInspectionRequiredError';
  }
}

export function isWalletInspectionRequiredError(
  error: unknown
): error is WalletInspectionRequiredError {
  return (
    error instanceof WalletInspectionRequiredError ||
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'WALLET_INSPECTION_REQUIRED')
  );
}

export function requireWalletTypeHintChain(
  walletType: WalletTypeHint,
  connectedChainId?: number
): number | undefined {
  if (walletType === 'EOA') {
    return connectedChainId;
  }
  if (
    !Number.isSafeInteger(connectedChainId) ||
    (connectedChainId ?? 0) <= 0
  ) {
    throw new Error(
      'Reconnect the smart account on its network before continuing.'
    );
  }
  return connectedChainId;
}

export async function withWalletInspectionTimeout<T>(
  inspection: Promise<T>,
  timeoutMs = WALLET_INSPECTION_TIMEOUT_MS
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      inspection,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Wallet inspection timed out.')),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export function walletInspectionChainIds(
  connectedChainId?: number
): WalletInspectionChainId[] {
  const supported = WALLET_INSPECTION_CHAIN_IDS.includes(
    connectedChainId as WalletInspectionChainId
  )
    ? [connectedChainId as WalletInspectionChainId]
    : [];
  return Array.from(new Set<WalletInspectionChainId>([...supported, 8453]));
}
