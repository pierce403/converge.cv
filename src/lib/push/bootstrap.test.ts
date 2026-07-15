import { describe, expect, it } from 'vitest';
import { pushRegistrationRefreshCooldownKey } from './bootstrap';

describe('push registration bootstrap', () => {
  it('changes its cooldown key for each release build', () => {
    const first = pushRegistrationRefreshCooldownKey('ABC123', {
      version: '0.5.6',
      gitHash: 'first',
    });
    const second = pushRegistrationRefreshCooldownKey('ABC123', {
      version: '0.5.6',
      gitHash: 'second',
    });

    expect(first).not.toBe(second);
    expect(first).toContain('abc123.0.5.6.first');
  });
});
