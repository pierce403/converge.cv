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
