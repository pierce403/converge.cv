import { getMessageRetentionCutoff } from '@/lib/message-retention-policy';
import { getStorage, getStorageNamespace, openStorageNamespace } from '@/lib/storage';
import type { MessageDeletionResult } from '@/lib/storage';
import { useConversationStore } from '@/lib/stores/conversation-store';
import { useInboxRegistryStore } from '@/lib/stores/inbox-registry-store';
import { useMessageStore } from '@/lib/stores/message-store';

export const MESSAGE_RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1_000;

export function applyMessageDeletionResult(result: MessageDeletionResult): void {
  useMessageStore.getState().removeMessages(result.deletedMessageIds);
  const updateConversation = useConversationStore.getState().updateConversation;
  for (const conversation of result.updatedConversations) {
    updateConversation(conversation.id, conversation);
  }
}

export async function deleteLocalMessage(messageId: string): Promise<MessageDeletionResult> {
  const storage = await getStorage();
  const result = await storage.deleteMessage(messageId);
  applyMessageDeletionResult(result);
  return result;
}

export async function runMessageRetention(now = Date.now()): Promise<MessageDeletionResult> {
  const namespace = getStorageNamespace();
  const cutoff = getMessageRetentionCutoff(now);
  const storage = await getStorage();
  const result = await storage.pruneMessages(cutoff, now);

  // An inbox switch can close the old database while a sweep is in flight.
  // Never apply the old namespace's result to the newly selected inbox's RAM state.
  if (getStorageNamespace() === namespace) {
    applyMessageDeletionResult(result);
    useMessageStore.getState().pruneMessages(cutoff, now);
  }
  return result;
}

export async function runLoadedInboxMessageRetention(
  now = Date.now(),
): Promise<MessageDeletionResult> {
  const activeNamespace = getStorageNamespace();
  const activeResult = await runMessageRetention(now);
  const cutoff = getMessageRetentionCutoff(now);
  useInboxRegistryStore.getState().hydrate();
  const registryEntries = useInboxRegistryStore.getState().entries;

  const inactiveNamespaces = Array.from(
    new Set(
      registryEntries
        .filter((entry) => entry.hasLocalDB && entry.inboxId !== activeNamespace)
        .map((entry) => entry.inboxId),
    ),
  );
  const failures: unknown[] = [];

  for (const namespace of inactiveNamespaces) {
    let storage: Awaited<ReturnType<typeof openStorageNamespace>> | undefined;
    try {
      storage = await openStorageNamespace(namespace);
      await storage.pruneMessages(cutoff, now);
    } catch (error) {
      failures.push(error);
      console.warn(`[Retention] Failed to prune inactive inbox ${namespace}`, error);
    } finally {
      await storage?.close().catch((error) => {
        failures.push(error);
        console.warn(`[Retention] Failed to close inactive inbox ${namespace}`, error);
      });
    }
  }

  if (failures.length > 0) {
    throw new Error(`Could not prune every loaded inbox (${failures.length} failures)`);
  }

  return activeResult;
}

export function startMessageRetentionScheduler(): () => void {
  let stopped = false;
  let inFlight: Promise<MessageDeletionResult> | null = null;

  const sweep = () => {
    if (stopped || inFlight) return;
    inFlight = runLoadedInboxMessageRetention()
      .catch((error) => {
        console.warn('[Retention] Failed to prune expired local messages', error);
        return { deletedMessageIds: [], updatedConversations: [] };
      })
      .finally(() => {
        inFlight = null;
      });
  };

  sweep();
  const interval = window.setInterval(sweep, MESSAGE_RETENTION_SWEEP_INTERVAL_MS);
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') sweep();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    stopped = true;
    window.clearInterval(interval);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
