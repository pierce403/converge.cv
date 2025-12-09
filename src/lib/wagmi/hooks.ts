/**
 * Wagmi hooks for wallet operations
 */

import { useCallback } from 'react';
import { useAccount, useConnect, useDisconnect, useConnectors } from 'wagmi';

export type WalletConnectorType = 'MetaMask' | 'Coinbase Wallet' | 'WalletConnect' | 'Injected';

export function useWalletConnection() {
  const account = useAccount();
  const { connectAsync, isPending: isConnecting } = useConnect();
  const { disconnectAsync, isPending: isDisconnecting } = useDisconnect();
  const connectors = useConnectors();

  const connectWallet = useCallback(
    async (connectorType: WalletConnectorType) => {
      const connector = connectors.find((c) => c.name === connectorType);
      if (!connector) {
        throw new Error(`Connector ${connectorType} not found`);
      }
      return await connectAsync({ connector });
    },
    [connectors, connectAsync]
  );

  const connectDefaultWallet = useCallback(async () => {
    const connector = connectors[0];
    if (!connector) {
      throw new Error('No wallet connectors are available.');
    }
    return await connectAsync({ connector });
  }, [connectAsync, connectors]);

  const disconnectWallet = useCallback(async () => {
    await disconnectAsync();
  }, [disconnectAsync]);

  return {
    account,
    address: account.address,
    chainId: account.chainId,
    isConnected: !!account.address,
    isConnecting,
    isDisconnecting,
    connectWallet,
    connectDefaultWallet,
    disconnectWallet,
    connectors,
  };
}
