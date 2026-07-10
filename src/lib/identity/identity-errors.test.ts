import { describe, expect, it } from 'vitest';
import { formatCreateInboxError } from './identity-errors';

describe('formatCreateInboxError', () => {
  it('preserves an actionable XMTP failure', () => {
    expect(
      formatCreateInboxError(
        new Error('The local database is not ready. Retry to resume this same installation.')
      )
    ).toContain('Retry to resume this same installation.');
  });

  it('explains the former missing-identity-update failure instead of hiding it', () => {
    expect(formatCreateInboxError(new Error('Association error: Missing identity update'))).toBe(
      'Unable to create a new Converge inbox. XMTP has not published the identity update yet. Retry to resume this same local key.'
    );
  });

  it('does not expose unbounded worker output', () => {
    expect(formatCreateInboxError(new Error('x'.repeat(500))).length).toBeLessThan(340);
  });
});
