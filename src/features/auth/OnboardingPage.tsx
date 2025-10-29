/**
 * Onboarding page for new users
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { privateKeyToAccount } from 'viem/accounts';
import { WalletSelector } from './WalletSelector';
import { useSignMessage } from 'wagmi';

export function OnboardingPage() {
  const navigate = useNavigate();
  const { createIdentity } = useAuth();
  const { signMessageAsync } = useSignMessage();

  const [step, setStep] = useState<'welcome' | 'wallet-choice' | 'wallet-connect' | 'creating'>('welcome');
  const [error, setError] = useState('');

  const handleStart = () => {
    setError('');
    setStep('wallet-choice');
  };

  const handleGenerateWallet = async () => {
    setError('');
    setStep('creating');

    try {
      // Generate a new Ethereum wallet using proper secp256k1 cryptography
      const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
      
      // Convert to hex for private key
      const privateKeyHex = ('0x' + Array.from(privateKeyBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')) as `0x${string}`;
      
      // IMPORTANT: Derive the address FROM the private key using elliptic curve crypto
      // This ensures the private key and address are mathematically related
      const account = privateKeyToAccount(privateKeyHex);
      const address = account.address;
      
      console.log('[Onboarding] Generated new Ethereum wallet:', { address, privateKeyHex: privateKeyHex.slice(0, 10) + '...' });
      
      // Create identity directly without passphrase
      const success = await createIdentity(address, privateKeyHex);

      if (success) {
        navigate('/');
      } else {
        setError('Failed to create identity. Please try again.');
        setStep('welcome');
      }
    } catch (err) {
      console.error('Identity creation error:', err);
      setError('Failed to create identity. Please try again.');
      setStep('welcome');
    }
  };

  const handleWalletConnected = async (address: string, chainId?: number) => {
    setError('');
    setStep('creating');

    try {
      console.log('[Onboarding] Wallet connected:', { address, chainId });
      
      // For wallet-based identities, we don't have the private key
      // The wallet keeps it secure and will handle signing through wagmi
      // We pass a signMessage function that uses wagmi to sign
      const signMessage = async (message: string) => {
        return await signMessageAsync({ message });
      };
      
      const success = await createIdentity(address, undefined, chainId, signMessage);

      if (success) {
        navigate('/');
      } else {
        setError('Failed to create identity with wallet. Please try again.');
        setStep('wallet-connect');
      }
    } catch (err) {
      console.error('Wallet identity creation error:', err);
      setError('Failed to create identity with wallet. Please try again.');
      setStep('wallet-connect');
    }
  };

  if (step === 'welcome') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="mb-2">
            <div className="w-24 h-24 bg-primary-900/60 border border-primary-700/60 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
              <span className="text-4xl font-bold text-accent-300">C</span>
            </div>
            <h1 className="text-4xl font-bold mb-2 text-primary-50">Welcome to Converge</h1>
            <p className="text-primary-200 text-lg">
              Secure, local-first messaging with XMTP v3
            </p>
          </div>

          <div className="bg-primary-900/60 border border-primary-800/60 rounded-lg p-6 text-left shadow-lg">
            <h3 className="font-semibold mb-4 text-primary-50">Features:</h3>
            <ul className="space-y-2 text-primary-200">
              <li className="flex items-start">
                <span className="text-accent-400 mr-2">✓</span>
                <span>End-to-end encrypted messaging</span>
              </li>
              <li className="flex items-start">
                <span className="text-accent-400 mr-2">✓</span>
                <span>Your data stays on your device</span>
              </li>
              <li className="flex items-start">
                <span className="text-accent-400 mr-2">✓</span>
                <span>No phone number required</span>
              </li>
              <li className="flex items-start">
                <span className="text-accent-400 mr-2">✓</span>
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

  if (step === 'wallet-choice') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <h2 className="text-3xl font-bold mb-2 text-primary-50">Choose How to Connect</h2>
          <p className="text-primary-200">
            Connect an existing wallet or create a new one
          </p>

          {error && (
            <div className="bg-red-500/10 border border-red-500 rounded-lg p-4">
              <p className="text-red-300">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            <button
              onClick={() => setStep('wallet-connect')}
              className="w-full p-6 bg-primary-900/60 hover:bg-primary-800 border-2 border-primary-800/60 hover:border-accent-400 rounded-lg transition-all text-left"
            >
              <div className="text-4xl mb-2">🔗</div>
              <div className="font-semibold text-lg mb-1 text-primary-50">Connect Wallet</div>
              <div className="text-sm text-primary-200">
                Use MetaMask, WalletConnect, or Coinbase Wallet
              </div>
            </button>

            <button
              onClick={handleGenerateWallet}
              className="w-full p-6 bg-primary-900/60 hover:bg-primary-800 border-2 border-primary-800/60 hover:border-accent-400 rounded-lg transition-all text-left"
            >
              <div className="text-4xl mb-2">✨</div>
              <div className="font-semibold text-lg mb-1 text-primary-50">Create New Wallet</div>
              <div className="text-sm text-primary-200">
                Generate a random wallet instantly
              </div>
            </button>
          </div>

          <button
            onClick={() => setStep('welcome')}
            className="text-primary-200 hover:text-primary-100 text-sm"
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (step === 'wallet-connect') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 p-4">
        <WalletSelector
          onWalletConnected={handleWalletConnected}
          onBack={() => setStep('wallet-choice')}
        />
      </div>
    );
  }

  if (step === 'creating') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 p-4">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="w-20 h-20 bg-primary-900/60 rounded-full flex items-center justify-center mx-auto mb-2">
            <div className="w-10 h-10 border-4 border-accent-400 border-t-transparent rounded-full animate-spin"></div>
          </div>
          <h2 className="text-2xl font-bold mb-2 text-primary-50">Creating Your Identity</h2>
          <p className="text-primary-200">
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

