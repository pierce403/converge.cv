import { useEffect, useMemo, useState } from 'react';
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
import {
  registerServiceWorkerForPush,
  enablePushForCurrentUser,
  disablePush,
  getBrowserPushSubscriptionState,
  preparePushBrowserResources,
  VAPID_PARTY_API_BASE,
  VAPID_PARTY_XMTP_PUBLIC_KEY_PATH,
  VAPID_PUBLIC_KEY,
} from '@/lib/push';
import { logNetworkEvent } from '@/lib/stores/debug-store';
import {
  extractConvosInviteCode,
  parseConvosInvite,
  sanitizeConvosInviteCode,
  type ParsedConvosInvite,
} from '@/lib/utils/convos-invite';
import { useConversations } from '@/features/conversations/useConversations';

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

  const { requestConvosInviteJoin } = useConversations();

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
  const [pushProvider, setPushProvider] = useState<string>('browser default');
  const [backendReachable, setBackendReachable] = useState<string>('unknown');
  const [pushPreparation, setPushPreparation] = useState<'preparing' | 'ready' | 'retry'>('preparing');
  const [isPushEnabling, setIsPushEnabling] = useState(false);
  const [pushAttempt, setPushAttempt] = useState('not run');
  const [isKeyExplorerOpen, setIsKeyExplorerOpen] = useState(false);
  const [isIgnoredModalOpen, setIsIgnoredModalOpen] = useState(false);
  const [inviteInput, setInviteInput] = useState('');
  const [inviteDetails, setInviteDetails] = useState<ParsedConvosInvite | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [inviteSending, setInviteSending] = useState(false);
  const [deepSyncRunning, setDeepSyncRunning] = useState(false);

  useEffect(() => {
    if (typeof Notification === 'undefined') {
      setPushPreparation('retry');
      return;
    }
    let cancelled = false;
    void preparePushBrowserResources()
      .then(() => {
        if (!cancelled) setPushPreparation('ready');
      })
      .catch(() => {
        if (!cancelled) setPushPreparation('retry');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshPushStatus() {
    try {
      const perm = typeof Notification !== 'undefined' ? Notification.permission : 'default';
      setPushPermission(perm);
      const { registration: reg, subscription: sub } = await getBrowserPushSubscriptionState();
      if (reg) {
        setSwRegistered(true);
        setSwScope(reg.scope || '');
        setSubscriptionEndpoint(sub?.endpoint ? new URL(sub.endpoint).host : '');
      } else {
        setSwRegistered(false);
        setSwScope('');
        setSubscriptionEndpoint('');
      }
      const braveApi = (navigator as Navigator & {
        brave?: { isBrave?: () => Promise<boolean> };
      }).brave;
      const isBrave = braveApi?.isBrave ? await braveApi.isBrave().catch(() => false) : false;
      setPushProvider(isBrave
        ? "Brave detected; its browser-wide provider setting is not exposed to websites. Verify 'Use Google services for push messaging', then fully quit/reopen Brave"
        : 'Browser default; provider availability is not exposed to websites');
      // Check both the generic Worker health and the public XMTP push surface.
      try {
        const healthUrl = `${VAPID_PARTY_API_BASE}/health`;
        const keyUrl = `${VAPID_PARTY_API_BASE}${VAPID_PARTY_XMTP_PUBLIC_KEY_PATH}`;
        const [health, key] = await Promise.all([
          fetch(healthUrl, { method: 'GET' }),
          fetch(keyUrl, { method: 'GET' }),
        ]);
        setBackendReachable(
          `health ${health.status}; XMTP VAPID ${key.status} ${health.ok && key.ok ? 'OK' : 'ERR'}`,
        );
        logNetworkEvent({
          direction: 'status',
          event: 'push:health',
          details: `GET health -> ${health.status}; GET XMTP VAPID key -> ${key.status}`,
        });
      } catch (e) {
        setBackendReachable('unreachable');
        logNetworkEvent({ direction: 'status', event: 'push:health', details: 'vapid.party health unreachable' });
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
      console.log('[Invite Claim] Sending Convos join_request to creator:', parsed.payload.creatorInboxId);
      const conversation = await requestConvosInviteJoin(parsed.inviteCode);
      if (!conversation) {
        throw new Error('Failed to send invite request.');
      }

      console.log('[Invite Claim] Join request sent through DM:', {
        conversationId: conversation.id,
        peerId: conversation.peerId,
      });

      logNetworkEvent({
        direction: 'outbound',
        event: 'invite:claim',
        details: `Sent Convos join_request to ${parsed.payload.creatorInboxId}`,
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
                // Refresh workers without destroying their push subscriptions.
                if ('serviceWorker' in navigator) {
                  const registrations = await navigator.serviceWorker.getRegistrations();
                  await Promise.allSettled(registrations.map((reg) => reg.update()));
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
              <div className="mt-1 text-primary-100 break-all text-xs">
                {VAPID_PUBLIC_KEY ? `${VAPID_PUBLIC_KEY.slice(0, 20)}...` : `fetch ${VAPID_PARTY_XMTP_PUBLIC_KEY_PATH}`}
              </div>
            </div>
            <div className="rounded-lg bg-primary-900/40 p-3">
              <div className="text-primary-300">vapid.party API Base</div>
              <div className="mt-1 text-primary-100 break-all text-xs">{VAPID_PARTY_API_BASE}</div>
            </div>
            <div className="rounded-lg bg-primary-900/40 p-3">
              <div className="text-primary-300">Site Display Permission</div>
              <div className="mt-1 text-primary-100">
                {pushPermission === 'granted' ? 'granted (converge.cv allowed)' : pushPermission}
              </div>
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
              <div className="text-primary-300">Web Push Provider</div>
              <div className="mt-1 text-primary-100 break-words text-xs">{pushProvider}</div>
            </div>
            <div className="rounded-lg bg-primary-900/40 p-3">
              <div className="text-primary-300">vapid.party Status</div>
              <div className="mt-1 text-primary-100">{backendReachable}</div>
            </div>
            <div className="rounded-lg bg-primary-900/40 p-3">
              <div className="text-primary-300">Last Enable Attempt</div>
              <div className="mt-1 text-primary-100 break-words text-xs">{pushAttempt}</div>
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
                  if (isPushEnabling) return;
                  setIsPushEnabling(true);
                  setPushAttempt('running');
                  try {
                    if (pushPreparation !== 'ready') {
                      setPushPreparation('preparing');
                      await preparePushBrowserResources();
                      setPushPreparation('ready');
                      setPushAttempt('browser resources ready; click Enable Push again');
                      return;
                    }
                    const result = await enablePushForCurrentUser();
                    const details = result.success
                      ? `registered ${result.topicCount ?? 0} topic(s)`
                      : result.error || 'failed';
                    setPushAttempt(details);
                    logNetworkEvent({
                      direction: 'outbound',
                      event: 'push:enable',
                      details,
                      payload: result.endpoint
                        ? JSON.stringify({ endpointHost: new URL(result.endpoint).host })
                        : undefined,
                    });
                    await refreshPushStatus();
                  } catch (error) {
                    const details = error instanceof Error ? error.message : 'preparation failed';
                    setPushPreparation('retry');
                    setPushAttempt(details);
                    logNetworkEvent({
                      direction: 'status',
                      event: 'push:prepare',
                      details,
                    });
                  } finally {
                    setIsPushEnabling(false);
                  }
                }}
                className="btn-primary"
                disabled={!identity || pushPreparation === 'preparing' || isPushEnabling}
              >
                {isPushEnabling
                  ? 'Enabling...'
                  : pushPreparation === 'retry'
                    ? 'Retry Push Setup'
                    : 'Enable Push'}
              </button>
              <button
                type="button"
                onClick={async () => {
                  const disabled = await disablePush();
                  logNetworkEvent({
                    direction: 'outbound',
                    event: 'push:disable',
                    details: disabled ? 'relay records deleted and browser unsubscribed' : 'cleanup incomplete',
                  });
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
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-xl border border-primary-800/60 bg-primary-950/30 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-primary-200">Auth</h2>
            <p className="mt-2 text-lg font-semibold">
              {isAuthenticated ? 'Authenticated' : 'Not authenticated'}
            </p>
            <p className="text-sm text-primary-200">
              {isVaultUnlocked ? 'Local identity available' : 'Local identity unavailable'}
            </p>
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
