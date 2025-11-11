/**
 * Global helpers for preserving read state across destructive resync operations.
 */

export interface ResyncReadState {
  lastReadAt?: number;
  lastReadMessageId?: string | null;
}

type GlobalWithResyncState = typeof globalThis & {
  __cv_resync_read_state?: Map<string, ResyncReadState>;
};

const getGlobal = (): GlobalWithResyncState => globalThis as GlobalWithResyncState;

export function setResyncReadState(map: Map<string, ResyncReadState> | undefined): void {
  const globalObj = getGlobal();
  if (!map || map.size === 0) {
    delete globalObj.__cv_resync_read_state;
    return;
  }
  globalObj.__cv_resync_read_state = map;
}

export function appendResyncReadState(
  conversationId: string,
  state: ResyncReadState
): void {
  const globalObj = getGlobal();
  if (!globalObj.__cv_resync_read_state) {
    globalObj.__cv_resync_read_state = new Map();
  }
  globalObj.__cv_resync_read_state.set(conversationId, state);
}

export function getResyncReadState(): Map<string, ResyncReadState> | undefined {
  const globalObj = getGlobal();
  return globalObj.__cv_resync_read_state;
}

export function getResyncReadStateFor(
  conversationId: string
): ResyncReadState | undefined {
  const globalObj = getGlobal();
  return globalObj.__cv_resync_read_state?.get(conversationId);
}

export function clearResyncReadState(): void {
  const globalObj = getGlobal();
  delete globalObj.__cv_resync_read_state;
}
