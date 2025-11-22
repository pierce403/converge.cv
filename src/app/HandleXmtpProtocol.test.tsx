import { render, waitFor } from '@testing-library/react';
import { HandleXmtpProtocol } from './HandleXmtpProtocol';
import { vi, describe, it, beforeEach, expect } from 'vitest';

// Mock react-router-dom hooks to control navigation + location
const navigateMock = vi.fn();
let locationSearch = '';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useLocation: () => ({ search: locationSearch } as unknown as ReturnType<typeof actual.useLocation>),
  };
});

describe('HandleXmtpProtocol', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    locationSearch = '';
  });

  it('routes DM links to /i/:inboxId and emits a toast', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    locationSearch = '?url=web%2Bxmtp://dm/abc123';

    render(<HandleXmtpProtocol />);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/i/abc123');
    });
    expect(dispatchSpy).toHaveBeenCalled();
    const event = dispatchSpy.mock.calls.find(([evt]) => evt instanceof CustomEvent && evt.detail === 'Opening XMTP conversation…');
    expect(event).toBeTruthy();
    dispatchSpy.mockRestore();
  });

  it('rejects group links and stays on home', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    locationSearch = '?url=web%2Bxmtp://chat/somegroup';

    render(<HandleXmtpProtocol />);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/');
    });
    const event = dispatchSpy.mock.calls.find(
      ([evt]) => evt instanceof CustomEvent && /Group links are not supported/i.test(String((evt as CustomEvent).detail))
    );
    expect(event).toBeTruthy();
    dispatchSpy.mockRestore();
  });
});
