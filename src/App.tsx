import { BrowserRouter } from 'react-router-dom';
import { AppRouter } from './app/Router';
import { AppProviders } from './app/Providers';

function App() {
  return (
    <BrowserRouter>
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </BrowserRouter>
  );
}

export default App;

