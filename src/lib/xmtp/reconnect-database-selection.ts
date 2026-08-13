import type { XmtpDbPathMode } from './device-provisioning';

export interface ReconnectDatabaseAttempt {
  mode: XmtpDbPathMode;
  deferMismatchedAdoption: boolean;
}

export function planReconnectDatabaseAttempts(input: {
  preferredMode: XmtpDbPathMode;
  preferredExists: boolean;
  alternateExists: boolean;
}): ReconnectDatabaseAttempt[] {
  const alternateMode: XmtpDbPathMode =
    input.preferredMode === 'inbox-default' ? 'legacy-address' : 'inbox-default';

  if (!input.preferredExists && input.alternateExists) {
    return [{ mode: alternateMode, deferMismatchedAdoption: false }];
  }
  if (input.preferredExists && input.alternateExists) {
    return [
      { mode: input.preferredMode, deferMismatchedAdoption: true },
      { mode: alternateMode, deferMismatchedAdoption: true },
      { mode: input.preferredMode, deferMismatchedAdoption: false },
      { mode: alternateMode, deferMismatchedAdoption: false },
    ];
  }
  return [{ mode: input.preferredMode, deferMismatchedAdoption: false }];
}
