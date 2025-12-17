import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '@/lib/stores';
import { isENSName, resolveAddressOrENS } from '@/lib/utils/ens';

export function ContactLinkPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, isVaultUnlocked } = useAuthStore();
  const [status, setStatus] = useState('Opening chat…');

  useEffect(() => {
    const run = async () => {
      if (!userId) {
        navigate('/');
        return;
      }
      if (!isAuthenticated || !isVaultUnlocked) {
        navigate(`/onboarding?u=${encodeURIComponent(userId)}`);
        return;
      }

      const raw = userId.trim();
      let target = raw;

      // If this looks like an ENS name (e.g. deanpierce.eth), resolve to an address first.
      if (isENSName(raw)) {
        setStatus('Resolving identity…');
        const resolved = await resolveAddressOrENS(raw);
        if (resolved) {
          target = resolved;
        } else {
          // If resolution fails, send the user to the manual New Chat flow prefilled.
          navigate(`/new-chat?to=${encodeURIComponent(raw)}`, { replace: true });
          return;
        }
      }

      setStatus('Opening chat…');
      navigate(`/i/${encodeURIComponent(target)}`, { replace: true });
    };
    run();
  }, [userId, isAuthenticated, isVaultUnlocked, navigate]);

  return (
    <div className="flex flex-col items-center justify-center h-full text-primary-50">
      <p>{status}</p>
      <p className="text-sm text-primary-300 mt-2">Please wait, you are being redirected.</p>
    </div>
  );
}
