import { describe, expect, it } from 'vitest';
import { selectRecentConversationIds } from './backfill-targets';

describe('selectRecentConversationIds', () => {
  it('selects the top N by lastMessageAt (fallback createdAt)', () => {
    const ids = selectRecentConversationIds(
      [
        { id: 'old', lastMessageAt: 10, createdAt: 1 },
        { id: 'newer', lastMessageAt: 100, createdAt: 50 },
        { id: 'created-only', createdAt: 80 },
        { id: 'newest', lastMessageAt: 200 },
      ],
      2,
    );

    expect(ids.has('newest')).toBe(true);
    expect(ids.has('newer')).toBe(true);
    expect(ids.size).toBe(2);
  });

  it('is deterministic when timestamps tie', () => {
    const ids = selectRecentConversationIds(
      [
        { id: 'b', lastMessageAt: 10 },
        { id: 'a', lastMessageAt: 10 },
        { id: 'c', lastMessageAt: 9 },
      ],
      2,
    );

    expect(Array.from(ids).sort()).toEqual(['a', 'b']);
  });

  it('returns an empty set when limit is 0', () => {
    const ids = selectRecentConversationIds([{ id: 'a', lastMessageAt: 10 }], 0);
    expect(ids.size).toBe(0);
  });
});

