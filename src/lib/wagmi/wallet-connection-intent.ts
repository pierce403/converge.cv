export const WALLET_CONNECTION_INTENT_STORAGE_KEY =
  'converge.walletConnectionIntent.v1';

export const WALLET_CONNECTION_INTENT_TTL_MS = 15 * 60 * 1000;

export type WalletConnectionFlow =
  | 'generic'
  | 'onboarding'
  | 'settings-inbox';

export interface WalletConnectionIntent {
  version: 1;
  attemptId: string;
  flow: WalletConnectionFlow;
  connectorId: string;
  connectorName: string;
  startedAt: number;
}

interface WalletConnectionIntentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): WalletConnectionIntentStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isWalletConnectionFlow(value: unknown): value is WalletConnectionFlow {
  return value === 'generic' || value === 'onboarding' || value === 'settings-inbox';
}

function isWalletConnectionIntent(value: unknown): value is WalletConnectionIntent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WalletConnectionIntent>;
  return (
    candidate.version === 1 &&
    typeof candidate.attemptId === 'string' &&
    candidate.attemptId.length > 0 &&
    isWalletConnectionFlow(candidate.flow) &&
    typeof candidate.connectorId === 'string' &&
    candidate.connectorId.length > 0 &&
    typeof candidate.connectorName === 'string' &&
    candidate.connectorName.length > 0 &&
    typeof candidate.startedAt === 'number' &&
    Number.isFinite(candidate.startedAt)
  );
}

function createAttemptId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to a process-local unique ID.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createWalletConnectionIntent(options: {
  flow?: WalletConnectionFlow;
  connectorId: string;
  connectorName: string;
  now?: number;
  attemptId?: string;
}): WalletConnectionIntent {
  return {
    version: 1,
    attemptId: options.attemptId ?? createAttemptId(),
    flow: options.flow ?? 'generic',
    connectorId: options.connectorId,
    connectorName: options.connectorName,
    startedAt: options.now ?? Date.now(),
  };
}

export function readWalletConnectionIntent(
  storage: WalletConnectionIntentStorage | null = browserStorage(),
  now = Date.now()
): WalletConnectionIntent | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(WALLET_CONNECTION_INTENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !isWalletConnectionIntent(parsed) ||
      parsed.startedAt > now + WALLET_CONNECTION_INTENT_TTL_MS ||
      now - parsed.startedAt > WALLET_CONNECTION_INTENT_TTL_MS
    ) {
      storage.removeItem(WALLET_CONNECTION_INTENT_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    try {
      storage.removeItem(WALLET_CONNECTION_INTENT_STORAGE_KEY);
    } catch {
      // Storage itself is unavailable.
    }
    return null;
  }
}

export function persistWalletConnectionIntent(
  intent: WalletConnectionIntent,
  storage: WalletConnectionIntentStorage | null = browserStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(WALLET_CONNECTION_INTENT_STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // A private or storage-constrained browser may reject localStorage writes.
  }
}

export function clearWalletConnectionIntent(
  attemptId?: string,
  storage: WalletConnectionIntentStorage | null = browserStorage()
): void {
  if (!storage) return;
  try {
    if (attemptId) {
      const current = readWalletConnectionIntent(storage);
      if (current && current.attemptId !== attemptId) return;
    }
    storage.removeItem(WALLET_CONNECTION_INTENT_STORAGE_KEY);
  } catch {
    // Best effort only.
  }
}
