import { ConnectButton } from 'thirdweb/react';
import { getThirdwebClient } from '@/lib/wallets/providers';
import { runWithWalletSignatureStatus } from '@/lib/wagmi/signature-status';

interface ThirdwebConnectButtonProps {
  onConnected?: (
    address: string,
    chainId: number | undefined,
    signMessage: (message: string) => Promise<string>
  ) => void | Promise<void>;
  label?: string;
  className?: string;
}

export function ThirdwebConnectButton({ onConnected, label, className }: ThirdwebConnectButtonProps) {
  const client = getThirdwebClient();

  if (!client) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
        Thirdweb client ID missing. Set VITE_THIRDWEB_CLIENT_ID to enable the Connect modal.
      </div>
    );
  }

  return (
    <ConnectButton
      client={client}
      theme="dark"
      connectButton={{
        label: label ?? 'Continue with Thirdweb',
        className: className ?? 'w-full',
      }}
      connectModal={{
        size: 'compact',
        title: 'Connect with Thirdweb',
      }}
      onConnect={(wallet) => {
        const account = wallet.getAccount();
        if (account?.address) {
          void Promise.resolve(
            onConnected?.(
              account.address,
              wallet.getChain()?.id,
              async (message) =>
                await runWithWalletSignatureStatus({
                  provider: 'thirdweb',
                  message,
                  run: async () => await account.signMessage({ message }),
                })
            )
          ).catch((error) => {
            console.error('[Thirdweb] Connected wallet could not continue onboarding:', error);
          });
        }
      }}
    />
  );
}
