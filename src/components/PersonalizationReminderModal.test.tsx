import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PersonalizationReminderModal } from './PersonalizationReminderModal';
import { useAuthStore } from '@/lib/stores/auth-store';

vi.mock('@/lib/xmtp', () => ({
  getXmtpClient: () => ({
    isConnected: () => false,
    saveProfile: vi.fn(),
  }),
}));

describe('PersonalizationReminderModal onboarding mode', () => {
  beforeEach(() => {
    useAuthStore.setState({
      identity: {
        address: '0x1111111111111111111111111111111111111111',
        publicKey: '0xpublic',
        displayName: 'Orange Orca',
        inboxId: 'inbox-one',
        createdAt: 1,
      },
      isAuthenticated: false,
      isVaultUnlocked: false,
      vaultSecrets: null,
    });
  });

  it('keeps the generated name and uses dismissible Continue copy', () => {
    render(
      <PersonalizationReminderModal
        mode="onboarding"
        missingDisplayName
        missingAvatar
        onRemindLater={vi.fn()}
        onDismissForever={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: 'Choose your inbox profile' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Orange Orca')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.queryByText('Remind me tomorrow')).not.toBeInTheDocument();
    expect(screen.queryByText("Don't remind me again")).not.toBeInTheDocument();
  });
});
