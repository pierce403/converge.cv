import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { generateLocalAppIdentity, LOCAL_APP_IDENTITY_KIND } from './local-app-key';

describe('generateLocalAppIdentity', () => {
  it('creates an exportable local identity whose address is derived from the private key', () => {
    const generated = generateLocalAppIdentity(1_700_000_000_000);
    const account = privateKeyToAccount(generated.privateKey);

    expect(generated.identity.identityKind).toBe(LOCAL_APP_IDENTITY_KIND);
    expect(generated.identity.privateKey).toBe(generated.privateKey);
    expect(generated.identity.mnemonic).toBe(generated.mnemonic);
    expect(generated.identity.createdAt).toBe(1_700_000_000_000);
    expect(generated.identity.address).toBe(account.address);
    expect(generated.identity.publicKey).toBe(account.publicKey);
    expect(generated.identity.displayName).toMatch(/^App key 0x/i);
  });
});
