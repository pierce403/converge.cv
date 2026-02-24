export type BackfillConversationLike = {
  id: string;
  lastMessageAt?: number | null;
  createdAt?: number | null;
};

export function selectRecentConversationIds(
  conversations: BackfillConversationLike[],
  limit: number,
): Set<string> {
  const safeLimit = Math.max(0, Math.floor(limit));
  if (safeLimit === 0) {
    return new Set();
  }

  const sorted = [...conversations].sort((a, b) => {
    const aTime = a.lastMessageAt ?? a.createdAt ?? 0;
    const bTime = b.lastMessageAt ?? b.createdAt ?? 0;
    if (bTime !== aTime) {
      return bTime - aTime;
    }
    return String(a.id).localeCompare(String(b.id));
  });

  return new Set(sorted.slice(0, safeLimit).map((c) => c.id));
}

