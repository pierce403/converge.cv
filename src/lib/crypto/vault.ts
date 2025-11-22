/**
 * Crypto vault for key management and encryption
 */

// Vault key - kept in memory only
let vaultKey: CryptoKey | null = null;

export interface DeriveKeyOptions {
  method: 'passphrase' | 'passkey';
  passphrase?: string;
  passkeyCredentialId?: string;
  salt: Uint8Array;
  iterations?: number;
}

/**
 * Generate a random vault key (AES-GCM 256-bit)
 */
export async function generateVaultKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true, // extractable
    ['encrypt', 'decrypt']
  );
}

/**
 * Derive a key from a passphrase using PBKDF2
 */
export async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
  iterations = 600000
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passphraseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    passphraseKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Derive a key from WebAuthn passkey PRF extension
 * Returns null if PRF is not supported
 */
export async function deriveKeyFromPasskey(
  credentialId: string,
  salt: Uint8Array
): Promise<CryptoKey | null> {
  try {
    // Check if WebAuthn is available
    if (!window.PublicKeyCredential) {
      return null;
    }

    // Get assertion with PRF extension
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: salt as BufferSource,
        rpId: window.location.hostname,
        allowCredentials: [
          {
            id: Uint8Array.from(atob(credentialId), (c) => c.charCodeAt(0)) as BufferSource,
            type: 'public-key',
          },
        ],
        userVerification: 'required',
        extensions: {
          prf: {
            eval: {
              first: salt as BufferSource,
            },
          },
        },
      },
    }) as PublicKeyCredential & { getClientExtensionResults: () => { prf?: { results?: { first?: ArrayBuffer } } } };

    if (!credential) {
      return null;
    }

    // Extract PRF output
    const extensions = credential.getClientExtensionResults();
    const prfOutput = extensions.prf?.results?.first;

    if (!prfOutput) {
      return null;
    }

    // Import PRF output as key
    return await crypto.subtle.importKey(
      'raw',
      prfOutput,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  } catch (error) {
    console.error('Passkey key derivation failed:', error);
    return null;
  }
}

/**
 * Wrap (encrypt) the vault key with a derived key
 */
export async function wrapVaultKey(
  vaultKey: CryptoKey,
  wrapperKey: CryptoKey
): Promise<string> {
  // Export vault key
  const exportedKey = await crypto.subtle.exportKey('raw', vaultKey);

  // Encrypt with wrapper key
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    wrapperKey,
    exportedKey
  );

  // Combine IV + encrypted data
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  // Encode as base64
  return btoa(String.fromCharCode(...combined));
}

/**
 * Unwrap (decrypt) the vault key with a derived key
 */
export async function unwrapVaultKey(
  wrappedKey: string,
  wrapperKey: CryptoKey
): Promise<CryptoKey> {
  // Decode from base64
  const combined = Uint8Array.from(atob(wrappedKey), (c) => c.charCodeAt(0));

  // Extract IV and encrypted data
  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    wrapperKey,
    encrypted
  );

  // Import as vault key
  return await crypto.subtle.importKey(
    'raw',
    decrypted,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data with the vault key
 */
export async function encryptData(data: string | ArrayBuffer): Promise<string> {
  if (!vaultKey) {
    throw new Error('Vault is locked');
  }

  // Normalize to Uint8Array to satisfy subtle crypto requirements across runtimes
  const plaintext =
    typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, vaultKey, plaintext);

  // Combine IV + encrypted data
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt data with the vault key
 */
export async function decryptData(encryptedData: string): Promise<ArrayBuffer> {
  if (!vaultKey) {
    throw new Error('Vault is locked');
  }

  // Decode from base64
  const combined = Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0));

  // Extract IV and encrypted data
  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);

  return await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, vaultKey, encrypted);
}

/**
 * Decrypt data and return as string
 */
export async function decryptString(encryptedData: string): Promise<string> {
  const decrypted = await decryptData(encryptedData);
  return new TextDecoder().decode(decrypted);
}

/**
 * Set the active vault key
 */
export function setVaultKey(key: CryptoKey): void {
  vaultKey = key;
}

/**
 * Get the active vault key
 */
export function getVaultKey(): CryptoKey | null {
  return vaultKey;
}

/**
 * Lock the vault (clear key from memory)
 */
export function lockVault(): void {
  vaultKey = null;
}

/**
 * Check if vault is unlocked
 */
export function isVaultUnlocked(): boolean {
  return vaultKey !== null;
}

/**
 * Generate random salt
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}
