import { bytesToHex } from 'viem';
import { english, generateMnemonic, mnemonicToAccount } from 'viem/accounts';
import type { Identity } from '@/types';
import { suggestAnimalDisplayName } from './profile-suggestions';

export const LOCAL_APP_IDENTITY_KIND = 'local-app' as const;

export interface GeneratedLocalAppIdentity {
  identity: Identity;
  privateKey: `0x${string}`;
  mnemonic: string;
}

export function generateLocalAppIdentity(now = Date.now()): GeneratedLocalAppIdentity {
  const mnemonic = generateMnemonic(english);
  const account = mnemonicToAccount(mnemonic, { path: "m/44'/60'/0'/0/0" });
  const privateKeyBytes = account.getHdKey().privateKey;
  if (!privateKeyBytes) {
    throw new Error('Unable to derive private key from mnemonic.');
  }

  const privateKey = bytesToHex(privateKeyBytes);
  const identity: Identity = {
    address: account.address,
    publicKey: account.publicKey,
    privateKey,
    mnemonic,
    createdAt: now,
    identityKind: LOCAL_APP_IDENTITY_KIND,
    displayName: suggestAnimalDisplayName(account.address).displayName,
  };

  return { identity, privateKey, mnemonic };
}
