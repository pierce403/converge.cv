// Load polyfills FIRST before any other imports
import './polyfills';

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { clearRemovedIntegrationStorage } from '@/lib/removed-integration-storage';

clearRemovedIntegrationStorage();

// These diagnostics monkey-patch browser globals and can reload the page when
// the main thread is busy. Keep them out of production; explicit checks remain
// available from the Advanced diagnostics screen.
if (import.meta.env.DEV) {
  void Promise.all([
    import('@/lib/utils/debug-console'),
    import('@/lib/utils/watchdog'),
  ]).then(([{ setupDebugConsole }, { startAppWatchdog }]) => {
    setupDebugConsole();
    startAppWatchdog();
  });
}

const rootElement = typeof document !== 'undefined' ? document.getElementById('root') : null;

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else {
  console.warn('[main] SSR/RSC rendering disabled – no root element to mount.');
}
