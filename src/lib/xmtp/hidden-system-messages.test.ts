import { describe, expect, it } from 'vitest';
import { isLegacyHiddenSystemMessage } from './hidden-system-messages';

describe('legacy hidden system messages', () => {
  it.each(['Typing', ' typing ', 'Thinking', 'Reaction', 'Reply'])(
    'hides obsolete %s placeholders',
    (body) => {
      expect(isLegacyHiddenSystemMessage(body)).toBe(true);
    },
  );

  it('keeps real system notices visible', () => {
    expect(isLegacyHiddenSystemMessage('Group membership changed')).toBe(false);
  });
});
