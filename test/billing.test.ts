import { describe, expect, it } from 'vitest';
import { daysUntil, summarizeSubscription, type LicenseStatus } from '../src/shared/billing';

const NOW = Date.UTC(2026, 2, 1, 12, 0, 0); // 1 Mar 2026, noon UTC
/** Stripe reports period ends in epoch SECONDS, not milliseconds. */
const inDays = (n: number) => Math.floor((NOW + n * 86_400_000) / 1000);

const sub = (over: Partial<LicenseStatus> = {}): LicenseStatus => ({
  active: true,
  plan: 'pro',
  status: 'active',
  renewsAt: inDays(12),
  ...over,
});

describe('daysUntil', () => {
  it('converts Stripe seconds and rounds partial days up', () => {
    expect(daysUntil(inDays(12), NOW)).toBe(12);
    // 11.5 days left still reads as 12, never 11 — a partial day is a day
    expect(daysUntil(inDays(11.5), NOW)).toBe(12);
    expect(daysUntil(inDays(1), NOW)).toBe(1);
  });
  it('never goes negative once the period has passed', () => {
    expect(daysUntil(inDays(-3), NOW)).toBe(0);
    expect(daysUntil(inDays(0), NOW)).toBe(0);
  });
  it('returns null when there is no period (owner unlock)', () => {
    expect(daysUntil(null, NOW)).toBeNull();
  });
});

describe('summarizeSubscription', () => {
  it('counts down to the next renewal', () => {
    const s = summarizeSubscription(sub(), NOW);
    expect(s.headline).toBe('Renews in 12 days');
    expect(s.ending).toBe(false);
    expect(s.detail).toContain('March 13, 2026');
  });

  it('singularises the last day', () => {
    expect(summarizeSubscription(sub({ renewsAt: inDays(1) }), NOW).headline).toBe('Renews in 1 day');
  });

  it('says "today" rather than "in 0 days"', () => {
    expect(summarizeSubscription(sub({ renewsAt: inDays(0) }), NOW).headline).toBe('Renews today');
  });

  it('a cancelled subscription counts down to loss of access, not renewal', () => {
    const s = summarizeSubscription(sub({ cancelAtPeriodEnd: true }), NOW);
    expect(s.headline).toBe('Ends in 12 days');
    expect(s.ending).toBe(true);
    expect(s.detail).toContain('resume');
  });

  it('trials are labelled as trials', () => {
    expect(summarizeSubscription(sub({ status: 'trialing' }), NOW).headline).toBe('Trial ends in 12 days');
  });

  it('past_due keeps access but warns about the card', () => {
    const s = summarizeSubscription(sub({ status: 'past_due' }), NOW);
    expect(s.headline).toBe('Payment failed');
    expect(s.ending).toBe(false);
  });

  it('owner unlock has nothing to cancel', () => {
    const s = summarizeSubscription({ active: true, plan: 'supreme', status: 'admin', renewsAt: null }, NOW);
    expect(s.headline).toBe('Owner unlock');
    expect(s.detail).toContain('nothing to cancel');
  });

  it('an inactive subscription never shows a countdown', () => {
    const s = summarizeSubscription(sub({ active: false, status: 'canceled', plan: 'free' }), NOW);
    expect(s.headline).toBe('Not active');
    expect(s.ending).toBe(false);
  });
});
