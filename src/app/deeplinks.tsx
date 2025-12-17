import { Navigate, useParams } from 'react-router-dom';

export function UserConnectRedirect() {
  const { userId } = useParams<{ userId: string }>();
  const target = userId ? `/onboarding?u=${encodeURIComponent(userId)}` : '/onboarding';
  return <Navigate to={target} replace />;
}

export function InboxConnectRedirect() {
  const { inboxId } = useParams<{ inboxId: string }>();
  const target = inboxId ? `/onboarding?i=${encodeURIComponent(inboxId)}` : '/onboarding';
  return <Navigate to={target} replace />;
}
