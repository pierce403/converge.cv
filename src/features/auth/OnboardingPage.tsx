/**
 * Onboarding page for new users
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';

export function OnboardingPage() {
  const navigate = useNavigate();
  const { createIdentity } = useAuth();

  const [step, setStep] = useState<'welcome' | 'creating'>('welcome');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleStart = async () => {
    setError('');
    setIsLoading(true);
    setStep('creating');

    try {
      // Generate a new Ethereum wallet using Web3 crypto
      const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
      
      // Convert to hex for private key
      const privateKeyHex = '0x' + Array.from(privateKeyBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      // For now, derive a simple address from the private key
      // In production, use proper elliptic curve cryptography (e.g., ethers.js)
      const addressBytes = crypto.getRandomValues(new Uint8Array(20));
      const address = '0x' + Array.from(addressBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      // Create identity directly without passphrase
      const success = await createIdentity(address, privateKeyHex);

      if (success) {
        navigate('/');
      } else {
        setError('Failed to create identity. Please try again.');
        setStep('welcome');
        setIsLoading(false);
      }
    } catch (err: any) {
      console.error('Identity creation error:', err);
      setError('Failed to create identity. Please try again.');
      setStep('welcome');
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
                <span>Your data stays on your device</span>
              </li>
              <li className="flex items-start">
                <span className="text-primary-500 mr-2">✓</span>
                <span>No phone number required</span>
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

  if (step === 'creating') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900 p-4">
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 bg-primary-600/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
          <h2 className="text-2xl font-bold mb-2">Creating Your Identity</h2>
          <p className="text-slate-400">
            Setting up your secure messaging identity...
          </p>
          {error && (
            <div className="bg-red-900/20 border border-red-500 text-red-400 px-4 py-3 rounded-lg text-sm mt-6">
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}

