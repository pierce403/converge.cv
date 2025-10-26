/**
 * Default contacts and agents for the Converge app
 * 
 * These are suggested helpful agents that can be added as default contacts.
 * Replace with actual XMTP-enabled addresses when available.
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
 * NOTE: Some addresses are placeholders. Replace with actual XMTP-enabled addresses as they become available.
 * Check https://docs.xmtp.org for official bot addresses and https://base.org for Base ecosystem agents.
 */
export const DEFAULT_CONTACTS: DefaultContact[] = [
  {
    address: 'gm.xmtp.eth', // Official XMTP bot
    name: 'GM Bot',
    description: 'Say GM! The official XMTP bot for getting started',
    category: 'bot',
    isVerified: true,
    avatar: '👋',
  },
  {
    address: 'freysa.eth', // Popular XMTP bot
    name: 'Freysa',
    description: 'Chat with Freysa, a popular AI agent on XMTP',
    category: 'bot',
    isVerified: true,
    avatar: '🤖',
  },
  {
    address: '0x0000000000000000000000000000000000000002', // Placeholder
    name: 'Base Agent',
    description: 'Your guide to the Base ecosystem. Get crypto prices, gas fees, and more',
    category: 'agent',
    isVerified: true,
    avatar: '🔵',
  },
  {
    address: '0x0000000000000000000000000000000000000003', // Placeholder
    name: 'XMTP News',
    description: 'Latest updates and announcements from the XMTP protocol',
    category: 'service',
    isVerified: true,
    avatar: '📰',
  },
  {
    address: '0x0000000000000000000000000000000000000004', // Placeholder
    name: 'ENS Resolver',
    description: 'Look up ENS names, resolve addresses, and explore Web3 identities',
    category: 'service',
    isVerified: true,
    avatar: '🔍',
  },
  {
    address: '0x0000000000000000000000000000000000000005', // Placeholder
    name: 'Crypto Oracle',
    description: 'Real-time crypto prices, market data, and DeFi insights',
    category: 'agent',
    isVerified: true,
    avatar: '📊',
  },
  {
    address: '0x0000000000000000000000000000000000000006', // Placeholder
    name: 'Gas Tracker',
    description: 'Track gas prices across Ethereum, Base, and other networks',
    category: 'service',
    isVerified: false,
    avatar: '⛽',
  },
  {
    address: '0x0000000000000000000000000000000000000007', // Placeholder
    name: 'NFT Scout',
    description: 'Discover trending NFTs, collections, and marketplace activity',
    category: 'agent',
    isVerified: false,
    avatar: '🎨',
  },
  {
    address: '0x0000000000000000000000000000000000000008', // Placeholder
    name: 'Converge Support',
    description: 'Need help? Report bugs or suggest features',
    category: 'service',
    isVerified: true,
    avatar: '💬',
  },
];

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

