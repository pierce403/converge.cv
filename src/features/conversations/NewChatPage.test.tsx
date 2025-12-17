import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NewChatPage } from './NewChatPage';
import { useAuthStore } from '@/lib/stores';

describe('NewChatPage', () => {
  it('prefills the input from ?to=', () => {
    useAuthStore.setState({
      isAuthenticated: false,
      isVaultUnlocked: false,
      identity: null,
      vaultSecrets: null,
    });

    const screen = render(
      <MemoryRouter initialEntries={['/new-chat?to=deanpierce.eth']}>
        <Routes>
          <Route path="/new-chat" element={<NewChatPage />} />
        </Routes>
      </MemoryRouter>
    );

    const input = screen.getByLabelText(/ethereum address or ens name/i) as HTMLInputElement;
    expect(input.value).toBe('deanpierce.eth');
  });
});

