import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

export function HandleXmtpProtocol() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const xmtpUrl = urlParams.get('url');

    if (xmtpUrl) {
      // Expected format: xmtp://chat/conversationId
      const parts = xmtpUrl.split('/');
      if (parts.length >= 4 && parts[2] === 'chat') {
        const conversationId = parts[3];
        console.log(`Redirecting to /join-group/${conversationId}`);
        navigate(`/join-group/${conversationId}`);
      } else {
        console.error('Invalid XMTP URL format:', xmtpUrl);
        navigate('/');
      }
    } else {
      console.error('No URL parameter found for xmtp protocol handler.');
      navigate('/');
    }
  }, [location, navigate]);

  return (
    <div className="flex flex-col items-center justify-center h-full text-primary-50">
      <p>Handling XMTP protocol link...</p>
      <p className="text-sm text-primary-300 mt-2">Please wait, you are being redirected.</p>
    </div>
  );
}
