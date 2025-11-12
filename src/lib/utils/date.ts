/**
 * Date utility functions
 */

interface FormatDistanceOptions {
  addSuffix?: boolean;
}

export function formatDistanceToNow(timestamp: number, options?: FormatDistanceOptions): string {
  const now = Date.now();
  const diff = now - timestamp;
  const absoluteDiff = Math.abs(diff);

  const seconds = Math.floor(absoluteDiff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  let base: string;

  if (seconds < 60) {
    base = 'just now';
  } else if (minutes < 60) {
    base = `${minutes}m`;
  } else if (hours < 24) {
    base = `${hours}h`;
  } else if (days < 7) {
    base = `${days}d`;
  } else if (weeks < 4) {
    base = `${weeks}w`;
  } else if (months < 12) {
    base = `${months}mo`;
  } else {
    base = `${years}y`;
  }

  if (!options?.addSuffix || base === 'just now') {
    return base;
  }

  if (diff >= 0) {
    return `${base} ago`;
  }

  return `in ${base}`;
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

