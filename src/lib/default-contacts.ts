/**
 * Default contacts and agents for the Converge app
 *
 * These are suggested helpful agents/bots that can be added as default contacts.
 * Keep this list empty until we have verified XMTP-enabled addresses (no placeholders).
 */

export interface DefaultContact {
  address: string;
  name: string;
  avatar?: string;
  description: string;
  category: 'bot' | 'agent' | 'service' | 'community';
  isVerified?: boolean;
}

/**
 * Suggested default contacts for Converge
 *
 * Add only verified XMTP-enabled addresses when available.
 */
// Intentionally empty for now. We previously included the GM Bot here,
// but it has been removed from the default seeded conversations.
export const DEFAULT_CONTACTS: DefaultContact[] = [];

/**
 * Get contacts by category
 */
export function getContactsByCategory(category: DefaultContact['category']): DefaultContact[] {
  return DEFAULT_CONTACTS.filter(contact => contact.category === category);
}

/**
 * Get verified contacts only
 */
export function getVerifiedContacts(): DefaultContact[] {
  return DEFAULT_CONTACTS.filter(contact => contact.isVerified);
}

/**
 * Check if an address is a default contact
 */
export function isDefaultContact(address: string): boolean {
  return DEFAULT_CONTACTS.some(contact => 
    contact.address.toLowerCase() === address.toLowerCase()
  );
}

/**
 * Get contact info by address
 */
export function getContactInfo(address: string): DefaultContact | undefined {
  return DEFAULT_CONTACTS.find(contact => 
    contact.address.toLowerCase() === address.toLowerCase()
  );
}
