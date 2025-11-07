import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useConversations } from '@/features/conversations/useConversations';
import { useAuthStore } from '@/lib/stores';

export function StartDmPage() {
  const { inboxId } = useParams<{ inboxId: string }>();
  const navigate = useNavigate();
  const { createConversation } = useConversations();
  const { isAuthenticated, isVaultUnlocked } = useAuthStore();

  useEffect(() => {
    const run = async () => {
      if (!inboxId) {
        navigate('/');
        return;
      }
      if (!isAuthenticated || !isVaultUnlocked) {
        navigate(`/onboarding?connect=1&u=${encodeURIComponent(inboxId)}`);
        return;
      }
      try {
        const conv = await createConversation(inboxId);
        if (conv) navigate(`/chat/${conv.id}`);
        else navigate('/');
      } catch (e) {
        console.warn('[StartDm] Failed to start DM', e);
        navigate('/');
      }
    };
    run();
  }, [inboxId, isAuthenticated, isVaultUnlocked, createConversation, navigate]);

  return (
    <div className="flex flex-col items-center justify-center h-full text-primary-50">
      <p>Opening chat…</p>
      <p className="text-sm text-primary-300 mt-2">Please wait, you are being redirected.</p>
    </div>
  );
}

