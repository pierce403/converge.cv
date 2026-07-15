import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/lib/stores';
import { formatDistanceToNow } from '@/lib/utils/date';
import {
  currentRelayDiagnosticRegistration,
  disablePush,
  enablePushForCurrentUser,
  getPushDiagnosticSnapshot,
  listenForPushDiagnosticReceipt,
  refreshPushRegistrationForCurrentInbox,
  sendRelayPushDiagnosticTest,
  testLocalPushNotificationDisplay,
  waitForRelayPushDiagnosticReceipt,
  type PushDiagnosticSnapshot,
} from '@/lib/push';
import { logNetworkEvent } from '@/lib/stores/debug-store';

type Feedback = { tone: 'info' | 'success' | 'error'; message: string };

function timeLabel(value: number | string | undefined): string {
  if (value === undefined) return 'never';
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(timestamp)
    ? formatDistanceToNow(timestamp, { addSuffix: true })
    : 'unknown';
}

function statusTone(ok: boolean, unknown = false): string {
  if (unknown) return 'text-primary-300';
  return ok ? 'text-green-300' : 'text-red-300';
}

export function PushDiagnosticsPanel() {
  const identity = useAuthStore((state) => state.identity);
  const [snapshot, setSnapshot] = useState<PushDiagnosticSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const awaitingTestId = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getPushDiagnosticSnapshot();
      setSnapshot(next);
      logNetworkEvent({
        direction: 'status',
        event: 'push:trace',
        details: `app=${next.app.state}; relay=${next.relay.deliveryReadiness}; registrations=${next.app.registeredInboxCount}/${next.app.expectedInboxCount}; findings=${next.findings.length}`,
      });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Push trace failed.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => listenForPushDiagnosticReceipt((receipt) => {
    const matched = receipt.source === 'relay' && receipt.testId === awaitingTestId.current;
    setFeedback({
      tone: matched ? 'success' : 'info',
      message: matched
        ? 'Relay test reached this service worker and displayed a notification.'
        : receipt.source === 'local'
          ? 'A local service worker display test completed.'
          : 'A relay push diagnostic reached this service worker.',
    });
    if (matched) awaitingTestId.current = null;
    void refresh();
  }), [refresh]);

  const runAction = async (name: string, operation: () => Promise<Feedback>) => {
    if (action) return;
    setAction(name);
    setFeedback({ tone: 'info', message: `${name} in progress...` });
    try {
      setFeedback(await operation());
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : `${name} failed.`,
      });
    } finally {
      setAction(null);
      await refresh();
    }
  };

  const handleEnable = () => runAction('Notification setup', async () => {
    const result = await enablePushForCurrentUser();
    if (!result.success) throw new Error(result.error || 'Notification setup failed.');
    return {
      tone: 'success',
      message: `Registered ${result.registeredInboxCount ?? 0} inbox(es) with ${result.topicCount ?? 0} topic(s).`,
    };
  });

  const handleReregister = () => runAction('Current inbox re-registration', async () => {
    if (!snapshot?.app.enabledPreference) {
      throw new Error('Enable notifications before re-registering the current inbox.');
    }
    const result = await refreshPushRegistrationForCurrentInbox({
      displayName: identity?.displayName,
    });
    if (!result.success) throw new Error(result.error || 'Re-registration failed.');
    return {
      tone: 'success',
      message: `Published a fresh current-inbox snapshot with ${result.topicCount ?? 0} topic(s).`,
    };
  });

  const handleLocalTest = () => runAction('Browser display test', async () => {
    await testLocalPushNotificationDisplay();
    return {
      tone: 'success',
      message: 'The service worker displayed a local test notification.',
    };
  });

  const handleRelayTest = () => runAction('Relay test', async () => {
    const registration = await currentRelayDiagnosticRegistration();
    if (!registration) throw new Error('No current-inbox relay registration matches this browser subscription.');
    const result = await sendRelayPushDiagnosticTest(registration);
    if (!result.queued) throw new Error('The relay did not queue the diagnostic push.');
    if (!result.testId) throw new Error('The relay test response did not include a test ID.');
    awaitingTestId.current = result.testId;
    try {
      await waitForRelayPushDiagnosticReceipt(result.testId);
      return {
        tone: 'success',
        message: 'Relay test reached the push provider, service worker, and notification display API.',
      };
    } finally {
      awaitingTestId.current = null;
    }
  });

  const handleDisable = () => runAction('Notification cleanup', async () => {
    const complete = await disablePush();
    return complete
      ? { tone: 'success', message: 'Relay records and the browser subscription were removed.' }
      : { tone: 'error', message: 'Notification cleanup is incomplete; refresh the trace and retry.' };
  });

  const permissionOk = snapshot?.permission === 'granted';
  const workerOk = snapshot?.serviceWorker.state === 'activated';
  const subscriptionOk = snapshot?.browserSubscription.present === true;
  const localRegistrationOk = snapshot?.app.state === 'enabled';
  const relayReady = snapshot?.relay.deliveryReadiness === 'ready';

  return (
    <section className="border border-primary-800/60 bg-primary-950/30">
      <header className="flex flex-col gap-3 border-b border-primary-800/60 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-primary-100">Push Trace</h2>
          <p className="mt-1 text-xs text-primary-300">
            Browser display, logical inbox routing, XMTP matching, and relay delivery are checked separately.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || Boolean(action)}
          className="btn-secondary text-xs"
        >
          {loading ? 'Refreshing...' : 'Refresh full trace'}
        </button>
      </header>

      <div className="divide-y divide-primary-800/60">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 py-4 text-sm md:grid-cols-2 xl:grid-cols-3">
          <div>
            <dt className="text-xs text-primary-300">1. Site permission</dt>
            <dd className={`mt-1 ${statusTone(permissionOk, !snapshot)}`}>{snapshot?.permission ?? 'checking'}</dd>
          </div>
          <div>
            <dt className="text-xs text-primary-300">2. Service worker</dt>
            <dd className={`mt-1 ${statusTone(workerOk, !snapshot)}`}>
              {snapshot ? `${snapshot.serviceWorker.state} (${snapshot.serviceWorker.scope} scope)` : 'checking'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-primary-300">3. Browser subscription</dt>
            <dd className={`mt-1 ${statusTone(subscriptionOk, !snapshot)}`}>
              {snapshot?.browserSubscription.present
                ? `active via ${snapshot.browserSubscription.providerHost || 'browser provider'}`
                : snapshot ? 'missing' : 'checking'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-primary-300">4. Local inbox registrations</dt>
            <dd className={`mt-1 ${statusTone(localRegistrationOk, !snapshot)}`}>
              {snapshot
                ? `${snapshot.app.registeredInboxCount}/${snapshot.app.expectedInboxCount} (${snapshot.app.state})`
                : 'checking'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-primary-300">5. XMTP relay pipeline</dt>
            <dd className={`mt-1 ${statusTone(relayReady, !snapshot)}`}>
              {snapshot
                ? `${snapshot.relay.deliveryReadiness}; listener ${snapshot.relay.listenerStatus || 'unknown'}; bridge ${snapshot.relay.bridgeStatus || 'unknown'}`
                : 'checking'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-primary-300">6. Last service worker receipt</dt>
            <dd className="mt-1 text-primary-100">
              {snapshot?.lastDiagnosticReceipt
                ? `${snapshot.lastDiagnosticReceipt.source} diagnostic ${timeLabel(snapshot.lastDiagnosticReceipt.receivedAt)}`
                : snapshot?.lastActivityAt
                  ? `XMTP activity ${timeLabel(snapshot.lastActivityAt)}`
                  : 'none recorded'}
            </dd>
          </div>
        </dl>

        <div className="px-4 py-4">
          <div className="flex flex-wrap gap-2">
            {!snapshot?.app.enabledPreference && (
              <button type="button" onClick={handleEnable} disabled={Boolean(action)} className="btn-primary">
                Enable notifications
              </button>
            )}
            <button
              type="button"
              onClick={handleReregister}
              disabled={Boolean(action) || !identity || !snapshot?.app.enabledPreference}
              className="btn-primary"
            >
              Re-register current inbox
            </button>
            <button type="button" onClick={handleLocalTest} disabled={Boolean(action)} className="btn-secondary">
              Test browser display
            </button>
            <button
              type="button"
              onClick={handleRelayTest}
              disabled={Boolean(action) || !snapshot?.app.enabledPreference}
              className="btn-secondary"
            >
              Send relay test
            </button>
            {snapshot?.app.enabledPreference && (
              <button type="button" onClick={handleDisable} disabled={Boolean(action)} className="btn-secondary">
                Disable notifications
              </button>
            )}
          </div>
          {feedback && (
            <p
              role={feedback.tone === 'error' ? 'alert' : 'status'}
              className={`mt-3 text-sm ${
                feedback.tone === 'error'
                  ? 'text-red-300'
                  : feedback.tone === 'success'
                    ? 'text-green-300'
                    : 'text-primary-200'
              }`}
            >
              {feedback.message}
            </p>
          )}
        </div>

        <div className="px-4 py-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-primary-200">Inbox routes</h3>
          {snapshot?.inboxes.length ? (
            <div className="mt-3 divide-y divide-primary-800/60 border-y border-primary-800/60">
              {snapshot.inboxes.map((inbox) => (
                <div key={`${inbox.label}-${inbox.updatedAt}`} className="grid gap-3 py-3 text-xs md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <div className="font-medium text-primary-100">
                      {inbox.label}{inbox.isCurrent ? ' (current)' : ''}
                    </div>
                    <div className="mt-1 text-primary-300">
                      local {inbox.localState}; refreshed {timeLabel(inbox.updatedAt)}
                    </div>
                  </div>
                  <div>
                    <div className="text-primary-300">Local topic snapshot</div>
                    <div className="mt-1 text-primary-100">
                      {inbox.groupTopicCount} groups; {inbox.hmacEpochCount} HMAC epochs; {inbox.welcomeTopicCount} welcome
                    </div>
                  </div>
                  <div>
                    <div className="text-primary-300">Relay snapshot</div>
                    <div className="mt-1 text-primary-100">
                      {inbox.relay.state === 'verified'
                        ? `${inbox.relay.groupTopicCount ?? '?'} groups; ${inbox.relay.hmacEpochCount ?? '?'} HMAC epochs; ${inbox.relay.coverage || 'unknown coverage'}; route ${inbox.relay.routeStatus || 'unknown'}`
                        : inbox.relay.detail}
                    </div>
                  </div>
                  <div>
                    <div className="text-primary-300">Last XMTP delivery</div>
                    <div className="mt-1 text-primary-100">
                      match {timeLabel(inbox.relay.lastMatchedAt)}; provider {inbox.relay.deliveryStatus || 'none'} {timeLabel(inbox.relay.providerAcceptedAt ?? inbox.relay.lastAttemptAt)}
                      {inbox.relay.failureCategory ? ` (${inbox.relay.failureCategory})` : ''}
                    </div>
                    <div className="mt-1 text-primary-300">
                      browser activity {timeLabel(inbox.lastActivityAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-primary-300">No local inbox push registrations.</p>
          )}
        </div>

        <div className="px-4 py-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-primary-200">Findings</h3>
          {snapshot?.findings.length ? (
            <ul className="mt-2 space-y-1 text-sm text-amber-200">
              {snapshot.findings.map((finding) => <li key={finding}>{finding}</li>)}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-green-300">No configuration gap was found in the current trace.</p>
          )}
          <p className="mt-3 text-xs text-primary-300">
            Messages sent from another installation of the same XMTP inbox are intentionally sender-suppressed. Test ordinary delivery from a different inbox. Provider accepted means Web Push accepted the request; only a service worker receipt proves this browser received it.
          </p>
        </div>
      </div>
    </section>
  );
}
