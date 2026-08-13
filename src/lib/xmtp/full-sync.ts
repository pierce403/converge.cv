import { runMessageRetention } from '@/lib/message-retention';

export interface FullSyncClient {
  isConnected(): boolean;
  syncConversations(options: { force: true; reason: string; strict: true }): Promise<void>;
  runFullHistorySync(): Promise<void>;
}

export interface FullSyncDependencies {
  reloadConversations(): Promise<void>;
  runRetention?: () => Promise<unknown>;
}

/**
 * Refreshes the local message view without replacing the active XMTP database
 * or installation. A failed step leaves the existing local database intact.
 */
export async function runNonDestructiveFullSync(
  client: FullSyncClient,
  dependencies: FullSyncDependencies,
): Promise<void> {
  if (!client.isConnected()) {
    throw new Error('XMTP is not connected yet. Try again after reconnecting.');
  }

  await client.syncConversations({ force: true, reason: 'manual-full-sync', strict: true });
  await client.runFullHistorySync();
  await (dependencies.runRetention ?? runMessageRetention)();
  await dependencies.reloadConversations();
}
