import { BrowserRouter } from 'react-router-dom';
import { AppRouter } from './app/Router';
import { AppProviders } from './app/Providers';
import { useEffect } from 'react';
import { useAuthStore } from './lib/stores';

const isClient = typeof window !== 'undefined' && typeof document !== 'undefined';

function App() {
  // Expose stores globally for E2E tests and debugging
  useEffect(() => {
    // Always expose in non-production for testing and debugging
    if (import.meta.env.DEV || import.meta.env.VITE_E2E_TEST === 'true' || window.location.hostname === '127.0.0.1') {
      console.log('[App] Exposing useAuthStore globally for testing');
      // @ts-expect-error exposing for E2E tests
      window.useAuthStore = useAuthStore;
    }
  }, []);

  if (!isClient) {
    // Explicitly disable SSR/RSC rendering – the app only hydrates on the client.
    return null;
  }

  return (
    <BrowserRouter>
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </BrowserRouter>
  );
}

export default App;

