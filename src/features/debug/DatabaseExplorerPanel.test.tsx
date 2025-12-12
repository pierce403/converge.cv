import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseExplorerPanel } from './DatabaseExplorerPanel';

const mockStorage = {
  listContacts: vi.fn(async () => [] as unknown[]),
  listConversations: vi.fn(async () => [] as unknown[]),
  listIdentities: vi.fn(async () => [] as unknown[]),
  listDeletedConversations: vi.fn(async () => [] as unknown[]),
  searchMessages: vi.fn(async () => [] as unknown[]),
  listMessages: vi.fn(async () => [] as unknown[]),
};

vi.mock('@/lib/storage', () => ({
  getStorage: vi.fn(async () => mockStorage),
  getStorageNamespace: () => 'default',
}));

describe('DatabaseExplorerPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads contacts and applies a string filter', async () => {
    mockStorage.listContacts.mockResolvedValueOnce([
      { inboxId: 'inbox-a', name: 'Alice', createdAt: 0 },
      { inboxId: 'inbox-b', name: 'Bob', createdAt: 0 },
    ]);

    render(<DatabaseExplorerPanel />);

    fireEvent.change(screen.getByLabelText(/filter/i), { target: { value: 'alice' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    expect(await screen.findByText('inbox-a')).toBeTruthy();
    expect(screen.queryByText('inbox-b')).toBeNull();
    expect(mockStorage.listContacts).toHaveBeenCalledTimes(1);
  });

  it('searches messages globally when no conversationId is provided', async () => {
    mockStorage.searchMessages.mockResolvedValueOnce([
      {
        id: 'm1',
        conversationId: 'c1',
        sender: 'inbox-1',
        sentAt: 5,
        type: 'text',
        body: 'hello world',
        status: 'sent',
        reactions: [],
      },
    ]);

    render(<DatabaseExplorerPanel />);

    fireEvent.change(screen.getByLabelText(/table/i), { target: { value: 'messages' } });
    fireEvent.change(screen.getByLabelText(/^filter$/i), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => expect(mockStorage.searchMessages).toHaveBeenCalledWith('hello', 50));
    expect(await screen.findByText('m1')).toBeTruthy();
  });

  it('paginates messages by conversationId using offsets', async () => {
    const firstPage = Array.from({ length: 50 }, (_, i) => ({
      id: `m${i}`,
      conversationId: 'c1',
      sender: 'inbox-1',
      sentAt: i,
      type: 'text' as const,
      body: `msg ${i}`,
      status: 'sent' as const,
      reactions: [],
    }));

    mockStorage.listMessages
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([]);

    render(<DatabaseExplorerPanel />);

    fireEvent.change(screen.getByLabelText(/table/i), { target: { value: 'messages' } });
    fireEvent.change(screen.getByLabelText(/conversation id/i), { target: { value: 'c1' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    expect(await screen.findByText('m49')).toBeTruthy();
    await waitFor(() => expect(mockStorage.listMessages).toHaveBeenCalledWith('c1', { limit: 50, offset: 0 }));

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    await waitFor(() => expect(mockStorage.listMessages).toHaveBeenCalledWith('c1', { limit: 50, offset: 50 }));
  });
});
