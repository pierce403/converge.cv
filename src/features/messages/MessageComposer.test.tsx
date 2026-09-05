import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessageComposer } from './MessageComposer';

describe('MessageComposer', () => {
  it.each(['success', 'failure'] as const)(
    'keeps keyboard focus during and after a send (%s)',
    async (outcome) => {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const onSend = vi.fn(() => new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      }));
      render(<MessageComposer onSend={onSend} />);
      const textarea = screen.getByRole('textbox');
      textarea.focus();
      fireEvent.change(textarea, { target: { value: 'Hello' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });

      expect(textarea).toBeEnabled();
      expect(textarea).toHaveFocus();
      expect(textarea).toHaveAttribute('readonly');
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(onSend).toHaveBeenCalledTimes(1);

      await act(async () => {
        if (outcome === 'success') resolve();
        else reject(new Error('offline'));
      });
      expect(textarea).toHaveFocus();
      expect(textarea).not.toHaveAttribute('readonly');
      expect(textarea).toHaveValue(outcome === 'success' ? '' : 'Hello');
      fireEvent.change(textarea, { target: { value: 'Next message' } });
      expect(textarea).toHaveValue('Next message');
    },
  );

  it('does not force the send button to bottom alignment', () => {
    render(<MessageComposer onSend={vi.fn()} />);

    const sendButton = screen.getByRole('button', { name: 'Send message' });
    expect(sendButton.className).not.toContain('self-end');
  });

  it('limits the image picker to the formats the receiver validates', () => {
    const { container } = render(<MessageComposer onSend={vi.fn()} />);

    expect(container.querySelector('input[type="file"]')).toHaveAttribute(
      'accept',
      'image/jpeg,image/png,image/webp',
    );
  });

  it('sends trimmed message when tapping the send button', async () => {
    const onSend = vi.fn(async () => undefined);

    render(<MessageComposer onSend={onSend} />);

    const textarea = screen.getByPlaceholderText('Type a message...');
    fireEvent.change(textarea, { target: { value: '  Hello there  ' } });

    const sendButton = screen.getByRole('button', { name: 'Send message' });
    fireEvent.pointerDown(sendButton);
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
      expect(onSend).toHaveBeenCalledWith('Hello there');
      expect((textarea as HTMLTextAreaElement).value).toBe('');
    });
  });

  it('preserves the draft when publishing fails', async () => {
    const onSend = vi.fn(async () => {
      throw new Error('offline');
    });

    render(<MessageComposer onSend={onSend} />);

    const textarea = screen.getByPlaceholderText('Type a message...');
    fireEvent.change(textarea, { target: { value: 'Please keep this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
      expect((textarea as HTMLTextAreaElement).value).toBe('Please keep this');
    });
  });

  it('does not complete an attachment send when publishing fails', async () => {
    const onSendAttachment = vi.fn(async () => {
      throw new Error('offline');
    });
    const onSent = vi.fn();
    const { container } = render(
      <MessageComposer
        onSend={vi.fn()}
        onSendAttachment={onSendAttachment}
        onSent={onSent}
      />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1])], 'photo.png', { type: 'image/png' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(onSendAttachment).toHaveBeenCalledWith(file);
      expect(onSent).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Attach image' })).toBeEnabled();
    });
  });

  it('does not send Enter while an input method is composing text', () => {
    const onSend = vi.fn();
    render(<MessageComposer onSend={onSend} />);

    const textarea = screen.getByPlaceholderText('Type a message...');
    fireEvent.change(textarea, { target: { value: 'こんにちは' } });
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true });

    expect(onSend).not.toHaveBeenCalled();
    expect((textarea as HTMLTextAreaElement).value).toBe('こんにちは');
  });
});
