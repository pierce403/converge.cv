/**
 * Onboarding page for new users
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';

export function OnboardingPage() {
  const navigate = useNavigate();
  const { createIdentityWithPassphrase } = useAuth();

  const [step, setStep] = useState<'welcome' | 'wallet' | 'passphrase'>('welcome');
  const [walletAddress, setWalletAddress] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleStart = () => {
    setStep('wallet');
  };

  const handleWalletSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!walletAddress.trim()) {
      setError('Please enter a wallet address');
      return;
    }

    // Basic validation (should be more robust)
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      setError('Invalid Ethereum address format');
      return;
    }

    setStep('passphrase');
  };

  const handlePassphraseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!passphrase || passphrase.length < 8) {
      setError('Passphrase must be at least 8 characters');
      return;
    }

    if (passphrase !== confirmPassphrase) {
      setError('Passphrases do not match');
      return;
    }

    setIsLoading(true);

    const success = await createIdentityWithPassphrase(passphrase, walletAddress);

    if (success) {
      navigate('/');
    } else {
      setError('Failed to create identity. Please try again.');
      setIsLoading(false);
    }
  };

  if (step === 'welcome') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900 p-4">
        <div className="max-w-md w-full text-center">
          <div className="mb-8">
            <div className="w-24 h-24 bg-primary-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-4xl font-bold text-white">C</span>
            </div>
            <h1 className="text-4xl font-bold mb-2">Welcome to Converge</h1>
            <p className="text-slate-400 text-lg">
              Secure, local-first messaging with XMTP v3
            </p>
          </div>

          <div className="bg-slate-800 rounded-lg p-6 mb-6 text-left">
            <h3 className="font-semibold mb-4">Features:</h3>
            <ul className="space-y-2 text-slate-300">
              <li className="flex items-start">
                <span className="text-primary-500 mr-2">✓</span>
                <span>End-to-end encrypted messaging</span>
              </li>
              <li className="flex items-start">
                <span className="text-primary-500 mr-2">✓</span>
                <span>Local-first data storage</span>
              </li>
              <li className="flex items-start">
                <span className="text-primary-500 mr-2">✓</span>
                <span>Works offline</span>
              </li>
              <li className="flex items-start">
                <span className="text-primary-500 mr-2">✓</span>
                <span>Decentralized protocol</span>
              </li>
            </ul>
          </div>

          <button onClick={handleStart} className="btn-primary w-full py-3 text-lg">
            Get Started
          </button>
        </div>
      </div>
    );
  }

  if (step === 'wallet') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900 p-4">
        <div className="max-w-md w-full">
          <h2 className="text-2xl font-bold mb-2">Connect Wallet</h2>
          <p className="text-slate-400 mb-6">
            Enter your Ethereum wallet address to create your XMTP identity.
          </p>

          <form onSubmit={handleWalletSubmit} className="space-y-4">
            <div>
              <label htmlFor="wallet" className="block text-sm font-medium mb-2">
                Wallet Address
              </label>
              <input
                id="wallet"
                type="text"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                placeholder="0x..."
                className="input-primary"
                autoFocus
              />
            </div>

            {error && (
              <div className="bg-red-900/20 border border-red-500 text-red-400 px-4 py-2 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep('welcome')}
                className="btn-secondary flex-1"
              >
                Back
              </button>
              <button type="submit" className="btn-primary flex-1">
                Continue
              </button>
            </div>
          </form>

          <p className="text-xs text-slate-500 mt-4">
            Note: In production, this would integrate with MetaMask or WalletConnect
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-900 p-4">
      <div className="max-w-md w-full">
        <h2 className="text-2xl font-bold mb-2">Secure Your Account</h2>
        <p className="text-slate-400 mb-6">
          Create a passphrase to encrypt your messages locally. This passphrase never leaves your
          device.
        </p>

        <form onSubmit={handlePassphraseSubmit} className="space-y-4">
          <div>
            <label htmlFor="passphrase" className="block text-sm font-medium mb-2">
              Passphrase
            </label>
            <input
              id="passphrase"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="At least 8 characters"
              className="input-primary"
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="confirm" className="block text-sm font-medium mb-2">
              Confirm Passphrase
            </label>
            <input
              id="confirm"
              type="password"
              value={confirmPassphrase}
              onChange={(e) => setConfirmPassphrase(e.target.value)}
              placeholder="Re-enter passphrase"
              className="input-primary"
            />
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-500 text-red-400 px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="bg-yellow-900/20 border border-yellow-500 text-yellow-400 px-4 py-2 rounded-lg text-sm">
            ⚠️ Important: Store your passphrase securely. It cannot be recovered if lost.
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep('wallet')}
              className="btn-secondary flex-1"
              disabled={isLoading}
            >
              Back
            </button>
            <button type="submit" className="btn-primary flex-1" disabled={isLoading}>
              {isLoading ? 'Creating...' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

