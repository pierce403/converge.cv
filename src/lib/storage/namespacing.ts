import { getStorage, setStorageNamespace, getStorageNamespace } from '@/lib/storage';
import type { Identity, VaultSecrets } from '@/types';

/**
 * Ensure that the active storage namespace matches the given inbox and that
 * the identity (and vault secrets) are persisted inside that namespace.
 *
 * This is critical for the inbox switcher: without namespacing, we can end up
 * reloading into an empty database even though identities were created earlier
 * in a different shard (e.g., the default namespace).
 */
export async function ensureInboxStorageNamespace(
  inboxId: string | null | undefined,
  identity: Identity
): Promise<void> {
  if (!inboxId) return;

  const sourceNamespace = getStorageNamespace();
  const sourceStorage = await getStorage();
  const secrets = (await sourceStorage.getVaultSecrets()) as VaultSecrets | null;

  await setStorageNamespace(inboxId);
  const targetNamespace = getStorageNamespace();
  const targetStorage = sourceNamespace === targetNamespace ? sourceStorage : await getStorage();

  await targetStorage.putIdentity(identity);
  if (secrets) {
    await targetStorage.putVaultSecrets(secrets);
  }
}
