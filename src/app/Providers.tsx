import { ReactNode } from 'react';

interface AppProvidersProps {
  children: ReactNode;
}

/**
 * AppProviders wraps the app with all necessary context providers
 * (Auth, Storage, XMTP, etc.)
 */
export function AppProviders({ children }: AppProvidersProps) {
  // TODO: Add providers as we build them:
  // - AuthProvider
  // - StorageProvider
  // - XMTPProvider
  // - NotificationProvider

  return <>{children}</>;
}

