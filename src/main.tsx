// Load polyfills FIRST before any other imports
import './polyfills';

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { setupDebugConsole } from '@/lib/utils/debug-console';
import { startAppWatchdog } from '@/lib/utils/watchdog';

const SW_RELOAD_FLAG = 'converge-sw-isolation-reload';

if (
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  typeof sessionStorage !== 'undefined'
) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const hasReloaded = sessionStorage.getItem(SW_RELOAD_FLAG);

    if (hasReloaded) {
      return;
    }

    sessionStorage.setItem(SW_RELOAD_FLAG, 'true');
    window.location.reload();
  });
}

setupDebugConsole();
startAppWatchdog();

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

