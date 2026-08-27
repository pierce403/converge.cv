import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TypingIndicator } from './TypingIndicator';

describe('TypingIndicator', () => {
  it('renders one accessible animated three-dot bubble without a timestamp', () => {
    const { container } = render(<TypingIndicator label="Alice is typing..." />);

    expect(screen.getByRole('status', { name: 'Alice is typing...' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-typing-dot]')).toHaveLength(3);
    expect(container.querySelector('time')).toBeNull();
  });
});
