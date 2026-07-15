// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('push service worker privacy contract', () => {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const source = fs.readFileSync(path.join(projectRoot, 'public', 'sw.js'), 'utf8');

  it('builds visible copy locally and ignores relay-provided message content', () => {
    expect(source).toContain('New activity for ${displayName}');
    expect(source).toContain("showNotification('Converge'");
    expect(source).not.toMatch(/payload\.(?:title|body|sender|conversationId|tag|icon|badge)/);
  });

  it('persists and posts an opaque per-inbox activity hint', () => {
    expect(source).toContain("const PUSH_ACTIVITY_STORE = 'activity'");
    expect(source).toContain("type: 'converge.push.activity'");
    expect(source).toContain('`converge-xmtp-${inboxHandle}`');
  });

  it('handles relay diagnostics separately without recording inbox activity', () => {
    expect(source).toContain("payload.type === 'vapid.diagnostic'");
    expect(source).toContain("showDiagnosticNotification(diagnosticTestId, 'relay')");
    expect(source).toContain("type: 'converge.push.diagnostic'");
    expect(source).toContain("source: 'local'");
    const pushHandler = source.slice(
      source.indexOf("self.addEventListener('push'"),
      source.indexOf("self.addEventListener('message'"),
    );
    expect(pushHandler.indexOf("payload.type === 'vapid.diagnostic'"))
      .toBeLessThan(pushHandler.indexOf('recordInboxActivity(inboxHandle, receivedAt)'));
    const diagnosticFunction = source.slice(
      source.indexOf('async function showDiagnosticNotification'),
      source.indexOf('function localProfileName'),
    );
    expect(diagnosticFunction.indexOf("await self.registration.showNotification('Converge push test'"))
      .toBeLessThan(diagnosticFunction.indexOf('recordDiagnosticReceipt(testId, receivedAt, source)'));
  });

  it('focuses the app without encoding an inbox switch decision in the click URL', () => {
    expect(source).toContain("self.addEventListener('notificationclick'");
    expect(source).toContain("const url = self.location.origin + '/'");
    expect(source).not.toMatch(/payload\.(?:url|clickUrl)/);
    expect(source).not.toMatch(/notification\?\.data\?\.url/);
    expect(source).not.toMatch(/[?&](?:inbox|inboxId|inboxHandle)=/);
  });
});
