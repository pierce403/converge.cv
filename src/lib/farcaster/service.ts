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
    const url = `/api/farcaster/user/${encodeURIComponent(String(identifier))}`;
    console.log(`[Farcaster API] Fetching: ${url}`);
    const response = await fetch(url);
    
    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[Farcaster API] 404 - User not found: ${identifier}`);
        return null;
      }
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`[Farcaster API] HTTP ${response.status} for ${identifier}:`, errorText);
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }
    
    const data = await response.json();
    console.log(`[Farcaster API] ✅ Successfully fetched user:`, { fid: data.fid, username: data.username });
    return data as FarcasterUser;
  } catch (error) {
    console.error(`[Farcaster API] ❌ Failed to fetch Farcaster user ${identifier}:`, error);
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
 * Strategy: Try multiple lookup methods:
 * 1. ETH address -> ENS name -> Farcaster FID (by ENS username)
 * 2. ETH address -> Farcaster API (if supports address lookup)
 * 3. ETH address -> Try as username (if address format matches)
 * @param address Ethereum address
 * @returns FID number or null if not found
 */
export async function resolveFidFromAddress(address: string): Promise<number | null> {
  console.log(`[Farcaster] Resolving FID for address: ${address}`);
  
  try {
    // Step 1: Reverse lookup ENS name from Ethereum address
    const { resolveENSFromAddress } = await import('@/lib/utils/ens');
    const ensName = await resolveENSFromAddress(address);
    
    if (ensName) {
      console.log(`[Farcaster] ✅ Found ENS name: ${ensName}`);
      
      // Try looking up by ENS name (without .eth suffix, as that's typically the username)
      const ensUsername = ensName.replace(/\.eth$/, '');
      console.log(`[Farcaster] Trying to lookup Farcaster user by ENS username: ${ensUsername}`);
      
      const userByEns = await fetchFarcasterUserFromAPI(ensUsername);
      if (userByEns && userByEns.fid) {
        console.log(`[Farcaster] ✅ Found FID ${userByEns.fid} via ENS username ${ensUsername}`);
        return userByEns.fid;
      }
      
      // Also try with .eth suffix
      console.log(`[Farcaster] Trying with .eth suffix: ${ensName}`);
      const userByEnsFull = await fetchFarcasterUserFromAPI(ensName);
      if (userByEnsFull && userByEnsFull.fid) {
        console.log(`[Farcaster] ✅ Found FID ${userByEnsFull.fid} via ENS name ${ensName}`);
        return userByEnsFull.fid;
      }
      
      console.log(`[Farcaster] ⚠️  No Farcaster user found for ENS name ${ensName}`);
    } else {
      console.log(`[Farcaster] ⚠️  No ENS name found for address ${address}`);
    }
    
    // Step 2: Try direct address lookup (API might support it)
    console.log(`[Farcaster] Trying direct address lookup: ${address.toLowerCase()}`);
    const userByAddress = await fetchFarcasterUserFromAPI(address.toLowerCase());
    if (userByAddress && userByAddress.fid) {
      console.log(`[Farcaster] ✅ Found FID ${userByAddress.fid} via direct address lookup`);
      return userByAddress.fid;
    }
    
    // Step 3: Try without 0x prefix
    if (address.startsWith('0x')) {
      const addressWithoutPrefix = address.slice(2).toLowerCase();
      console.log(`[Farcaster] Trying address without 0x prefix: ${addressWithoutPrefix}`);
      const userByAddressNoPrefix = await fetchFarcasterUserFromAPI(addressWithoutPrefix);
      if (userByAddressNoPrefix && userByAddressNoPrefix.fid) {
        console.log(`[Farcaster] ✅ Found FID ${userByAddressNoPrefix.fid} via address without prefix`);
        return userByAddressNoPrefix.fid;
      }
    }
    
    console.log(`[Farcaster] ❌ Could not resolve FID for address ${address} using any method`);
    return null;
  } catch (error) {
    console.error(`[Farcaster] ❌ Error resolving FID from address ${address}:`, error);
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
