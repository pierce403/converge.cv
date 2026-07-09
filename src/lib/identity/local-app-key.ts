import { bytesToHex } from 'viem';
import { english, generateMnemonic, mnemonicToAccount } from 'viem/accounts';
import type { Identity } from '@/types';

export const LOCAL_APP_IDENTITY_KIND = 'local-app' as const;

const shortAddress = (value: string) => `${value.slice(0, 6)}...${value.slice(-4)}`;

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
    displayName: `App key ${shortAddress(account.address)}`,
  };

  return { identity, privateKey, mnemonic };
}
