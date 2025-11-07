import { Navigate, useParams } from 'react-router-dom';

export function GroupConnectRedirect() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const target = conversationId ? `/onboarding?connect=1&g=${encodeURIComponent(conversationId)}` : '/onboarding?connect=1';
  return <Navigate to={target} replace />;
}

export function UserConnectRedirect() {
  const { userId } = useParams<{ userId: string }>();
  const target = userId ? `/onboarding?connect=1&u=${encodeURIComponent(userId)}` : '/onboarding?connect=1';
  return <Navigate to={target} replace />;
}

export function InboxConnectRedirect() {
  const { inboxId } = useParams<{ inboxId: string }>();
  const target = inboxId ? `/onboarding?connect=1&i=${encodeURIComponent(inboxId)}` : '/onboarding?connect=1';
  return <Navigate to={target} replace />;
}
