/** Subscription / feature-gating helpers. */
import type { Settings } from './types';
import { billingEnabled } from './billing';

/**
 * Whether AI features (degree/transcript parsing, the semester advisor,
 * professor summaries) are available. AI is a Pro-only capability — free users
 * cannot unlock it, even with their own API key.
 */
export function isPro(settings: Pick<Settings, 'plan' | 'admin'>): boolean {
  return settings.plan === 'pro' || settings.plan === 'supreme' || settings.admin === true;
}

/**
 * Supreme = Pro + the token-heavy web-research features (degree auto-find,
 * prerequisite auto-find). Those fan out into many web searches/fetches per
 * run, so they carry their own tier.
 */
export function isSupreme(settings: Pick<Settings, 'plan' | 'admin'>): boolean {
  return settings.plan === 'supreme' || settings.admin === true;
}

export function aiAvailable(settings: Pick<Settings, 'plan' | 'admin'>): boolean {
  return isPro(settings);
}

/**
 * Can an AI call actually run right now? Pro (or admin) is required. With
 * billing live, AI runs through our relay on the subscription's activation
 * code — subscribers never supply an API key. In free-beta/dev mode (billing
 * off) the legacy bring-your-own-key path still applies. Returns a reason
 * when it can't, for user-facing messaging. `billing` is injectable for tests.
 */
export function aiCallStatus(
  settings: Pick<Settings, 'plan' | 'admin' | 'claudeApiKey' | 'licenseToken'>,
  billing: boolean = billingEnabled(),
): { ok: true } | { ok: false; reason: 'not-pro' | 'pro-needs-key' | 'needs-license' } {
  if (!isPro(settings)) return { ok: false, reason: 'not-pro' };
  if (billing) {
    if (!settings.licenseToken) return { ok: false, reason: 'needs-license' };
    return { ok: true };
  }
  if (!settings.claudeApiKey) return { ok: false, reason: 'pro-needs-key' };
  return { ok: true };
}
