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

  it('focuses the app without encoding an inbox switch decision in the click URL', () => {
    expect(source).toContain("self.addEventListener('notificationclick'");
    expect(source).not.toMatch(/[?&](?:inbox|inboxId|inboxHandle)=/);
  });
});
