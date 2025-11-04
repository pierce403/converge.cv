import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useConversations } from '@/features/conversations/useConversations';
import { useAuthStore } from '@/lib/stores';

export function JoinGroupPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const { conversations, addMembersToGroup } = useConversations();
  const { identity, isAuthenticated, isVaultUnlocked } = useAuthStore();

  useEffect(() => {
    const handleJoinGroup = async () => {
      if (!conversationId) {
        navigate('/');
        return;
      }

      if (!isAuthenticated || !isVaultUnlocked) {
        // If not authenticated or unlocked, redirect to onboarding/lock screen
        // The user will be redirected back here after auth/unlock
        console.log('Not authenticated or unlocked, redirecting...');
        // This is a simplified redirect. In a real app, you might store the intended path
        // and redirect after successful auth/unlock.
        navigate('/'); // Redirect to home, which will handle auth flow
        return;
      }

      const conversation = conversations.find((c) => c.id === conversationId);

      if (conversation) {
        // If conversation exists, check if current user is already a member
        if (conversation.members?.includes(identity?.address || '')) {
          console.log('Already a member, navigating to chat.');
          navigate(`/chat/${conversationId}`);
        } else {
          // If not a member, add current user to the group
          console.log('Adding current user to group...');
          try {
            await addMembersToGroup(conversationId, [identity?.address || '']);
            alert('You have joined the group!');
            navigate(`/chat/${conversationId}`);
          } catch (error) {
            console.error('Failed to join group:', error);
            alert('Failed to join group. Please try again.');
            navigate('/');
          }
        }
      } else {
        // If conversation does not exist locally, it means it's a new group for this user
        // or the group ID is invalid. For now, we'll assume it's an invalid ID
        // as XMTP group creation is handled by `createGroupConversation`.
        // A more robust solution would involve fetching group info from XMTP network.
        console.error('Group conversation not found locally.');
        alert('Group not found or invalid link.');
        navigate('/');
      }
    };

    handleJoinGroup();
  }, [conversationId, navigate, conversations, addMembersToGroup, identity, isAuthenticated, isVaultUnlocked]);

  return (
    <div className="flex flex-col items-center justify-center h-full text-primary-50">
      <p>Joining group...</p>
      <p className="text-sm text-primary-300 mt-2">Please wait, you are being redirected.</p>
    </div>
  );
}
