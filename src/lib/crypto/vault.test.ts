/**
 * Crypto vault tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateVaultKey,
  deriveKeyFromPassphrase,
  wrapVaultKey,
  unwrapVaultKey,
  encryptData,
  decryptData,
  decryptString,
  setVaultKey,
  lockVault,
  isVaultUnlocked,
  generateSalt,
} from './vault';

describe('Crypto Vault', () => {
  beforeEach(() => {
    lockVault();
  });

  describe('Key Generation', () => {
    it('should generate a valid vault key', async () => {
      const key = await generateVaultKey();
      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
    });

    it('should generate random salt', () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      expect(salt1).toBeDefined();
      expect(salt1.length).toBe(32);
      expect(salt1).not.toEqual(salt2);
    });

    it('should derive key from passphrase', async () => {
      const passphrase = 'test-passphrase-123';
      const salt = generateSalt();
      const key = await deriveKeyFromPassphrase(passphrase, salt);
      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
    });

    it('should derive same key from same passphrase and salt', async () => {
      const passphrase = 'test-passphrase-123';
      const salt = generateSalt();
      const key1 = await deriveKeyFromPassphrase(passphrase, salt);
      const key2 = await deriveKeyFromPassphrase(passphrase, salt);

      // Export and compare
      const exported1 = await crypto.subtle.exportKey('raw', key1);
      const exported2 = await crypto.subtle.exportKey('raw', key2);

      expect(new Uint8Array(exported1)).toEqual(new Uint8Array(exported2));
    });
  });

  describe('Key Wrapping', () => {
    it('should wrap and unwrap vault key', async () => {
      const vaultKey = await generateVaultKey();
      const passphrase = 'test-passphrase';
      const salt = generateSalt();
      const wrapperKey = await deriveKeyFromPassphrase(passphrase, salt);

      const wrapped = await wrapVaultKey(vaultKey, wrapperKey);
      expect(wrapped).toBeDefined();
      expect(typeof wrapped).toBe('string');

      const unwrapped = await unwrapVaultKey(wrapped, wrapperKey);
      expect(unwrapped).toBeDefined();

      // Verify unwrapped key matches original
      const originalExported = await crypto.subtle.exportKey('raw', vaultKey);
      const unwrappedExported = await crypto.subtle.exportKey('raw', unwrapped);
      expect(new Uint8Array(originalExported)).toEqual(new Uint8Array(unwrappedExported));
    });
  });

  describe('Encryption/Decryption', () => {
    it('should encrypt and decrypt string data', async () => {
      const vaultKey = await generateVaultKey();
      setVaultKey(vaultKey);

      const plaintext = 'Hello, World!';
      const encrypted = await encryptData(plaintext);
      expect(encrypted).toBeDefined();
      expect(typeof encrypted).toBe('string');
      expect(encrypted).not.toBe(plaintext);

      const decrypted = await decryptString(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt binary data', async () => {
      const vaultKey = await generateVaultKey();
      setVaultKey(vaultKey);

      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const encrypted = await encryptData(plaintext.buffer);
      expect(encrypted).toBeDefined();

      const decrypted = await decryptData(encrypted);
      const decryptedArray = new Uint8Array(decrypted);
      expect(decryptedArray).toEqual(plaintext);
    });

    it('should throw error when encrypting without vault key', async () => {
      await expect(() => encryptData('test')).rejects.toThrow('Vault is locked');
    });

    it('should throw error when decrypting without vault key', async () => {
      const vaultKey = await generateVaultKey();
      setVaultKey(vaultKey);
      const encrypted = await encryptData('test');

      lockVault();

      await expect(() => decryptData(encrypted)).rejects.toThrow('Vault is locked');
    });
  });

  describe('Vault State', () => {
    it('should track vault lock state', () => {
      expect(isVaultUnlocked()).toBe(false);

      const key = {} as CryptoKey;
      setVaultKey(key);
      expect(isVaultUnlocked()).toBe(true);

      lockVault();
      expect(isVaultUnlocked()).toBe(false);
    });
  });
});
