import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_CONTACTS,
  getContactInfo,
  getContactsByCategory,
  getVerifiedContacts,
  isDefaultContact,
} from './default-contacts';

describe('default contacts helpers', () => {
  beforeEach(() => {
    DEFAULT_CONTACTS.splice(0, DEFAULT_CONTACTS.length);
    DEFAULT_CONTACTS.push({
      address: '0xabc',
      name: 'Test Bot',
      description: 'helper',
      category: 'bot',
      isVerified: true,
    });
    DEFAULT_CONTACTS.push({
      address: '0xdef',
      name: 'Community',
      description: 'community',
      category: 'community',
    });
  });

  it('filters by category and verification flags', () => {
    expect(getContactsByCategory('bot')).toHaveLength(1);
    expect(getContactsByCategory('community')).toHaveLength(1);
    expect(getVerifiedContacts()).toHaveLength(1);
  });

  it('finds contact by address case-insensitively', () => {
    expect(isDefaultContact('0xABC')).toBe(true);
    expect(isDefaultContact('0x123')).toBe(false);
    expect(getContactInfo('0xDEF')?.name).toBe('Community');
  });
});
