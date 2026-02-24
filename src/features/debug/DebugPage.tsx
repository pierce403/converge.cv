import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useAuthStore,
  useConversationStore,
  useDebugStore,
  useXmtpStore,
} from '@/lib/stores';
import { formatDistanceToNow } from '@/lib/utils/date';
import { getXmtpClient } from '@/lib/xmtp';
import { WebWorkersPanel } from './WebWorkersPanel';
import { KeyExplorerModal } from './KeyExplorerModal';
import { IgnoredConversationsModal } from './IgnoredConversationsModal';
import { DatabaseExplorerPanel } from './DatabaseExplorerPanel';
import buildInfo from '../../build-info.json'; // Import build info
import { registerServiceWorkerForPush, enablePushForCurrentUser, disablePush, VAPID_PARTY_API_KEY, VAPID_PUBLIC_KEY } from '@/lib/push';
import { VAPID_PARTY_API_BASE } from '@/lib/push/config';
import { logNetworkEvent } from '@/lib/stores/debug-store';
import {
  extractConvosInviteCode,
  parseConvosInvite,
  sanitizeConvosInviteCode,
  type ParsedConvosInvite,
} from '@/lib/utils/convos-invite';
import { useConversations } from '@/features/conversations/useConversations';
import { useMessages } from '@/features/messages/useMessages';

export function DebugPage() {
  const navigate = useNavigate();
  const consoleEntries = useDebugStore((state) => state.consoleEntries);
  const networkEntries = useDebugStore((state) => state.networkEntries);
  const errorEntries = useDebugStore((state) => state.errorEntries);
  const clearConsole = useDebugStore((state) => state.clearConsole);
  const clearNetwork = useDebugStore((state) => state.clearNetwork);
  const clearErrors = useDebugStore((state) => state.clearErrors);
  const clearAll = useDebugStore((state) => state.clearAll);

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isVaultUnlocked = useAuthStore((state) => state.isVaultUnlocked);
  const identity = useAuthStore((state) => state.identity);

  const { createConversation } = useConversations();
  const { sendMessage } = useMessages();

  const conversationSummary = useConversationStore((state) => ({
    total: state.conversations.length,
    pinned: state.conversations.filter((conversation) => conversation.pinned).length,
    archived: state.conversations.filter((conversation) => conversation.archived).length,
    isLoading: state.isLoading,
  }));

  const { connectionStatus, lastConnected, error: xmtpError } = useXmtpStore();

  const reversedConsole = useMemo(() => consoleEntries.slice().reverse(), [consoleEntries]);
  const reversedNetwork = useMemo(() => networkEntries.slice().reverse(), [networkEntries]);
  const reversedErrors = useMemo(() => errorEntries.slice().reverse(), [errorEntries]);

  // Push Debug local state
  const [pushPermission, setPushPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default',
  );
  const [swRegistered, setSwRegistered] = useState<boolean>(false);
  const [swScope, setSwScope] = useState<string>('');
  const [subscriptionEndpoint, setSubscriptionEndpoint] = useState<string>('');
  const [backendReachable, setBackendReachable] = useState<string>('unknown');
  const [isKeyExplorerOpen, setIsKeyExplorerOpen] = useState(false);
  const [isIgnoredModalOpen, setIsIgnoredModalOpen] = useState(false);
  const [inviteInput, setInviteInput] = useState('');
  const [inviteDetails, setInviteDetails] = useState<ParsedConvosInvite | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [inviteSending, setInviteSending] = useState(false);
  const [deepSyncRunning, setDeepSyncRunning] = useState(false);

  async function refreshPushStatus() {
    try {
      const perm = typeof Notification !== 'undefined' ? Notification.permission : 'default';
      setPushPermission(perm);
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        setSwRegistered(true);
        setSwScope(reg.scope || '');
        const sub = await reg.pushManager.getSubscription();
        setSubscriptionEndpoint(sub?.endpoint || '');
      } else {
        setSwRegistered(false);
        setSwScope('');
        setSubscriptionEndpoint('');
      }
      // Check vapid.party API health
      if (VAPID_PARTY_API_KEY) {
        try {
          const res = await fetch(`${VAPID_PARTY_API_BASE}/vapid/public-key`, { 
            method: 'GET',
            headers: { 'X-API-Key': VAPID_PARTY_API_KEY }
          });
          setBackendReachable(`${res.status} ${res.ok ? 'OK' : 'ERR'}`);
          logNetworkEvent({ direction: 'status', event: 'push:health', details: `GET vapid.party → ${res.status}` });
        } catch (e) {
          setBackendReachable('unreachable');
          logNetworkEvent({ direction: 'status', event: 'push:health', details: 'vapid.party unreachable' });
        }
      } else {
        setBackendReachable('API key not configured');
      }
    } catch (e) {
      // swallow – this is debug UI
    }
  }

  async function handleClaimInvite() {
    setInviteError(null);
    setInviteSuccess(null);

    if (!inviteInput.trim()) {
      setInviteError('Enter an invite link or code.');
      return;
    }

    const extractedCode = extractConvosInviteCode(inviteInput);
    const sanitizedCode = extractedCode ? sanitizeConvosInviteCode(extractedCode) : null;

    console.log('[Invite Claim] Raw input:', inviteInput);
    console.log('[Invite Claim] Extracted code:', extractedCode);
    console.log('[Invite Claim] Sanitized code:', sanitizedCode);
    if (extractedCode && sanitizedCode && extractedCode !== sanitizedCode) {
      console.log('[Invite Claim] Sanitized diff:', {
        originalLength: extractedCode.length,
        sanitizedLength: sanitizedCode.length,
      });
    }

    if (!isAuthenticated || !isVaultUnlocked) {
      setInviteError('Sign in and unlock your inbox before claiming an invite.');
      return;
    }

    let parsed: ParsedConvosInvite;
    try {
      parsed = parseConvosInvite(inviteInput);
      setInviteDetails(parsed);
      console.log('[Invite Claim] Parsed payload:', parsed.payload);
    } catch (error) {
      console.log('[Invite Claim] Parse error:', error);
      setInviteError(error instanceof Error ? error.message : 'Invalid invite code.');
      return;
    }

    if (!parsed.payload.creatorInboxId) {
      setInviteError('Invite is missing the creator inbox ID.');
      return;
    }

    setInviteSending(true);
    try {
      console.log('[Invite Claim] Creating DM with creator:', parsed.payload.creatorInboxId);
      const conversation = await createConversation(parsed.payload.creatorInboxId);
      if (!conversation) {
        throw new Error('Failed to create DM with the invite creator.');
      }

      console.log('[Invite Claim] DM ready:', {
        conversationId: conversation.id,
        peerId: conversation.peerId,
      });
      console.log('[Invite Claim] Sending invite slug…');
      await sendMessage(conversation.id, parsed.inviteCode);
      console.log('[Invite Claim] Invite slug sent.');

      logNetworkEvent({
        direction: 'outbound',
        event: 'invite:claim',
        details: `Sent invite code to ${parsed.payload.creatorInboxId}`,
      });

      setInviteSuccess('Invite sent. Waiting for the inviter to accept.');
      console.log('[Invite Claim] Navigating to conversation:', conversation.id);
      navigate(`/chat/${conversation.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send invite.';
      console.log('[Invite Claim] Error sending invite:', error);
      setInviteError(message);
      logNetworkEvent({
        direction: 'status',
        event: 'invite:claim',
        details: message,
      });
    } finally {
      setInviteSending(false);
    }
  }


  return (
    <div className="min-h-full bg-primary-950/90 text-primary-50">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Debug Console</h1>
            <p className="text-sm text-primary-200">
              Inspect application state, XMTP activity, and runtime issues captured in the app.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-primary-200">
            <span className="rounded-full bg-primary-900/60 px-3 py-1">
              {consoleEntries.length} console log{consoleEntries.length === 1 ? '' : 's'}
            </span>
            <span className="rounded-full bg-primary-900/60 px-3 py-1">
              {networkEntries.length} network event{networkEntries.length === 1 ? '' : 's'}
            </span>
            <span className="rounded-full bg-primary-900/60 px-3 py-1">
              {errorEntries.length} error{errorEntries.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={async () => {
                // Clear all caches
                if ('caches' in window) {
                  const cacheNames = await caches.keys();
                  await Promise.all(cacheNames.map(name => caches.delete(name)));
                }
                // Clear service worker and reload
                if ('serviceWorker' in navigator) {
                  const registrations = await navigator.serviceWorker.getRegistrations();
                  await Promise.all(registrations.map(reg => reg.unregister()));
                }
                // Hard reload
                window.location.reload();
              }}
              className="ml-auto rounded-full border border-accent-600/60 bg-accent-900/30 px-3 py-1 text-accent-100 hover:border-accent-500 hover:bg-accent-800/40"
              title="Clear all caches and reload"
            >
              Hard Refresh
            </button>
            <button
              type="button"
              onClick={() => setIsKeyExplorerOpen(true)}
              className="rounded-full border border-primary-800/60 bg-primary-950/30 px-3 py-1 text-primary-100 hover:border-primary-700"
            >
              Key Explorer
            </button>
            <button
              type="button"
              onClick={() => setIsIgnoredModalOpen(true)}
              className="rounded-full border border-primary-800/60 bg-primary-950/30 px-3 py-1 text-primary-100 hover:border-primary-700"
            >
              Ignored conversations
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="rounded-full border border-primary-800/60 bg-primary-950/30 px-3 py-1 text-primary-100 hover:border-primary-700"
            >
              Clear all logs
            </button>
          </div>
        </header>

        {/* Build Info */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-xl border border-primary-800/60 bg-primary-950/30 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-primary-200">Build Info</h2>
            <dl className="mt-2 space-y-1 text-sm text-primary-100">
              <div className="flex items-center justify-between">
                <dt>Version</dt>
                <dd>{buildInfo.version}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Build Time</dt>
                <dd>{new Date(buildInfo.buildTime).toLocaleString()}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Commit</dt>
                <dd>
                  <a
                    href={`https://github.com/pierce403/converge.cv/commit/${buildInfo.gitHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-300 hover:underline"
                  >
                    {buildInfo.gitHash}
                  </a>
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Branch</dt>
                <dd>{buildInfo.gitBranch}</dd>
              </div>
            </dl>
          </article>
        </section>

        {/* Invite Tools */}
        <section className="rounded-xl border border-primary-800/60 bg-primary-950/30">
          <header className="flex items-center justify-between border-b border-primary-800/60 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary-100">Invite Tools</h2>
            <div className="text-xs text-primary-300">Convos invite claim</div>
          </header>
          <div className="px-4 py-4 space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-primary-300">
                Invite link or code
              </label>
              <textarea
                value={inviteInput}
                onChange={(event) => setInviteInput(event.target.value)}
                className="min-h-[120px] w-full rounded-lg border border-primary-800/60 bg-primary-900/40 px-3 py-2 text-sm text-primary-100 placeholder:text-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                placeholder="Paste https://popup.convos.org/v2?i=... or the raw invite code"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleClaimInvite}
                  className="btn-primary"
                  disabled={inviteSending}
                >
                  {inviteSending ? 'Claiming…' : 'Claim Invite Code'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInviteInput('');
                    setInviteDetails(null);
                    setInviteError(null);
                    setInviteSuccess(null);
                  }}
                  className="btn-secondary"
                >
                  Clear
                </button>
              </div>
              {inviteError && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {inviteError}
                </div>
              )}
              {inviteSuccess && (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                  {inviteSuccess}
                </div>
              )}
            </div>
            {inviteDetails && (
              <div className="rounded-lg border border-primary-800/60 bg-primary-900/40 p-3 text-xs text-primary-100">
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <div className="text-primary-300">Creator inbox</div>
                    <div className="break-all font-mono">{inviteDetails.payload.creatorInboxId}</div>
                  </div>
                  <div>
                    <div className="text-primary-300">Invite tag</div>
                    <div className="break-all font-mono">
                      {inviteDetails.payload.tag || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-primary-300">Group name</div>
                    <div className="break-all">{inviteDetails.payload.name || '—'}</div>
                  </div>
                  <div>
                    <div className="text-primary-300">Invite code</div>
                    <div className="break-all font-mono">{inviteDetails.inviteCode}</div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-primary-300">Image URL</div>
                    <div className="break-all">{inviteDetails.payload.imageUrl || '—'}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Push Debug */}
        <section className="rounded-xl border border-primary-800/60 bg-primary-950/30">
          <header className="flex items-center justify-between border-b border-primary-800/60 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary-100">Push Debug</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={refreshPushStatus}
                className="rounded-lg border border-primary-800/60 px-3 py-1 text-xs text-primary-100 hover:border-primary-700"
              >
                Refresh
              </button>
            </div>
          </header>
          <div className="px-4 py-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 text-sm">
            <div className="rounded-lg bg-primary-900/40 p-3">
              <div className="text-primary-300">VAPID Public Key</div>
              <div className="mt-1 text-primary-100 break-all text-xs">{VAPID_PUBLIC_KEY ? `${VAPID_PUBLIC_KEY.slice(0, 20)}...` : 'not set'}</div>
            </div>
            <div className="rounded-lg bg-primary-900/40 p-3">
              <div className="text-primary-300">vapid.party API</div>
              <div className="mt-1 text-primary-100 break-all">{VAPID_PARTY_API_KEY ? 'configured ✓' : 'not set'}</div>
            </div>
            <div className="rounded-lg bg-primary-900/40 p-3">
              <div className="text-primary-300">Notification Permission</div>
              <div className="mt-1 text-primary-100">{pushPermission}</div>
            </div>
            <div className="rounded-lg bg-primary-900/40 p-3">
              <div className="text-primary-300">Service Worker</div>
              <div className="mt-1 text-primary-100">{swRegistered ? `registered (${swScope})` : 'not registered'}</div>
            </div>
            <div className="rounded-lg bg-primary-900/40 p-3">
              <div className="text-primary-300">Subscription</div>
              <div className="mt-1 text-primary-100 break-all text-xs">
                {subscriptionEndpoint ? subscriptionEndpoint : 'none'}
              </div>
            </div>
            <div className="rounded-lg bg-primary-900/40 p-3">
              <div className="text-primary-300">vapid.party Status</div>
              <div className="mt-1 text-primary-100">{backendReachable}</div>
            </div>
          </div>
          <div className="px-4 pb-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={async () => {
                  const reg = await registerServiceWorkerForPush();
                  logNetworkEvent({ direction: 'status', event: 'push:sw_register', details: reg ? `scope=${reg.scope}` : 'failed' });
                  await refreshPushStatus();
                }}
                className="btn-secondary"
              >
                Register SW
              </button>
              <button
                type="button"
                onClick={async () => {
                  const userId = identity?.inboxId || identity?.address || 'unknown';
                  const result = await enablePushForCurrentUser({ userId, channelId: 'default' });
                  logNetworkEvent({ direction: 'outbound', event: 'push:enable', details: result.success ? 'subscribed' : result.error || 'failed', payload: result.endpoint ? JSON.stringify({ endpoint: result.endpoint }) : undefined });
                  await refreshPushStatus();
                }}
                className="btn-primary"
                disabled={!identity}
              >
                Enable Push
              </button>
              <button
                type="button"
                onClick={async () => {
                  await disablePush();
                  logNetworkEvent({ direction: 'outbound', event: 'push:disable', details: 'unsubscribed' });
                  await refreshPushStatus();
                }}
                className="btn-secondary"
                disabled={!identity}
              >
                Disable Push
              </button>
              <button
                type="button"
                onClick={async () => {
                  await refreshPushStatus();
                }}
                className="btn-secondary"
              >
                Check Subscription
              </button>
              <button
                type="button"
                onClick={async () => {
                  console.info('[Push] Test Push: sending a notification via vapid.party to this browser subscription.');
                  if (!VAPID_PARTY_API_KEY) {
                    console.warn('[Push] Test Push: missing VAPID_PARTY_API_KEY');
                    logNetworkEvent({ direction: 'status', event: 'push:test', details: 'API key not configured' });
                    return;
                  }

                  if (!identity) {
                    console.warn('[Push] Test Push: no identity loaded; cannot determine userId. Sign in and enable push first.');
                    logNetworkEvent({ direction: 'status', event: 'push:test', details: 'No identity loaded (missing userId)' });
                    return;
                  }

                  try {
                    const userIdCandidates = Array.from(
                      new Set([identity.inboxId, identity.address].filter((value): value is string => Boolean(value))),
                    );
                    const absoluteUrl = (() => {
                      try {
                        return new URL('/', window.location.origin).toString();
                      } catch {
                        return 'https://converge.cv/';
                      }
                    })();

                    // Log local prereqs (SW + subscription) so we can debug “no-op” reports.
                    try {
                      const reg = await navigator.serviceWorker.getRegistration();
                      if (!reg) {
                        console.warn('[Push] Test Push: no service worker registration found. Click “Register SW” or “Enable Push” first.');
                        logNetworkEvent({ direction: 'status', event: 'push:test:prereq', details: 'No service worker registration' });
                      } else {
                        const sub = await reg.pushManager.getSubscription();
                        const endpoint = sub?.endpoint ? `${sub.endpoint.slice(0, 48)}…` : '(none)';
                        console.info('[Push] Test Push: SW ready', { scope: reg.scope, subscription: endpoint });
                        logNetworkEvent({ direction: 'status', event: 'push:test:prereq', details: `SW scope=${reg.scope} subscription=${endpoint}` });
                      }
                    } catch (e) {
                      console.warn('[Push] Test Push: failed to inspect SW/subscription', e);
                      logNetworkEvent({ direction: 'status', event: 'push:test:prereq', details: 'Failed to inspect SW/subscription' });
                    }

                    let attempt = 0;
                    for (const userId of userIdCandidates) {
                      attempt += 1;
                      const body = {
                        payload: {
                          title: 'Converge Test',
                          body: 'This is a test notification from Debug console',
                          // vapid.party validates this as a URL, so it must be absolute.
                          url: absoluteUrl,
                        },
                        userId,
                        channelId: 'default',
                      };

                      console.info('[Push] Test Push: POST /send', {
                        base: VAPID_PARTY_API_BASE,
                        userId,
                        channelId: 'default',
                        url: absoluteUrl,
                        apiKey: `${VAPID_PARTY_API_KEY.slice(0, 6)}…`,
                        attempt,
                        attemptsTotal: userIdCandidates.length,
                      });
                      logNetworkEvent({
                        direction: 'outbound',
                        event: 'push:test:request',
                        details: `POST vapid.party/send (attempt ${attempt}/${userIdCandidates.length})`,
                        payload: JSON.stringify({ ...body, apiKey: '[redacted]' }),
                      });

                      const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
                      const res = await fetch(`${VAPID_PARTY_API_BASE}/send`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'X-API-Key': VAPID_PARTY_API_KEY,
                        },
                        body: JSON.stringify(body),
                      });
                      const responseText = await res.text();
                      const elapsedMs = Math.max(
                        0,
                        Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt),
                      );

                      if (!res.ok) {
                        console.error('[Push] Test Push: non-OK response', { status: res.status, body: responseText, attempt });
                      } else {
                        console.info('[Push] Test Push: request accepted', { status: res.status, elapsedMs, attempt });
                      }

                      logNetworkEvent({
                        direction: 'inbound',
                        event: 'push:test:response',
                        details: `POST vapid.party/send → ${res.status} (${elapsedMs}ms) (attempt ${attempt}/${userIdCandidates.length})`,
                        payload: responseText,
                      });

                      // Best-effort parse for a friendlier log line and retry logic.
                      let total = 0;
                      try {
                        const json = JSON.parse(responseText) as {
                          success?: boolean;
                          data?: { sent?: number; failed?: number; total?: number };
                          error?: string;
                          code?: string;
                        };
                        if (json?.success) {
                          total = typeof json.data?.total === 'number' ? json.data.total : 0;
                          console.info('[Push] Test Push: send result', { ...(json.data ?? {}), attempt, userId });
                        } else if (json?.error) {
                          console.warn('[Push] Test Push: send rejected', { code: json.code, error: json.error, attempt, userId });
                        }
                      } catch {
                        // ignore
                      }

                      // If no subscriptions matched, try the next identifier (e.g., address vs inboxId).
                      if (res.ok && total === 0 && attempt < userIdCandidates.length) {
                        console.warn('[Push] Test Push: no subscriptions matched; retrying with alternate userId', { attempt, userId });
                        continue;
                      }

                      break;
                    }
                  } catch (e) {
                    console.error('[Push] Test Push: POST vapid.party/send failed', e);
                    logNetworkEvent({
                      direction: 'outbound',
                      event: 'push:test:error',
                      details: e instanceof Error ? e.message : 'POST vapid.party/send failed',
                    });
                  } finally {
                    await refreshPushStatus();
                  }
                }}
                className="btn-secondary"
                disabled={!VAPID_PARTY_API_KEY || !identity}
              >
                Send Test Push
              </button>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-xl border border-primary-800/60 bg-primary-950/30 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-primary-200">Auth</h2>
            <p className="mt-2 text-lg font-semibold">
              {isAuthenticated ? 'Authenticated' : 'Not authenticated'}
            </p>
            <p className="text-sm text-primary-200">{isVaultUnlocked ? 'Vault unlocked' : 'Vault locked'}</p>
          </article>

          <article className="rounded-xl border border-primary-800/60 bg-primary-950/30 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-primary-200">Identity</h2>
            <p className="mt-2 text-lg font-semibold truncate" title={identity?.address || '—'}>
              {identity?.address ?? '—'}
            </p>
            <p className="text-sm text-primary-200 truncate" title={identity?.displayName || 'No display name'}>
              {identity?.displayName ?? 'No display name'}
            </p>
          </article>

          <article className="rounded-xl border border-primary-800/60 bg-primary-950/30 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-primary-200">Conversations</h2>
            <dl className="mt-2 space-y-1 text-sm text-primary-100">
              <div className="flex items-center justify-between">
                <dt>Total</dt>
                <dd>{conversationSummary.total}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Pinned</dt>
                <dd>{conversationSummary.pinned}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Archived</dt>
                <dd>{conversationSummary.archived}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Status</dt>
                <dd>{conversationSummary.isLoading ? 'Loading…' : 'Idle'}</dd>
              </div>
            </dl>
          </article>

          <article className="rounded-xl border border-primary-800/60 bg-primary-950/30 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-primary-200">XMTP</h2>
            <p className="mt-2 text-lg font-semibold capitalize">{connectionStatus}</p>
            <p className="text-sm text-primary-200">
              Last connected {lastConnected ? formatDistanceToNow(lastConnected) : 'never'}
            </p>
            {xmtpError && <p className="mt-1 text-sm text-red-400">{xmtpError}</p>}
            <button
              type="button"
              disabled={connectionStatus !== 'connected' || deepSyncRunning}
              onClick={async () => {
                if (deepSyncRunning) return;
                const confirmed = window.confirm(
                  'Run deep history sync?\n\nThis can be slow and may trigger a lot of network traffic. It is not required for normal usage.'
                );
                if (!confirmed) return;

                setDeepSyncRunning(true);
                logNetworkEvent({
                  direction: 'status',
                  event: 'history:deep_sync',
                  details: 'Starting full history sync',
                });

                try {
                  await getXmtpClient().runFullHistorySync();
                  logNetworkEvent({
                    direction: 'status',
                    event: 'history:deep_sync',
                    details: 'Full history sync complete',
                  });
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
                  logNetworkEvent({
                    direction: 'status',
                    event: 'history:deep_sync',
                    details: `Full history sync failed: ${message}`,
                  });
                } finally {
                  setDeepSyncRunning(false);
                }
              }}
              className="mt-3 rounded-lg border border-primary-800/60 px-3 py-1 text-xs text-primary-100 hover:border-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              title="Run a full history backfill (debug-only)"
            >
              {deepSyncRunning ? 'Running deep sync…' : 'Run Deep History Sync'}
            </button>
            <p className="mt-2 text-xs text-primary-300">
              Warning: This may take minutes and will retry network sync. Prefer the default local-first mode.
            </p>
          </article>
        </section>

        <WebWorkersPanel />

        <DatabaseExplorerPanel />

        <section className="rounded-xl border border-primary-800/60 bg-primary-950/30">
          <header className="flex items-center justify-between border-b border-primary-800/60 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary-100">Network Log</h2>
            <button
              type="button"
              onClick={clearNetwork}
              className="rounded-lg border border-primary-800/60 px-3 py-1 text-xs text-primary-100 hover:border-primary-700"
            >
              Clear network log
            </button>
          </header>
          <div className="max-h-80 overflow-y-auto">
            {reversedNetwork.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-primary-300">
                XMTP requests and responses will appear here.
              </p>
            ) : (
              <ul className="divide-y divide-primary-800/60">
                {reversedNetwork.map((entry) => (
                  <li key={entry.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between text-xs uppercase tracking-wide">
                      <span
                        className={
                          entry.direction === 'outbound'
                            ? 'font-semibold text-accent-300'
                            : entry.direction === 'inbound'
                              ? 'font-semibold text-emerald-400'
                              : 'font-semibold text-primary-200'
                        }
                      >
                        {entry.direction}
                      </span>
                      <span className="text-primary-300">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="mt-1 text-base font-medium text-primary-100">{entry.event}</p>
                    {entry.details && <p className="mt-1 text-xs text-primary-200">{entry.details}</p>}
                    {entry.payload && (
                      <pre className="mt-2 overflow-x-auto rounded-lg bg-primary-900/70 p-3 text-[11px] leading-relaxed text-primary-100">
                        {entry.payload}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-primary-800/60 bg-primary-950/30">
          <header className="flex items-center justify-between border-b border-primary-800/60 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary-100">Console Log</h2>
            <button
              type="button"
              onClick={clearConsole}
              className="rounded-lg border border-primary-800/60 px-3 py-1 text-xs text-primary-100 hover:border-primary-700"
            >
              Clear console log
            </button>
          </header>
          <div className="max-h-80 overflow-y-auto">
            {reversedConsole.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-primary-300">
                Console output from the running app will appear here.
              </p>
            ) : (
              <ul className="divide-y divide-primary-800/60">
                {reversedConsole.map((entry) => (
                  <li key={entry.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between text-xs uppercase tracking-wide">
                      <span
                        className={
                          entry.level === 'error'
                            ? 'font-semibold text-red-400'
                            : entry.level === 'warn'
                              ? 'font-semibold text-yellow-400'
                              : entry.level === 'info'
                                ? 'font-semibold text-accent-300'
                                : 'font-semibold text-primary-200'
                        }
                      >
                        {entry.level}
                      </span>
                      <span className="text-primary-300">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="mt-2 text-primary-100 whitespace-pre-wrap break-words">{entry.message}</p>
                    {entry.details && (
                      <pre className="mt-2 overflow-x-auto rounded-lg bg-primary-900/70 p-3 text-[11px] leading-relaxed text-primary-100">
                        {entry.details}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-primary-800/60 bg-primary-950/30">
          <header className="flex items-center justify-between border-b border-primary-800/60 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary-100">Error Log</h2>
            <button
              type="button"
              onClick={clearErrors}
              className="rounded-lg border border-primary-800/60 px-3 py-1 text-xs text-primary-100 hover:border-primary-700"
            >
              Clear error log
            </button>
          </header>
          <div className="max-h-80 overflow-y-auto">
            {reversedErrors.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-primary-300">
                Runtime errors, stack traces, and unhandled rejections will be captured here.
              </p>
            ) : (
              <ul className="divide-y divide-primary-800/60">
                {reversedErrors.map((entry) => (
                  <li key={entry.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between text-xs uppercase tracking-wide">
                      <span className="font-semibold text-red-400">{entry.source}</span>
                      <span className="text-primary-300">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="mt-2 text-base font-semibold text-primary-100">{entry.message}</p>
                    {entry.details && <p className="mt-1 text-xs text-primary-200">{entry.details}</p>}
                    {entry.stack && (
                      <pre className="mt-2 overflow-x-auto rounded-lg bg-red-950/40 p-3 text-[11px] leading-relaxed text-red-100">
                        {entry.stack}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
      <KeyExplorerModal isOpen={isKeyExplorerOpen} onClose={() => setIsKeyExplorerOpen(false)} />
      <IgnoredConversationsModal isOpen={isIgnoredModalOpen} onClose={() => setIsIgnoredModalOpen(false)} />
    </div>
  );
}
