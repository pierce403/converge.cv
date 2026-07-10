import type { ThirdwebClient } from 'thirdweb';

const THIRDWEB_STORAGE_CLIENT_ID_FALLBACK = 'eb8bec9287101b98c08a3150aed11218';

function resolveThirdwebStorageClientId(): string | undefined {
  const metaKey =
    typeof import.meta !== 'undefined'
      ? import.meta.env?.VITE_THIRDWEB_CLIENT_ID
      : undefined;
  if (metaKey) return metaKey;
  if (typeof process !== 'undefined') {
    const envKey = (process.env as Record<string, string | undefined>)
      ?.VITE_THIRDWEB_CLIENT_ID;
    if (envKey) return envKey;
  }
  return THIRDWEB_STORAGE_CLIENT_ID_FALLBACK;
}

let cachedClient: Promise<ThirdwebClient | null> | undefined;

export async function getAttachmentStorageClient(): Promise<ThirdwebClient | null> {
  if (cachedClient) {
    return cachedClient;
  }
  const clientId = resolveThirdwebStorageClientId();
  cachedClient = clientId
    ? import('thirdweb').then(({ createThirdwebClient }) =>
        createThirdwebClient({ clientId })
      )
    : Promise.resolve(null);
  return cachedClient;
}
