import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLastRoute,
  getLastRoute,
  saveLastRoute,
  shouldRestoreLastRoute,
} from './route-persistence';

const LAST_ROUTE_KEY = 'converge_last_route';
const ROUTE_TIMESTAMP_KEY = 'converge_last_route_timestamp';

describe('route persistence utils', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('does not persist transient routes', () => {
    saveLastRoute('/onboarding');
    expect(localStorage.getItem(LAST_ROUTE_KEY)).toBeNull();
    expect(localStorage.getItem(ROUTE_TIMESTAMP_KEY)).toBeNull();
  });

  it('saves non-transient routes with timestamp', () => {
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    saveLastRoute('/inbox');

    expect(localStorage.getItem(LAST_ROUTE_KEY)).toBe('/inbox');
    expect(localStorage.getItem(ROUTE_TIMESTAMP_KEY)).toBe(String(Date.now()));
  });

  it('ignores deep links', () => {
    saveLastRoute('/join-group/abc');
    saveLastRoute('/u/123');
    saveLastRoute('/i/456');

    expect(localStorage.getItem(LAST_ROUTE_KEY)).toBeNull();
  });

  it('returns null and clears stale routes', () => {
    const staleTimestamp = Date.now() - 25 * 60 * 60 * 1000;
    localStorage.setItem(LAST_ROUTE_KEY, '/inbox');
    localStorage.setItem(ROUTE_TIMESTAMP_KEY, String(staleTimestamp));

    expect(getLastRoute()).toBeNull();
    expect(localStorage.getItem(LAST_ROUTE_KEY)).toBeNull();
    expect(localStorage.getItem(ROUTE_TIMESTAMP_KEY)).toBeNull();
  });

  it('restores recent routes', () => {
    const recentTimestamp = Date.now() - 2 * 60 * 60 * 1000;
    localStorage.setItem(LAST_ROUTE_KEY, '/chat/123');
    localStorage.setItem(ROUTE_TIMESTAMP_KEY, String(recentTimestamp));

    expect(getLastRoute()).toBe('/chat/123');
  });

  it('clears saved route', () => {
    localStorage.setItem(LAST_ROUTE_KEY, '/inbox');
    localStorage.setItem(ROUTE_TIMESTAMP_KEY, String(Date.now()));

    clearLastRoute();

    expect(localStorage.getItem(LAST_ROUTE_KEY)).toBeNull();
    expect(localStorage.getItem(ROUTE_TIMESTAMP_KEY)).toBeNull();
  });

  it('only restores from home path', () => {
    expect(shouldRestoreLastRoute('/')).toBe(true);
    expect(shouldRestoreLastRoute('')).toBe(true);
    expect(shouldRestoreLastRoute('/inbox')).toBe(false);
  });
});
