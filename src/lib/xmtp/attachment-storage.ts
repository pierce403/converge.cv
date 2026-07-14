const THIRDWEB_STORAGE_UPLOAD_URL = 'https://storage.thirdweb.com/ipfs/upload';
const THIRDWEB_STORAGE_CLIENT_ID_FALLBACK = 'eb8bec9287101b98c08a3150aed11218';
const THIRDWEB_STORAGE_TIMEOUT_MS = 120_000;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface AttachmentStorageUploadOptions {
  clientId?: string;
  fetchFn?: FetchLike;
  timeoutMs?: number;
}

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

function requireSafeIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) {
    throw new Error(`Thirdweb returned an invalid ${label}`);
  }
  return value;
}

function uploadError(response: Response): Error {
  if (response.status === 401) {
    return new Error("Unauthorized - You don't have permission to use this service.");
  }
  if (response.status === 402) {
    return new Error(
      'You have reached your storage limit. Please add a valid payment method to continue using the service.',
    );
  }
  if (response.status === 403) {
    return new Error("Forbidden - You don't have permission to use this service.");
  }
  return new Error(
    `Failed to upload files to IPFS - ${response.status} - ${response.statusText}`,
  );
}

export async function uploadEncryptedAttachment(
  payload: Uint8Array,
  options: AttachmentStorageUploadOptions = {},
): Promise<{ uri: string; url: string }> {
  const clientId = requireSafeIdentifier(
    options.clientId ?? resolveThirdwebStorageClientId(),
    'client ID',
  );
  const form = new FormData();
  const payloadCopy = new Uint8Array(payload);
  form.append(
    'file',
    new Blob([payloadCopy], { type: 'application/octet-stream' }),
    'files',
  );
  form.append(
    'pinataMetadata',
    JSON.stringify({ keyvalues: {}, name: 'Storage SDK' }),
  );
  form.append(
    'pinataOptions',
    JSON.stringify({ wrapWithDirectory: false }),
  );

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? THIRDWEB_STORAGE_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await (options.fetchFn ?? fetch)(THIRDWEB_STORAGE_UPLOAD_URL, {
      method: 'POST',
      headers: { 'x-client-id': clientId },
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Thirdweb attachment upload timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw uploadError(response);
  }

  const body = await response.json() as { IpfsHash?: unknown };
  const cid = requireSafeIdentifier(body.IpfsHash, 'IPFS CID');
  const uri = `ipfs://${cid}`;
  return {
    uri,
    url: `https://${clientId}.ipfscdn.io/ipfs/${cid}`,
  };
}
