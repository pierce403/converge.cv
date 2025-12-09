import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DERIVATION_PATH,
  KEYFILE_TYPE,
  KEYFILE_VERSION,
  deriveIdentityFromKeyfile,
  exportIdentityToKeyfile,
  parseKeyfile,
  serializeKeyfile,
} from './keyfile';

vi.mock('viem/accounts', async (importActual) => {
  const actual = await importActual<typeof import('viem/accounts')>();
  return {
    ...actual,
    mnemonicToAccount: vi.fn((mnemonic: string) => {
      // Minimal deterministic mock based on mnemonic text length
      const baseAddress =
        mnemonic === 'test test test test test test test test test test test junk'
          ? '0x3f8cbcf9c3e5cfcffe1234567890abcdeffedcba'
          : '0x1234567890abcdef1234567890abcdef12345678';
      return {
        address: baseAddress,
        getHdKey: () => ({
          privateKey: new Uint8Array([1, 2, 3, 4]),
        }),
      };
    }),
    privateKeyToAccount: vi.fn((pk: `0x${string}`) => ({
      address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      privateKey: pk,
    })),
  };
});

describe('keyfile helpers', () => {
  it('exports and serializes identity with mnemonic', () => {
    const identity = {
      address: '0xabc',
      publicKey: '0xpub',
      privateKey: undefined,
      mnemonic: 'test test test test test test test test test test test junk',
      createdAt: 1,
    };

    const keyfile = exportIdentityToKeyfile(identity as any);
    expect(keyfile.type).toBe(KEYFILE_TYPE);
    expect(keyfile.version).toBe(KEYFILE_VERSION);
    expect(keyfile.identity.derivationPath).toBe(DEFAULT_DERIVATION_PATH);

    const serialized = serializeKeyfile(keyfile);
    expect(serialized).toContain('"type": "converge-keyfile"');
  });

  it('parses keyfile and derives identity from mnemonic', () => {
    const raw = JSON.stringify({
      type: KEYFILE_TYPE,
      version: KEYFILE_VERSION,
      createdAt: new Date().toISOString(),
      identity: {
        address: '0x3f8cbcf9c3e5cfcffe1234567890abcdeffedcba',
        mnemonic: 'test test test test test test test test test test test junk',
        derivationPath: DEFAULT_DERIVATION_PATH,
      },
      meta: { app: 'Converge', exportedAt: new Date().toISOString() },
    });

    const parsed = parseKeyfile(raw);
    expect(parsed.identity.address).toMatch(/^0x3f8/);

    const derived = deriveIdentityFromKeyfile(parsed);
    expect(derived.address.toLowerCase()).toBe(parsed.identity.address.toLowerCase());
    expect(derived.privateKey).toMatch(/^0x/);
    expect(derived.mnemonic).toBe(parsed.identity.mnemonic);
    expect(derived.derivationPath).toBe(DEFAULT_DERIVATION_PATH);
  });

  it('derives from private key and validates address mismatch', () => {
    const keyfile = {
      type: KEYFILE_TYPE,
      version: KEYFILE_VERSION,
      createdAt: new Date().toISOString(),
      identity: {
        address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        privateKey: '0x1234',
      },
      meta: { app: 'Converge', exportedAt: new Date().toISOString() },
    } as any;

    const derived = deriveIdentityFromKeyfile(keyfile);
    expect(derived.address).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');

    const badKeyfile = {
      ...keyfile,
      identity: { ...keyfile.identity, address: '0xdeadbeef' },
    };
    expect(() => deriveIdentityFromKeyfile(badKeyfile as any)).toThrow(
      /does not match the expected address/
    );
  });

  it('throws on invalid keyfile shape', () => {
    expect(() => parseKeyfile('{"type":"wrong"}')).toThrow(/unexpected type/);
    expect(() => parseKeyfile('not json')).toThrow();
  });
});
