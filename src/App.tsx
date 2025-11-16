import { BrowserRouter } from 'react-router-dom';
import { AppRouter } from './app/Router';
import { AppProviders } from './app/Providers';

const isClient = typeof window !== 'undefined' && typeof document !== 'undefined';

function App() {
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

