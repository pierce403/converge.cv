import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MessageComposer } from './MessageComposer';

describe('MessageComposer', () => {
  it('does not force the send button to bottom alignment', () => {
    render(<MessageComposer onSend={vi.fn()} />);

    const sendButton = screen.getByRole('button', { name: 'Send message' });
    expect(sendButton.className).not.toContain('self-end');
  });

  it('sends trimmed message when tapping the send button', () => {
    const onSend = vi.fn();

    render(<MessageComposer onSend={onSend} />);

    const textarea = screen.getByPlaceholderText('Type a message...');
    fireEvent.change(textarea, { target: { value: '  Hello there  ' } });

    const sendButton = screen.getByRole('button', { name: 'Send message' });
    fireEvent.pointerDown(sendButton);
    fireEvent.click(sendButton);

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Hello there');
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });
});
