/**
 * PWA Install Prompt Component
 * Shows install prompt on mobile devices
 * 
 * Supports:
 * - Chrome/Edge on Android (beforeinstallprompt)
 * - Safari on iOS (instructions)
 * - Other browsers (fallback instructions)
 */

import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [platform, setPlatform] = useState<'chrome' | 'ios' | 'other'>('other');

  useEffect(() => {
    // Check if user previously dismissed the prompt
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    if (dismissed === 'true') {
      return;
    }

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      return;
    }

    // Detect platform
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isChrome = /Chrome/.test(navigator.userAgent) && /Android/.test(navigator.userAgent);
    
    if (isIOS) {
      setPlatform('ios');
      // Show instructions for iOS after a delay
      const timer = setTimeout(() => {
        setShowPrompt(true);
      }, 2000);
      return () => clearTimeout(timer);
    } else if (isChrome) {
      setPlatform('chrome');
    }

    // Listen for the beforeinstallprompt event (Chrome/Edge Android)
    const handler = (e: Event) => {
      e.preventDefault();
      console.log('beforeinstallprompt event fired');
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // If no prompt appears after 3 seconds on mobile, show fallback
    const fallbackTimer = setTimeout(() => {
      if (!deferredPrompt && window.innerWidth < 768) {
        console.log('No beforeinstallprompt, showing fallback');
        setShowPrompt(true);
      }
    }, 3000);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      clearTimeout(fallbackTimer);
    };
  }, [deferredPrompt]);

  const handleInstall = async () => {
    if (deferredPrompt) {
      // Chrome/Edge Android - use native prompt
      await deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;

      if (choiceResult.outcome === 'accepted') {
        console.log('User accepted the install prompt');
      } else {
        console.log('User dismissed the install prompt');
        localStorage.setItem('pwa-install-dismissed', 'true');
      }

      setDeferredPrompt(null);
      setShowPrompt(false);
    } else {
      // iOS or other - show instructions
      setShowInstructions(true);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem('pwa-install-dismissed', 'true');
    setShowPrompt(false);
    setShowInstructions(false);
  };

  if (!showPrompt) {
    return null;
  }

  // Instructions modal
  if (showInstructions) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center md:justify-center p-4">
        <div className="bg-slate-800 rounded-t-2xl md:rounded-2xl w-full md:max-w-md max-h-[80vh] overflow-y-auto">
          <div className="p-6">
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-xl font-semibold">Install Converge</h2>
              <button
                onClick={handleDismiss}
                className="text-slate-400 hover:text-slate-300"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {platform === 'ios' ? (
              <div className="space-y-4">
                <p className="text-slate-300">
                  To install Converge on your iPhone or iPad:
                </p>
                <ol className="space-y-3 text-slate-300">
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-600 flex items-center justify-center text-sm font-medium">1</span>
                    <span>Tap the <strong>Share</strong> button (square with arrow) at the bottom of Safari</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-600 flex items-center justify-center text-sm font-medium">2</span>
                    <span>Scroll down and tap <strong>"Add to Home Screen"</strong></span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-600 flex items-center justify-center text-sm font-medium">3</span>
                    <span>Tap <strong>"Add"</strong> in the top right corner</span>
                  </li>
                </ol>
                <div className="mt-6 p-3 bg-slate-900 rounded-lg text-sm text-slate-400">
                  💡 The app icon will appear on your home screen and work like a native app
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-slate-300">
                  To install Converge on your device:
                </p>
                <ol className="space-y-3 text-slate-300">
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-600 flex items-center justify-center text-sm font-medium">1</span>
                    <span>Tap the <strong>menu</strong> button (⋮) in your browser</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-600 flex items-center justify-center text-sm font-medium">2</span>
                    <span>Look for <strong>"Add to Home Screen"</strong> or <strong>"Install App"</strong></span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-600 flex items-center justify-center text-sm font-medium">3</span>
                    <span>Follow the prompts to install</span>
                  </li>
                </ol>
              </div>
            )}

            <button
              onClick={handleDismiss}
              className="w-full mt-6 btn-primary py-3"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Banner prompt
  return (
    <div className="fixed bottom-20 left-4 right-4 md:left-auto md:right-4 md:max-w-sm z-50 animate-slide-up">
      <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-primary-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg
              className="w-6 h-6 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="font-semibold mb-1">Install Converge</h3>
            <p className="text-sm text-slate-400 mb-3">
              Get the full app experience with faster access and better performance
            </p>

            <div className="flex gap-2">
              <button onClick={handleInstall} className="btn-primary text-sm px-4 py-2">
                {deferredPrompt ? 'Install' : 'Show How'}
              </button>
              <button onClick={handleDismiss} className="btn-secondary text-sm px-4 py-2">
                Not Now
              </button>
            </div>
          </div>

          <button
            onClick={handleDismiss}
            className="text-slate-400 hover:text-slate-300 flex-shrink-0"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

