/**
 * Keyfile utilities for exporting and importing identities.
 */

import { bytesToHex } from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import type { Identity } from '@/types';

export const KEYFILE_TYPE = 'converge-keyfile' as const;
export const KEYFILE_VERSION = 1 as const;
export const DEFAULT_DERIVATION_PATH = "m/44'/60'/0'/0/0" as const;

export interface ConvergeKeyfile {
  version: typeof KEYFILE_VERSION;
  type: typeof KEYFILE_TYPE;
  createdAt: string;
  identity: {
    address: string;
    mnemonic?: string | null;
    privateKey?: string | null;
    derivationPath?: string | null;
    label?: string | null;
    inboxId?: string | null;
  };
  meta: {
    app: 'Converge';
    exportedAt: string;
    note?: string;
    appVersion?: string;
  };
}

export interface KeyfileIdentity {
  address: string;
  privateKey: `0x${string}`;
  mnemonic?: string;
  derivationPath?: string;
  label?: string | null;
}

export function exportIdentityToKeyfile(identity: Identity): ConvergeKeyfile {
  if (!identity.privateKey && !identity.mnemonic) {
    throw new Error('Identity does not have a private key or mnemonic to export.');
  }

  return {
    version: KEYFILE_VERSION,
    type: KEYFILE_TYPE,
    createdAt: new Date(identity.createdAt).toISOString(),
    identity: {
      address: identity.address,
      mnemonic: identity.mnemonic ?? null,
      privateKey: identity.privateKey ?? null,
      derivationPath: identity.mnemonic ? DEFAULT_DERIVATION_PATH : null,
      label: null, // Don't export display name - fetch from XMTP on restore
      inboxId: identity.inboxId ?? null,
    },
    meta: {
      app: 'Converge',
      exportedAt: new Date().toISOString(),
    },
  };
}

export function serializeKeyfile(keyfile: ConvergeKeyfile): string {
  return JSON.stringify(keyfile, null, 2);
}

export function parseKeyfile(raw: string): ConvergeKeyfile {
  const parsed = JSON.parse(raw) as ConvergeKeyfile;

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid keyfile: not an object.');
  }

  if (parsed.type !== KEYFILE_TYPE) {
    throw new Error('Invalid keyfile: unexpected type.');
  }

  if (parsed.version !== KEYFILE_VERSION) {
    throw new Error(`Unsupported keyfile version: ${parsed.version}`);
  }

  if (!parsed.identity || typeof parsed.identity.address !== 'string') {
    throw new Error('Invalid keyfile: missing identity information.');
  }

  return parsed;
}

export function deriveIdentityFromKeyfile(keyfile: ConvergeKeyfile): KeyfileIdentity {
  const { mnemonic, privateKey, derivationPath, address, label } = keyfile.identity;

  let resolvedPrivateKey: `0x${string}`;
  let resolvedAddress: string;

  if (mnemonic && mnemonic.trim().length > 0) {
    const defaultPath: `m/44'/60'/${string}` = DEFAULT_DERIVATION_PATH;
    const trimmedPath = derivationPath?.trim();
    const resolvedPath =
      trimmedPath && trimmedPath.length > 0
        ? (trimmedPath as `m/44'/60'/${string}`)
        : defaultPath;
    const account = mnemonicToAccount(mnemonic.trim(), { path: resolvedPath });
    const privateKeyBytes = account.getHdKey().privateKey;
    if (!privateKeyBytes) {
      throw new Error('Unable to derive private key from mnemonic.');
    }
    resolvedPrivateKey = bytesToHex(privateKeyBytes);
    resolvedAddress = account.address;
  } else if (privateKey && privateKey.trim().length > 0) {
    const normalised = privateKey.trim().startsWith('0x') ? privateKey.trim() : `0x${privateKey.trim()}`;
    const account = privateKeyToAccount(normalised as `0x${string}`);
    resolvedPrivateKey = normalised as `0x${string}`;
    resolvedAddress = account.address;
  } else {
    throw new Error('Keyfile does not contain a mnemonic or private key.');
  }

  if (address && address.trim().length > 0) {
    if (resolvedAddress.toLowerCase() !== address.trim().toLowerCase()) {
      throw new Error('Keyfile data does not match the expected address.');
    }
  }

  return {
    address: resolvedAddress,
    privateKey: resolvedPrivateKey,
    mnemonic: mnemonic ?? undefined,
    derivationPath: derivationPath ?? undefined,
    label: label ?? null,
  };
}
