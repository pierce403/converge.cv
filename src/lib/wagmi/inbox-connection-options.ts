import type { WalletOption } from './hooks';

const inboxConnectionOptionOrder = ['coinbase', 'walletconnect', 'injected'] as const;

export const INBOX_CONNECTION_WALLET_OPTION_IDS = new Set<string>(inboxConnectionOptionOrder);

export function getInboxConnectionWalletOptions(options: readonly WalletOption[]): WalletOption[] {
  const order = new Map<string, number>(inboxConnectionOptionOrder.map((id, index) => [id, index]));
  return options
    .filter((option) => INBOX_CONNECTION_WALLET_OPTION_IDS.has(option.id))
    .sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}
