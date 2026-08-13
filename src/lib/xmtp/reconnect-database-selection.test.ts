import { describe, expect, it } from 'vitest';
import { planReconnectDatabaseAttempts } from './reconnect-database-selection';

describe('reconnect database selection', () => {
  it('uses only an existing alternate when the saved path is absent', () => {
    expect(
      planReconnectDatabaseAttempts({
        preferredMode: 'inbox-default',
        preferredExists: false,
        alternateExists: true,
      })
    ).toEqual([{ mode: 'legacy-address', deferMismatchedAdoption: false }]);
  });

  it('checks both existing paths for the exact saved installation before adopting the preferred mismatch', () => {
    expect(
      planReconnectDatabaseAttempts({
        preferredMode: 'legacy-address',
        preferredExists: true,
        alternateExists: true,
      })
    ).toEqual([
      { mode: 'legacy-address', deferMismatchedAdoption: true },
      { mode: 'inbox-default', deferMismatchedAdoption: true },
      { mode: 'legacy-address', deferMismatchedAdoption: false },
      { mode: 'inbox-default', deferMismatchedAdoption: false },
    ]);
  });

  it('does not create an alternate path when neither alternate file exists', () => {
    expect(
      planReconnectDatabaseAttempts({
        preferredMode: 'inbox-default',
        preferredExists: false,
        alternateExists: false,
      })
    ).toEqual([{ mode: 'inbox-default', deferMismatchedAdoption: false }]);
  });
});
