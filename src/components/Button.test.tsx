/**
 * Button component tests (example)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('Button Component', () => {
  it('should render basic button', () => {
    render(<button>Click me</button>);
    expect(screen.getByText('Click me')).toBeTruthy();
  });

  it('should handle disabled state', () => {
    render(<button disabled>Disabled</button>);
    const button = screen.getByText('Disabled') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});

