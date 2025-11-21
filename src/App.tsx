import { BrowserRouter } from 'react-router-dom';
import { AppRouter } from './app/Router';
import { AppProviders } from './app/Providers';
import { useEffect } from 'react';
import { useAuthStore } from './lib/stores';

const isClient = typeof window !== 'undefined' && typeof document !== 'undefined';

function App() {
  // Expose stores globally in E2E test mode
  useEffect(() => {
    if (import.meta.env.VITE_E2E_TEST === 'true') {
      console.log('[E2E] Exposing useAuthStore globally');
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

