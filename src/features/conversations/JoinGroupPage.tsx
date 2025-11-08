import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PermissionPolicy } from '@xmtp/browser-sdk';
import { useAuthStore } from '@/lib/stores';
import { useXmtpStore } from '@/lib/stores/xmtp-store';
import { useConversations } from '@/features/conversations/useConversations';
import { getXmtpClient, type GroupDetails } from '@/lib/xmtp';
import { isDisplayableImageSrc } from '@/lib/utils/image';

const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const shortInbox = (value: string) => `${value.slice(0, 4)}…${value.slice(-4)}`;

const MEMBER_NAME_PRIORITY = ['ens', 'lens', 'farcaster', 'twitter'];

const JOIN_POLICY_COPY: Record<number, { title: string; description: string; hint?: string }> = {
  [PermissionPolicy.Allow]: {
    title: 'Open join',
    description: 'Anyone with the link can join instantly.',
  },
  [PermissionPolicy.Admin]: {
    title: 'Admin approval required',
    description: 'An admin needs to approve new members before they can participate.',
    hint: 'If you are not added automatically, ask a group admin to invite you.',
  },
  [PermissionPolicy.SuperAdmin]: {
    title: 'Super admin approval required',
    description: 'Only super admins can add new members to this group.',
    hint: 'Share this link with a super admin so they can add you.',
  },
  [PermissionPolicy.Deny]: {
    title: 'Group is closed to new members',
    description: 'This group has disabled new invites for now.',
    hint: 'Reach out to the group owner if you need access.',
  },
};

const formatMemberLabel = (member: GroupDetails['members'][number]): string => {
  for (const priority of MEMBER_NAME_PRIORITY) {
    const match = member.identifiers.find((id) => id.identifierKind.toLowerCase() === priority);
    if (match?.identifier) {
      return match.identifier;
    }
  }
  if (member.address) {
    return shortAddress(member.address);
  }
  return `Inbox ${shortInbox(member.inboxId)}`;
};

interface DisplayMember {
  id: string;
  label: string;
  role?: 'admin' | 'super-admin';
}

const toDisplayMembers = (details: GroupDetails | null): DisplayMember[] => {
  if (!details) {
    return [];
  }
  return details.members.map((member) => ({
    id: member.inboxId,
    label: formatMemberLabel(member),
    role: member.isSuperAdmin ? 'super-admin' : member.isAdmin ? 'admin' : undefined,
  }));
};

export function JoinGroupPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const { identity } = useAuthStore();
  const connectionStatus = useXmtpStore((state) => state.connectionStatus);
  const { conversations, loadConversations, refreshGroupDetails } = useConversations();

  const [details, setDetails] = useState<GroupDetails | null>(null);
  const [status, setStatus] = useState<'idle' | 'waiting' | 'loading' | 'ready' | 'error'>(
    conversationId ? 'loading' : 'error'
  );
  const [error, setError] = useState<string | null>(conversationId ? null : 'Group link is missing an identifier.');
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const conversation = useMemo(
    () => conversations.find((c) => c.id === conversationId),
    [conversations, conversationId]
  );

  const myAddress = identity?.address?.toLowerCase();
  const myInboxId = identity?.inboxId?.toLowerCase();

  const isAlreadyMember = useMemo(() => {
    if (!conversationId) return false;
    if (conversation?.isGroup) {
      const memberMatches = (conversation.members || []).some((m) => m?.toLowerCase?.() === myAddress);
      const inboxMatches = (conversation.memberInboxes || []).some(
        (inbox) => inbox?.toLowerCase?.() === myInboxId
      );
      if (memberMatches || inboxMatches) {
        return true;
      }
    }

    if (!details) return false;
    return details.members.some((member) => {
      const addressMatch = member.address?.toLowerCase() === myAddress;
      const inboxMatch = member.inboxId?.toLowerCase() === myInboxId;
      return addressMatch || inboxMatch;
    });
  }, [conversationId, conversation, details, myAddress, myInboxId]);

  useEffect(() => {
    let cancelled = false;

    const loadDetails = async () => {
      if (!conversationId) {
        setStatus('error');
        setError('Group link is missing an identifier.');
        return;
      }

      if (!identity) {
        setStatus('waiting');
        setError('Sign in to Converge to join this group.');
        return;
      }

      if (connectionStatus !== 'connected') {
        setStatus('waiting');
        setError('Connecting to XMTP…');
        return;
      }

      setStatus('loading');
      setError(null);

      try {
        const xmtp = getXmtpClient();
        const fetched = await xmtp.fetchGroupDetails(conversationId);
        if (cancelled) return;

        if (!fetched) {
          setStatus('error');
          setError('Group not found. Ask the sender to double-check the invite link.');
          setDetails(null);
          return;
        }

        setDetails(fetched);
        setStatus('ready');
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.warn('[JoinGroup] Failed to load group details', err);
        setStatus('error');
        setError('We ran into a problem loading this group. Please try again in a moment.');
        setDetails(null);
      }
    };

    void loadDetails();

    return () => {
      cancelled = true;
    };
  }, [conversationId, identity, connectionStatus]);

  useEffect(() => {
    if (!conversationId || !details || !identity) {
      return;
    }
    const address = identity.address?.toLowerCase();
    const inbox = identity.inboxId?.toLowerCase();
    const isMember = details.members.some(
      (member) => member.address?.toLowerCase() === address || member.inboxId?.toLowerCase() === inbox
    );
    if (isMember && !conversation) {
      loadConversations().catch((err) => {
        console.warn('[JoinGroup] Failed to refresh conversations after detecting membership', err);
      });
    }
  }, [conversationId, details, identity, conversation, loadConversations]);

  const displayMembers = useMemo(() => toDisplayMembers(details), [details]);
  const totalMembers = displayMembers.length || (conversation?.groupMembers?.length ?? 0);
  const maxMembersToShow = 6;
  const membersToRender = displayMembers.slice(0, maxMembersToShow);
  const extraMembers = Math.max(0, displayMembers.length - membersToRender.length);

  const joinPolicy = details?.permissions?.policySet?.addMemberPolicy ??
    conversation?.groupPermissions?.policySet?.addMemberPolicy;
  const joinPolicyInfo = joinPolicy !== undefined ? JOIN_POLICY_COPY[joinPolicy] ?? {
    title: 'Custom access controls',
    description: 'This group is using a custom XMTP permission set.',
    hint: 'An admin may need to add you manually.',
  } : null;

  const groupName = details?.name?.trim() || conversation?.groupName || 'Group chat';
  const groupImage = details?.imageUrl?.trim() || conversation?.groupImage;
  const groupDescription = details?.description?.trim() || conversation?.groupDescription || '';

  const handleOpenChat = () => {
    if (conversationId) {
      navigate(`/chat/${conversationId}`);
    }
  };

  const handleJoin = async () => {
    if (!conversationId || !identity) {
      setJoinError('Unable to join this group right now. Try reloading the page.');
      return;
    }

    const joinIdentifier = identity.address || identity.inboxId;
    if (!joinIdentifier) {
      setJoinError('Your identity is missing an address. Try reconnecting in Settings.');
      return;
    }

    setIsJoining(true);
    setJoinError(null);

    try {
      const xmtp = getXmtpClient();
      if (!xmtp.isConnected()) {
        throw new Error('XMTP is still connecting. Please try again.');
      }

      await xmtp.addMembersToGroup(conversationId, [joinIdentifier]);

      try {
        await xmtp.syncConversations();
      } catch (syncError) {
        console.warn('[JoinGroup] Failed to sync conversations after join', syncError);
      }

      await loadConversations();
      await refreshGroupDetails(conversationId);

      navigate(`/chat/${conversationId}`);
    } catch (err) {
      console.error('[JoinGroup] Failed to join group', err);
      const message = err instanceof Error ? err.message : String(err ?? '');
      let friendly = 'Failed to join the group. Please try again.';
      if (message.toLowerCase().includes('permission')) {
        friendly = 'An admin needs to approve new members before you can join this group.';
      } else if (message.toLowerCase().includes('closed') || message.toLowerCase().includes('deny')) {
        friendly = 'This group is currently closed to new members.';
      }
      setJoinError(friendly);
    } finally {
      setIsJoining(false);
    }
  };

  const renderStatusCard = (title: string, subtitle?: string) => (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-primary-800/70 bg-primary-950/70 p-8 text-center text-primary-100">
      <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-accent-500" />
      <h1 className="mt-6 text-xl font-semibold">{title}</h1>
      {subtitle && <p className="mt-2 text-sm text-primary-300">{subtitle}</p>}
    </div>
  );

  const renderErrorCard = (title: string, subtitle?: string) => (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-red-500/60 bg-red-950/40 p-8 text-center text-primary-100">
      <h1 className="text-xl font-semibold">{title}</h1>
      {subtitle && <p className="mt-3 text-sm text-primary-300">{subtitle}</p>}
      <button onClick={() => navigate('/')} className="btn-secondary mt-6">
        Go back home
      </button>
    </div>
  );

  let content: JSX.Element;

  if (!conversationId) {
    content = renderErrorCard('Invalid group link', 'This invite is missing a conversation ID.');
  } else if (status === 'waiting') {
    const message = !identity
      ? 'Sign in to Converge to continue.'
      : connectionStatus !== 'connected'
        ? 'We are connecting to XMTP to look up this group.'
        : 'Preparing your invite…';
    content = renderStatusCard('Loading invite…', message);
  } else if (status === 'loading') {
    content = renderStatusCard('Fetching group details…', 'Hang tight — this only takes a moment.');
  } else if (status === 'error' || !details) {
    content = renderErrorCard('Unable to open this group', error || 'Something went wrong.');
  } else {
    content = (
      <div className="rounded-2xl border border-primary-800/70 bg-primary-950/70 p-8 text-primary-50 shadow-lg">
        <div className="flex items-start gap-4">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-primary-800/70 bg-primary-900/80">
            {groupImage && isDisplayableImageSrc(groupImage) ? (
              <img src={groupImage} alt={`${groupName} avatar`} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-primary-200">
                {groupName.slice(0, 2).toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold text-primary-50">{groupName}</h1>
            <p className="mt-1 text-sm text-primary-300">
              Group • {totalMembers} member{totalMembers === 1 ? '' : 's'}
            </p>
            {groupDescription && (
              <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-primary-200">
                {groupDescription}
              </p>
            )}
          </div>
        </div>

        {joinPolicyInfo && (
          <div className="mt-6 rounded-lg border border-primary-800/60 bg-primary-900/40 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary-200">
              {joinPolicyInfo.title}
            </h2>
            <p className="mt-1 text-sm text-primary-300">{joinPolicyInfo.description}</p>
            {joinPolicyInfo.hint && (
              <p className="mt-2 text-xs text-primary-500">{joinPolicyInfo.hint}</p>
            )}
          </div>
        )}

        <div className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-primary-200">Members</h2>
          {membersToRender.length > 0 ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {membersToRender.map((member) => (
                <div
                  key={member.id}
                  className="rounded-lg border border-primary-800/50 bg-primary-900/40 px-4 py-3 text-sm text-primary-100"
                >
                  <div className="font-medium">{member.label}</div>
                  {member.role && (
                    <div className="mt-1 text-xs uppercase tracking-wide text-accent-400">
                      {member.role === 'super-admin' ? 'Super admin' : 'Admin'}
                    </div>
                  )}
                </div>
              ))}
              {extraMembers > 0 && (
                <div className="flex items-center justify-center rounded-lg border border-primary-800/50 bg-primary-900/40 px-4 py-3 text-sm text-primary-300">
                  +{extraMembers} more
                </div>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-primary-300">Member list will appear once the group syncs.</p>
          )}
        </div>

        {joinError && (
          <div className="mt-6 rounded-lg border border-red-500/40 bg-red-900/40 p-4 text-sm text-red-200">
            {joinError}
          </div>
        )}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          {isAlreadyMember ? (
            <button className="btn-primary" onClick={handleOpenChat}>
              Open chat
            </button>
          ) : (
            <button
              className="btn-primary"
              onClick={handleJoin}
              disabled={isJoining || connectionStatus !== 'connected'}
            >
              {isJoining ? 'Joining…' : 'Join group'}
            </button>
          )}
          <button className="btn-secondary" onClick={() => navigate('/')}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full w-full items-start justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-2xl">{content}</div>
    </div>
  );
}
