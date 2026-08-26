import { getStorage, setStorageNamespace, getStorageNamespace } from '@/lib/storage';
import type { Identity, VaultSecrets } from '@/types';

/**
 * Ensure that the active storage namespace matches the given inbox and that
 * the identity (and vault secrets) are persisted inside that namespace.
 *
 * This preserves compatibility with identities created by older releases:
 * without namespacing, reload can open an empty database even though the active
 * identity was stored earlier in a different shard (for example, `default`).
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
