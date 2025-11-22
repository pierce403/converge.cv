import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

export function HandleXmtpProtocol() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const xmtpUrl = urlParams.get('url');

    if (!xmtpUrl) {
      console.error('No URL parameter found for xmtp protocol handler.');
      navigate('/');
      return;
    }

    const emitToast = (message: string) => {
      try {
        window.dispatchEvent(new CustomEvent('ui:toast', { detail: message }));
      } catch {
        // ignore toast failures
      }
    };

    const parseTarget = (raw: string): { type: 'dm' | 'group' | 'unknown'; value?: string } => {
      try {
        const u = new URL(raw);
        const host = (u.host || '').toLowerCase();
        const segments = (u.pathname || '').split('/').filter(Boolean);

        // Treat "chat" as group invite, which we do not support yet
        if (host === 'chat' || segments[0] === 'chat') return { type: 'group' };

        // Common forms:
        // web+xmtp://dm/<inboxId>
        // web+xmtp://<inboxId>
        // web+xmtp://xmtp.chat/dm/<inboxId>
        if (segments[0] === 'dm' && segments[1]) return { type: 'dm', value: segments[1] };
        if (host === 'dm' && segments[0]) return { type: 'dm', value: segments[0] };

        // If only an identifier is present as host or first segment, use it directly
        if (!segments[0] && host) return { type: 'dm', value: host };
        if (segments.length === 1) return { type: 'dm', value: segments[0] };
      } catch (err) {
        console.warn('Failed to parse XMTP URL:', err);
      }
      return { type: 'unknown' };
    };

    const result = parseTarget(xmtpUrl);

    if (result.type === 'group') {
      emitToast('Group links are not supported yet. Ask a member to add you instead.');
      navigate('/');
      return;
    }

    if (result.type === 'dm' && result.value) {
      const target = decodeURIComponent(result.value);
      emitToast('Opening XMTP conversation…');
      navigate(`/i/${encodeURIComponent(target)}`);
      return;
    }

    emitToast('Unsupported XMTP link.');
    navigate('/');
  }, [location, navigate]);

  return (
    <div className="flex flex-col items-center justify-center h-full text-primary-50">
      <p>Handling XMTP protocol link...</p>
      <p className="text-sm text-primary-300 mt-2">Please wait, you are being redirected.</p>
    </div>
  );
}
