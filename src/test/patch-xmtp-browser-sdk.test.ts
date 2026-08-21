// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  patchXmtpBrowserSdkRuntime,
  XMTP_CLIENT_INIT_ORIGINAL,
  XMTP_CLIENT_INIT_PATCHED,
  XMTP_DIRECT_API_LITERAL,
  XMTP_SAME_ORIGIN_API_EXPRESSION,
} from '../../scripts/patch-xmtp-browser-sdk.mjs';

describe('patch-xmtp-browser-sdk script', () => {
  const unpatched = {
    indexSource: `const urls={production:${XMTP_DIRECT_API_LITERAL}};`,
    workerSource: `const urls={production:${XMTP_DIRECT_API_LITERAL}};${XMTP_CLIENT_INIT_ORIGINAL};`,
  };

  it('routes both SDK runtimes over the same-origin proxy and skips a redundant trusted lookup', () => {
    const patched = patchXmtpBrowserSdkRuntime(unpatched);

    expect(patched.indexSource).toContain(XMTP_SAME_ORIGIN_API_EXPRESSION);
    expect(patched.indexSource).not.toContain(XMTP_DIRECT_API_LITERAL);
    expect(patched.workerSource).toContain(XMTP_SAME_ORIGIN_API_EXPRESSION);
    expect(patched.workerSource).toContain(XMTP_CLIENT_INIT_PATCHED);
    expect(patched.workerSource).not.toContain(XMTP_CLIENT_INIT_ORIGINAL);
  });

  it('is idempotent', () => {
    const once = patchXmtpBrowserSdkRuntime(unpatched);
    expect(patchXmtpBrowserSdkRuntime(once)).toEqual(once);
  });

  it('fails closed when the pinned minified runtime shape drifts', () => {
    expect(() =>
      patchXmtpBrowserSdkRuntime({
        indexSource: 'const urls={production:"unexpected"};',
        workerSource: unpatched.workerSource,
      })
    ).toThrow(/did not match the pinned/);
  });
});
