export function formatWalletConnectionError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).trim();
  const normalized = message.toLowerCase();

  if (
    normalized.includes('user rejected') ||
    normalized.includes('user cancelled') ||
    normalized.includes('user canceled')
  ) {
    return 'Connection cancelled. Please try again.';
  }

  if (
    normalized.includes('session_request') ||
    normalized.includes('timed out') ||
    normalized.includes('timeout')
  ) {
    return 'Connection timeout. Please try again.';
  }

  return message || 'Failed to connect wallet';
}
