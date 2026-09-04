// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_DEFAULTS } from '../src/shared/types';

/** Minimal chrome.storage.local so the background billing module can run. */
function installChromeStub(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string | null) =>
          key === null ? { ...store } : { [key]: store[key] },
        set: async (obj: Record<string, unknown>) => Object.assign(store, obj),
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  };
  return store;
}

const licenseResponse = (body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

describe('owner mode now rides on the server-verified adm_ token', () => {
  beforeEach(() => vi.resetModules());

  it('an adm_ token turns on owner mode as well as the plan', async () => {
    const store = installChromeStub({ settings: { ...STORAGE_DEFAULTS.settings } });
    vi.stubGlobal('fetch', licenseResponse({ active: true, plan: 'supreme', status: 'admin', renewsAt: null }));
    const { activateLicense } = await import('../src/background/billing');

    await activateLicense('adm_0123456789abcdef0123456789abcdef');
    const settings = store.settings as { plan: string; admin: boolean; licenseToken: string };
    expect(settings.admin).toBe(true);
    expect(settings.plan).toBe('supreme');
    expect(settings.licenseToken).toBe('adm_0123456789abcdef0123456789abcdef');
  });

  it('a paying customer never gets owner mode', async () => {
    const store = installChromeStub({ settings: { ...STORAGE_DEFAULTS.settings } });
    vi.stubGlobal('fetch', licenseResponse({ active: true, plan: 'pro', status: 'active', renewsAt: 1800000000 }));
    const { activateLicense } = await import('../src/background/billing');

    await activateLicense('cs_live_something');
    const settings = store.settings as { plan: string; admin: boolean };
    expect(settings.plan).toBe('pro');
    expect(settings.admin).toBe(false);
  });

  it('revoking the token on the server drops owner mode on the next re-check', async () => {
    const store = installChromeStub({
      settings: { ...STORAGE_DEFAULTS.settings, plan: 'supreme', admin: true, licenseToken: 'adm_dead' },
    });
    vi.stubGlobal('fetch', licenseResponse({ active: false, plan: 'free', status: 'not-found', renewsAt: null }));
    const { refreshLicense } = await import('../src/background/billing');

    await refreshLicense();
    const settings = store.settings as { plan: string; admin: boolean };
    expect(settings.admin).toBe(false);
    expect(settings.plan).toBe('free');
  });

  it('a network failure never locks the owner out', async () => {
    const store = installChromeStub({
      settings: { ...STORAGE_DEFAULTS.settings, plan: 'supreme', admin: true, licenseToken: 'adm_live' },
    });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { refreshLicense } = await import('../src/background/billing');

    await refreshLicense();
    const settings = store.settings as { plan: string; admin: boolean };
    expect(settings.admin).toBe(true);
    expect(settings.plan).toBe('supreme');
  });
});
