import { useEffect, useMemo, useState } from 'react';
import { getXmtpClient } from '@/lib/xmtp';
import { useContactStore, useFarcasterStore } from '@/lib/stores';
import { sanitizeImageSrc } from '@/lib/utils/image';
import { fetchNeynarUserByVerification } from '@/lib/farcaster/neynar';
import type { InvitePayload } from '@/types';

export interface InviteRequest {
  conversationId: string;
  senderInboxId: string;
  messageId?: string;
  inviteCode: string;
  payload: InvitePayload;
  receivedAt: number;
}

interface InviteRequestModalProps {
  isOpen: boolean;
  request: InviteRequest | null;
  canApprove: boolean;
  approvalHint?: string;
  requiresWalletSignature: boolean;
  onApprove: (request: InviteRequest) => void;
  onReject: (request: InviteRequest) => void;
  onDismiss: (request: InviteRequest) => void;
}

interface InviteRequesterProfile {
  displayName?: string;
  avatarUrl?: string;
  address?: string;
  inboxId: string;
  farcaster?: {
    username?: string;
    fid?: number;
    score?: number;
    followers?: number;
    following?: number;
    activeStatus?: string;
    powerBadge?: boolean;
  };
}

const formatShort = (value?: string, head = 10, tail = 6) => {
  if (!value) return '';
  const trimmed = value.trim();
  if (trimmed.length <= head + tail + 3) return trimmed;
  return `${trimmed.slice(0, head)}...${trimmed.slice(-tail)}`;
};

const formatDateTime = (value?: Date) => {
  if (!value) return 'Not specified';
  try {
    return value.toLocaleString();
  } catch {
    return value.toString();
  }
};

export function InviteRequestModal({
  isOpen,
  request,
  canApprove,
  approvalHint,
  requiresWalletSignature,
  onApprove,
  onReject,
  onDismiss,
}: InviteRequestModalProps) {
  const [profile, setProfile] = useState<InviteRequesterProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !request) {
      setProfile(null);
      return;
    }

    let cancelled = false;

    const loadProfile = async () => {
      setIsLoading(true);
      try {
        const contactStore = useContactStore.getState();
        let contact =
          contactStore.getContactByInboxId(request.senderInboxId) ||
          contactStore.getContactByAddress(request.senderInboxId);

        let inboxProfile: {
          displayName?: string;
          avatarUrl?: string;
          primaryAddress?: string;
          addresses?: string[];
          identities?: { identifier: string; kind: string }[];
        } | null = null;

        if (!contact) {
          try {
            inboxProfile = await getXmtpClient().fetchInboxProfile(request.senderInboxId);
            if (inboxProfile && (inboxProfile.displayName || inboxProfile.avatarUrl || inboxProfile.primaryAddress)) {
              contact = await contactStore.upsertContactProfile({
                inboxId: request.senderInboxId,
                displayName: inboxProfile.displayName,
                avatarUrl: inboxProfile.avatarUrl,
                primaryAddress: inboxProfile.primaryAddress,
                addresses: inboxProfile.addresses,
                identities: inboxProfile.identities,
                source: 'inbox',
              });
            }
          } catch (error) {
            console.warn('[InviteRequestModal] Failed to load inbox profile', error);
          }
        }

        const address =
          contact?.primaryAddress ||
          inboxProfile?.primaryAddress ||
          contact?.addresses?.[0] ||
          inboxProfile?.addresses?.[0];

        const farcasterSeed = {
          username: contact?.farcasterUsername,
          fid: contact?.farcasterFid,
          score: contact?.farcasterScore,
          followers: contact?.farcasterFollowerCount,
          following: contact?.farcasterFollowingCount,
          powerBadge: contact?.farcasterPowerBadge,
          activeStatus: contact?.farcasterActiveStatus,
        };

        const neynarKey = useFarcasterStore.getState().getEffectiveNeynarApiKey();
        let farcaster = farcasterSeed;

        if (neynarKey && address) {
          try {
            const neynarUser = await fetchNeynarUserByVerification(address, neynarKey);
            if (neynarUser) {
              farcaster = {
                username: neynarUser.username,
                fid: neynarUser.fid,
                score: (neynarUser as { score?: number }).score,
                followers: neynarUser.follower_count,
                following: neynarUser.following_count,
                powerBadge: neynarUser.power_badge,
                activeStatus: neynarUser.active_status,
              };
            }
          } catch (error) {
            console.warn('[InviteRequestModal] Failed to load Neynar profile', error);
          }
        }

        if (!cancelled) {
          setProfile({
            inboxId: request.senderInboxId,
            displayName: contact?.preferredName || contact?.name || inboxProfile?.displayName,
            avatarUrl: contact?.preferredAvatar || contact?.avatar || inboxProfile?.avatarUrl,
            address,
            farcaster,
          });
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [isOpen, request]);

  const safeImage = useMemo(() => {
    if (!request?.payload?.imageUrl) return null;
    return sanitizeImageSrc(request.payload.imageUrl);
  }, [request?.payload?.imageUrl]);

  if (!isOpen || !request) return null;

  const payload = request.payload;
  const displayName = profile?.displayName || formatShort(profile?.inboxId || request.senderInboxId);
  const title = payload.name?.trim() || payload.tag?.trim() || 'Group invite request';
  const subtitle = payload.tag ? `Invite tag: ${payload.tag}` : 'Invite request';
  const showReputation = Boolean(profile?.farcaster?.username || profile?.farcaster?.fid || profile?.farcaster?.score);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-primary-900 rounded-xl shadow-2xl w-full max-w-xl text-primary-50 border border-primary-800/80">
        <div className="p-5 border-b border-primary-800/80 flex items-center gap-4">
          {safeImage ? (
            <img
              src={safeImage}
              alt={title}
              className="h-14 w-14 rounded-lg object-cover border border-primary-700/70"
              loading="lazy"
            />
          ) : (
            <div className="h-14 w-14 rounded-lg bg-primary-800/60 flex items-center justify-center text-primary-300 text-sm">
              INV
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-lg font-semibold truncate">{title}</h3>
            <p className="text-sm text-primary-300 truncate">{subtitle}</p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-lg border border-primary-800/70 bg-primary-950/40 p-4">
            <div className="flex items-center gap-3">
              {profile?.avatarUrl ? (
                <img
                  src={sanitizeImageSrc(profile.avatarUrl) || undefined}
                  alt={displayName}
                  className="h-12 w-12 rounded-full object-cover border border-primary-700/60"
                  loading="lazy"
                />
              ) : (
                <div className="h-12 w-12 rounded-full bg-primary-800/60 flex items-center justify-center text-primary-300 text-xs">
                  USER
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-primary-300">Requesting user</p>
                <p className="font-semibold truncate">{displayName}</p>
                <p className="text-xs text-primary-400 truncate">{formatShort(request.senderInboxId)}</p>
                {profile?.address && (
                  <p className="text-xs text-primary-500 truncate">Address: {formatShort(profile.address, 10, 8)}</p>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-primary-800/70 bg-primary-950/40 p-3">
              <p className="text-xs uppercase tracking-wide text-primary-400">Invite window</p>
              <p className="text-sm text-primary-100">Expires: {formatDateTime(payload.expiresAt)}</p>
              <p className="text-sm text-primary-400">Group expires: {formatDateTime(payload.conversationExpiresAt)}</p>
              {payload.expiresAfterUse && (
                <p className="text-xs text-amber-300 mt-1">Single-use invite</p>
              )}
            </div>
            <div className="rounded-lg border border-primary-800/70 bg-primary-950/40 p-3">
              <p className="text-xs uppercase tracking-wide text-primary-400">Request status</p>
              <p className="text-sm text-primary-100">
                {canApprove ? 'Ready for approval' : 'Approval restricted'}
              </p>
              {approvalHint && (
                <p className="text-xs text-amber-300 mt-1">{approvalHint}</p>
              )}
              {requiresWalletSignature && (
                <p className="text-xs text-primary-400 mt-2">
                  Approving will request a wallet signature.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-primary-800/70 bg-primary-950/40 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-primary-400">Reputation</p>
              {isLoading && <span className="text-xs text-primary-500">Fetching...</span>}
            </div>
            {showReputation ? (
              <div className="mt-2 space-y-1 text-sm text-primary-200">
                {(profile?.farcaster?.username || profile?.farcaster?.fid) && (
                  <p>
                    Farcaster: {profile?.farcaster?.username ? `@${profile.farcaster.username}` : 'FID'}{' '}
                    {profile?.farcaster?.fid ? `(${profile.farcaster.fid})` : ''}
                  </p>
                )}
                {profile?.farcaster?.score !== undefined && (
                  <p>Score: {profile.farcaster.score.toFixed(2)}</p>
                )}
                {profile?.farcaster?.followers !== undefined && (
                  <p>Followers: {profile.farcaster.followers}</p>
                )}
                {profile?.farcaster?.following !== undefined && (
                  <p>Following: {profile.farcaster.following}</p>
                )}
                {profile?.farcaster?.activeStatus && (
                  <p>Status: {profile.farcaster.activeStatus}</p>
                )}
                {profile?.farcaster?.powerBadge && (
                  <p className="text-accent-300">Power badge</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-primary-400 mt-2">
                {isLoading ? 'Gathering reputation signals...' : 'No reputation data available yet.'}
              </p>
            )}
          </div>
        </div>

        <div className="p-5 border-t border-primary-800/80 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            className="px-4 py-2 rounded-lg border border-primary-700/70 text-primary-200 hover:bg-primary-800/60"
            onClick={() => onDismiss(request)}
          >
            Not now
          </button>
          <button
            className="px-4 py-2 rounded-lg border border-primary-700/70 text-primary-200 hover:bg-primary-800/60"
            onClick={() => onReject(request)}
          >
            Decline
          </button>
          <button
            className={`px-4 py-2 rounded-lg font-semibold ${canApprove ? 'bg-accent-500 text-white hover:bg-accent-400' : 'bg-primary-800 text-primary-400 cursor-not-allowed'}`}
            onClick={() => canApprove && onApprove(request)}
            disabled={!canApprove}
          >
            {requiresWalletSignature ? 'Approve and Sign' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}
