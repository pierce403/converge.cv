import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { useInboxRegistryStore, getInboxDisplayLabel } from './inbox-registry-store';

const STORAGE_KEY = 'converge.inboxRegistry.v1';
const CURRENT_KEY = 'converge.currentInboxId.v1';

describe('inbox registry store', () => {
  beforeEach(() => {
    localStorage.clear();
    useInboxRegistryStore.setState({ entries: [], currentInboxId: null, isHydrated: false });
    vi.useRealTimers();
  });

  it('hydrates from storage and normalizes inbox ids', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          inboxId: ' ABC ',
          displayLabel: 'Personal',
          primaryDisplayIdentity: '0x1234567890',
          lastOpenedAt: 123,
          hasLocalDB: true,
        },
      ])
    );
    localStorage.setItem(CURRENT_KEY, 'abc');

    const store = useInboxRegistryStore.getState();
    store.hydrate();

    const hydrated = useInboxRegistryStore.getState();
    expect(hydrated.isHydrated).toBe(true);
    expect(hydrated.entries[0]?.inboxId).toBe('abc');
    expect(hydrated.currentInboxId).toBe('abc');
  });

  it('marks an inbox as opened and persists timestamp', () => {
    const store = useInboxRegistryStore.getState();
    act(() => {
      store.upsertEntry({
        inboxId: 'inbox-1',
        displayLabel: 'Work',
        primaryDisplayIdentity: '0xabc',
        lastOpenedAt: 0,
        hasLocalDB: false,
      });
    });

    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    act(() => store.markOpened('INBOX-1', true));

    const state = useInboxRegistryStore.getState();
    expect(state.currentInboxId).toBe('inbox-1');
    expect(state.entries[0]?.lastOpenedAt).toBe(Date.now());

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    expect(persisted[0]?.lastOpenedAt).toBe(Date.now());
    expect(localStorage.getItem(CURRENT_KEY)).toBe('inbox-1');
  });

  it('removes current inbox when deleting an entry', () => {
    const store = useInboxRegistryStore.getState();
    act(() => {
      store.upsertEntry({
        inboxId: 'inbox-2',
        displayLabel: 'Secondary',
        primaryDisplayIdentity: '0xdef',
        lastOpenedAt: 5,
        hasLocalDB: true,
      });
      store.setCurrentInbox('inbox-2');
    });

    act(() => store.removeEntry('inbox-2'));

    const state = useInboxRegistryStore.getState();
    expect(state.entries).toHaveLength(0);
    expect(state.currentInboxId).toBeNull();
    expect(localStorage.getItem(CURRENT_KEY)).toBeNull();
  });

  it('formats display labels for registry cards', () => {
    expect(
      getInboxDisplayLabel({
        inboxId: 'inbox-3',
        displayLabel: '',
        primaryDisplayIdentity: '0x1234567890abcdef1234567890abcdef12345678',
        lastOpenedAt: 0,
        hasLocalDB: true,
      })
    ).toBe('0x1234…5678');

    expect(
      getInboxDisplayLabel({
        inboxId: 'inbox-4',
        displayLabel: '',
        primaryDisplayIdentity: 'averylongnameforidentity',
        lastOpenedAt: 0,
        hasLocalDB: true,
      })
    ).toBe('aver…tity');

    expect(
      getInboxDisplayLabel({
        inboxId: 'inbox-5',
        displayLabel: 'Custom Label',
        primaryDisplayIdentity: '0xabc',
        lastOpenedAt: 0,
        hasLocalDB: true,
      })
    ).toBe('Custom Label');
  });
});
