import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useDebugStore, logConsoleEvent, logNetworkEvent, logErrorEvent } from './debug-store';

describe('debug store', () => {
  beforeEach(() => {
    useDebugStore.setState({ consoleEntries: [], networkEntries: [], errorEntries: [] });
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('uuid-1');
  });

  it('records and clears console, network, and error logs', () => {
    logConsoleEvent({ level: 'info', message: 'hello' });
    logNetworkEvent({ direction: 'outbound', event: 'connect' });
    logErrorEvent({ source: 'runtime', message: 'boom' });

    const state = useDebugStore.getState();
    expect(state.consoleEntries).toHaveLength(1);
    expect(state.consoleEntries[0].message).toBe('hello');
    expect(state.networkEntries[0].event).toBe('connect');
    expect(state.errorEntries[0].source).toBe('runtime');

    state.clearAll();
    expect(useDebugStore.getState().consoleEntries).toHaveLength(0);
    expect(useDebugStore.getState().networkEntries).toHaveLength(0);
    expect(useDebugStore.getState().errorEntries).toHaveLength(0);
  });

  it('caps log sizes to configured limits', () => {
    const { recordConsoleLog } = useDebugStore.getState();
    for (let i = 0; i < 205; i++) {
      recordConsoleLog({ level: 'log', message: `m${i}` });
    }
    expect(useDebugStore.getState().consoleEntries).toHaveLength(200);
    expect(useDebugStore.getState().consoleEntries[0].message).toBe('m5');
  });
});
