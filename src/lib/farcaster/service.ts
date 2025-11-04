export interface FarcasterUser {
  fid: number;
  custody_address: string;
  username: string;
  display_name: string;
  pfp_url: string;
  profile: {
    bio: {
      text: string;
    };
  };
  follower_count: number;
  following_count: number;
  verifications: string[]; // Ethereum addresses
  active_status: 'active' | 'inactive';
}

export interface FarcasterFollow {
  fid: number;
  custody_address: string;
  username: string;
  display_name: string;
  pfp_url: string;
  profile: {
    bio: {
      text: string;
    };
  };
  verifications: string[];
}

/**
 * Fetches a Farcaster user's profile by their FID or username from the backend API.
 * @param identifier FID (number) or username (string)
 * @returns FarcasterUser or null if not found
 */
export async function fetchFarcasterUserFromAPI(identifier: number | string): Promise<FarcasterUser | null> {
  try {
    const response = await fetch(`/api/farcaster/user/${identifier}`);
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data as FarcasterUser;
  } catch (error) {
    console.error(`Failed to fetch Farcaster user ${identifier} from API:`, error);
    return null;
  }
}

/**
 * Fetches the users that a given Farcaster user is following from the backend API.
 * @param fid The FID of the user whose followings to fetch.
 * @returns Array of FarcasterFollow objects.
 */
export async function fetchFarcasterUserFollowingFromAPI(fid: number): Promise<FarcasterFollow[]> {
  try {
    const response = await fetch(`/api/farcaster/following/${fid}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data as FarcasterFollow[];
  } catch (error) {
    console.error(`Failed to fetch Farcaster user ${fid} following from API:`, error);
    return [];
  }
}

/**
 * Resolves the XMTP address for a given Farcaster user.
 * This typically involves looking at their verified Ethereum addresses.
 * For simplicity, we'll return the first verified address.
 * A more robust solution might involve checking for a specific XMTP identity verification.
 * @param user FarcasterUser object
 * @returns The XMTP address (Ethereum address) or null if none found.
 */
export function resolveXmtpAddressFromFarcasterUser(user: FarcasterUser | FarcasterFollow): string | null {
  if (user.verifications && user.verifications.length > 0) {
    // For now, just take the first verified address
    return user.verifications[0];
  }
  return null;
}

/**
 * Resolves a Farcaster FID from an Ethereum address.
 * @param address Ethereum address
 * @returns FID number or null if not found
 */
export async function resolveFidFromAddress(address: string): Promise<number | null> {
  try {
    // Try to fetch Farcaster user by address
    // The API endpoint should accept Ethereum addresses
    const user = await fetchFarcasterUserFromAPI(address.toLowerCase());
    if (user && user.fid) {
      return user.fid;
    }
    return null;
  } catch (error) {
    console.error(`Failed to resolve FID from address ${address}:`, error);
    return null;
  }
}

/**
 * Resolves contact name with priority: ENS > .fcast.id > .base.eth > Farcaster name
 * @param user Farcaster user object
 * @param ethAddress Ethereum address
 * @returns Object with name and preferredName
 */
export async function resolveContactName(
  user: FarcasterUser | FarcasterFollow,
  ethAddress: string
): Promise<{ name: string; preferredName?: string }> {
  const { resolveENSFromAddress, resolveFcastId, resolveBaseEthName } = await import('@/lib/utils/ens');
  
  // Priority 1: Try ENS (.eth)
  const ensName = await resolveENSFromAddress(ethAddress);
  if (ensName) {
    return {
      name: user.display_name || user.username,
      preferredName: ensName,
    };
  }

  // Priority 2: Try .fcast.id
  const fcastId = await resolveFcastId(ethAddress);
  if (fcastId) {
    return {
      name: user.display_name || user.username,
      preferredName: fcastId,
    };
  }

  // Priority 3: Try .base.eth
  const baseEthName = await resolveBaseEthName(ethAddress);
  if (baseEthName) {
    return {
      name: user.display_name || user.username,
      preferredName: baseEthName,
    };
  }

  // Fallback: Use Farcaster name
  return {
    name: user.display_name || user.username,
  };
}
