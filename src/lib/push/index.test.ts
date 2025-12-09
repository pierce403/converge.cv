import { describe, expect, it, vi, beforeEach } from 'vitest';
import { registerServiceWorkerForPush } from './index';

describe('push index helpers', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips registration when service workers unsupported', async () => {
    vi.stubGlobal('navigator', {} as Navigator);
    const result = await registerServiceWorkerForPush();
    expect(result).toBeNull();
  });

  it('registers service worker when available', async () => {
    const readyPromise = Promise.resolve({} as ServiceWorkerRegistration);
    const register = vi.fn(async () => ({} as ServiceWorkerRegistration));
    const navigatorMock = {
      serviceWorker: {
        register,
        ready: readyPromise,
      },
    } as unknown as Navigator;
    vi.stubGlobal('navigator', navigatorMock);

    const reg = await registerServiceWorkerForPush();
    expect(register).toHaveBeenCalledWith('/sw.js');
    expect(reg).toBeTruthy();
  });
});
