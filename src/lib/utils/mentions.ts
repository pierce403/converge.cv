export interface MentionCandidate {
  id: string;
  display: string;
  secondary?: string;
  avatarUrl?: string;
  inboxId?: string;
  address?: string;
}

export type MessageToken =
  | { type: 'text'; value: string }
  | { type: 'link'; value: string }
  | { type: 'mention'; value: string; label: string };

const mentionBoundaryRegex = /[\s([{"'`]/;
const mentionCharRegex = /[A-Za-z0-9._-]/;

const isMentionBoundary = (prev: string | undefined) => !prev || mentionBoundaryRegex.test(prev);
const isMentionChar = (char: string) => mentionCharRegex.test(char);

export const formatMention = (label: string): string => {
  const trimmed = label.trim();
  if (!trimmed) return '@';
  const needsBraces = /\s/.test(trimmed) || /[^A-Za-z0-9._-]/.test(trimmed);
  return needsBraces ? `@{${trimmed}}` : `@${trimmed}`;
};

export const normalizeMentionLabel = (label: string): string => label.trim().toLowerCase();

const splitByMentions = (text: string): MessageToken[] => {
  const tokens: MessageToken[] = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    if (char === '@' && isMentionBoundary(index > 0 ? text[index - 1] : undefined)) {
      const next = text[index + 1];
      if (next === '{') {
        const endBrace = text.indexOf('}', index + 2);
        if (endBrace !== -1) {
          const label = text.slice(index + 2, endBrace);
          if (label.length > 0) {
            tokens.push({ type: 'mention', value: `@${label}`, label });
            index = endBrace + 1;
            continue;
          }
        }
      } else if (next && isMentionChar(next)) {
        let cursor = index + 1;
        while (cursor < text.length && isMentionChar(text[cursor])) {
          cursor += 1;
        }
        if (cursor > index + 1) {
          const label = text.slice(index + 1, cursor);
          tokens.push({ type: 'mention', value: `@${label}`, label });
          index = cursor;
          continue;
        }
      }
    }

    const start = index;
    index += 1;
    while (
      index < text.length &&
      !(text[index] === '@' && isMentionBoundary(index > 0 ? text[index - 1] : undefined))
    ) {
      index += 1;
    }
    tokens.push({ type: 'text', value: text.slice(start, index) });
  }

  return tokens;
};

export const tokenizeMessage = (text: string): MessageToken[] => {
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const tokens: MessageToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(...splitByMentions(text.slice(lastIndex, match.index)));
    }
    tokens.push({ type: 'link', value: match[0] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push(...splitByMentions(text.slice(lastIndex)));
  }

  return tokens;
};
