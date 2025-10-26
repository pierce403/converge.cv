/**
 * Lock screen for unlocking the vault
 */

import { useState } from 'react';
import { useAuth } from './useAuth';

export function LockScreen() {
  const { unlockWithPassphrase, vaultSecrets } = useAuth();
  const [passphrase, setPassphrase] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!passphrase) {
      setError('Please enter your passphrase');
      return;
    }

    setIsUnlocking(true);

    const success = await unlockWithPassphrase(passphrase);

    if (!success) {
      setError('Incorrect passphrase');
      setPassphrase('');
      setIsUnlocking(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-900 p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-10 h-10 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold mb-2">Unlock Converge</h2>
          <p className="text-slate-400">
            {vaultSecrets?.method === 'passkey'
              ? 'Use your passkey to unlock'
              : 'Enter your passphrase to unlock'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="passphrase" className="block text-sm font-medium mb-2">
              Passphrase
            </label>
            <input
              id="passphrase"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Enter your passphrase"
              className="input-primary"
              autoFocus
            />
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-500 text-red-400 px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary w-full" disabled={isUnlocking}>
            {isUnlocking ? 'Unlocking...' : 'Unlock'}
          </button>
        </form>

        {vaultSecrets?.method === 'passkey' && (
          <button
            onClick={() => {
              /* TODO: Implement passkey unlock */
            }}
            className="btn-secondary w-full mt-3"
          >
            Use Passkey Instead
          </button>
        )}
      </div>
    </div>
  );
}

