import { describe, expect, it } from 'vitest';
import { formatCreateInboxError, formatMigrationError } from './identity-errors';

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

describe('formatMigrationError', () => {
  it('turns the XMTP browser transport failure into a safe retry message', () => {
    expect(
      formatMigrationError(
        new Error(
          'api client at endpoint "/xmtp.identity.api.v1.IdentityApi/GetInboxIds" has error status: Unknown error; js api error: TypeError: Failed to fetch'
        )
      )
    ).toBe(
      'XMTP could not be reached after retrying. Your local key is still stored, but XMTP may have applied part of the migration. Check your connection and retry with the same wallet.'
    );
  });

  it('preserves a bounded authorization failure', () => {
    expect(
      formatMigrationError(
        new Error(
          'The connected wallet is not a current account or recovery authority for this inbox.'
        )
      )
    ).toBe('The connected wallet is not a current account or recovery authority for this inbox.');
  });
});
