/**
 * Date utility functions
 */

export function formatDistanceToNow(
  timestamp: number,
  options?: { addSuffix?: boolean }
): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  let result: string;
  if (seconds < 60) {
    result = 'just now';
  } else if (minutes < 60) {
    result = `${minutes}m`;
  } else if (hours < 24) {
    result = `${hours}h`;
  } else if (days < 7) {
    result = `${days}d`;
  } else if (weeks < 4) {
    result = `${weeks}w`;
  } else if (months < 12) {
    result = `${months}mo`;
  } else {
    result = `${years}y`;
  }

  if (options?.addSuffix && result !== 'just now') {
    return `${result} ago`;
  }
  return result;
}

export function formatMessageTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();

  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  if (isYesterday) {
    return 'Yesterday';
  }

  const isThisYear = date.getFullYear() === now.getFullYear();
  if (isThisYear) {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

