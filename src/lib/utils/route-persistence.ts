/**
 * Route persistence utilities for PWA tab restoration
 */

const LAST_ROUTE_KEY = 'converge_last_route';
const ROUTE_TIMESTAMP_KEY = 'converge_last_route_timestamp';

// Routes that shouldn't be persisted (transient pages)
const TRANSIENT_ROUTES = [
  '/onboarding',
  '/lock',
  '/new-chat',
  '/new-group',
  '/handle-xmtp-protocol',
];

/**
 * Check if a route should be persisted
 */
function shouldPersistRoute(path: string): boolean {
  // Don't persist transient routes
  if (TRANSIENT_ROUTES.includes(path)) {
    return false;
  }
  
  // Don't persist join-group routes (they're one-time use)
  if (path.startsWith('/join-group/')) {
    return false;
  }
  
  return true;
}

/**
 * Save the current route to localStorage
 */
export function saveLastRoute(path: string): void {
  if (!shouldPersistRoute(path)) {
    return;
  }
  
  try {
    localStorage.setItem(LAST_ROUTE_KEY, path);
    localStorage.setItem(ROUTE_TIMESTAMP_KEY, Date.now().toString());
  } catch (error) {
    console.warn('[Route Persistence] Failed to save route:', error);
  }
}

/**
 * Get the last saved route (if recent)
 */
export function getLastRoute(): string | null {
  try {
    const savedRoute = localStorage.getItem(LAST_ROUTE_KEY);
    const timestamp = localStorage.getItem(ROUTE_TIMESTAMP_KEY);
    
    if (!savedRoute || !timestamp) {
      return null;
    }
    
    // Only restore routes from the last 24 hours
    const age = Date.now() - parseInt(timestamp, 10);
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    if (age > maxAge) {
      // Clear stale route
      clearLastRoute();
      return null;
    }
    
    return savedRoute;
  } catch (error) {
    console.warn('[Route Persistence] Failed to get last route:', error);
    return null;
  }
}

/**
 * Clear the saved route
 */
export function clearLastRoute(): void {
  try {
    localStorage.removeItem(LAST_ROUTE_KEY);
    localStorage.removeItem(ROUTE_TIMESTAMP_KEY);
  } catch (error) {
    console.warn('[Route Persistence] Failed to clear route:', error);
  }
}

/**
 * Check if we should restore the last route
 * Only restore if we're on the home page and there's a saved route
 */
export function shouldRestoreLastRoute(currentPath: string): boolean {
  return currentPath === '/' || currentPath === '';
}

