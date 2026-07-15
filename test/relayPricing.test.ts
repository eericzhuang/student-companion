import { describe, expect, it } from 'vitest';
import { ALLOWED_MODELS, PLAN_BUDGET_CENTS, WEB_SEARCH_COST_CENTS, costCents, monthKey } from '../server/pricing.js';
import { aiCallStatus } from '../src/shared/plan';

describe('AI relay pricing', () => {
  it('prices a plain sonnet call from its usage block', () => {
    // 10k in @ $3/M = 3¢; 1k out @ $15/M = 1.5¢
    expect(costCents('claude-sonnet-5', { input_tokens: 10_000, output_tokens: 1_000 })).toBeCloseTo(4.5, 5);
  });

  it('counts cache and web-search charges', () => {
    const c = costCents('claude-sonnet-5', {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 8_000, // @ $3.75/M = 3¢
      cache_read_input_tokens: 100_000, // @ $0.30/M = 3¢
      server_tool_use: { web_search_requests: 5 }, // 5 × 1¢
    });
    expect(c).toBeCloseTo(3 + 3 + 5 * WEB_SEARCH_COST_CENTS, 5); // = 11¢
  });

  it('haiku is priced on the cheaper table', () => {
    expect(costCents('claude-haiku-4-5', { input_tokens: 1_000_000 })).toBeCloseTo(100, 5); // $1
  });

  it('unknown models fall back to the sonnet table (never undercharge)', () => {
    expect(costCents('made-up-model', { output_tokens: 1_000_000 })).toBeCloseTo(1500, 5);
  });

  it('budgets leave margin after Stripe fees at the new prices', () => {
    // Pro $6.99 → Stripe keeps ~50¢ → 649¢ net; budget must leave real margin.
    expect(649 - PLAN_BUDGET_CENTS.pro).toBeGreaterThan(300);
    // Supreme $14.99 → ~1456¢ net.
    expect(1456 - PLAN_BUDGET_CENTS.supreme).toBeGreaterThan(700);
  });

  it('only relay-priced models are forwardable', () => {
    expect(ALLOWED_MODELS).toContain('claude-sonnet-5');
    expect(ALLOWED_MODELS).toContain('claude-haiku-4-5');
    expect(ALLOWED_MODELS).toHaveLength(2);
  });

  it('monthKey is a stable YYYY-MM', () => {
    expect(monthKey(new Date('2026-07-16T12:00:00Z'))).toBe('2026-07');
    expect(monthKey(new Date('2026-12-01T00:00:00Z'))).toBe('2026-12');
  });
});

describe('aiCallStatus with billing live', () => {
  const base = { plan: 'pro' as const, admin: false, claudeApiKey: null, licenseToken: null };

  it('requires an activated license instead of an API key', () => {
    expect(aiCallStatus(base, true)).toEqual({ ok: false, reason: 'needs-license' });
    expect(aiCallStatus({ ...base, licenseToken: 'cs_x' }, true)).toEqual({ ok: true });
    // a saved key is irrelevant once billing is live
    expect(aiCallStatus({ ...base, claudeApiKey: 'sk-ant-x' }, true)).toEqual({ ok: false, reason: 'needs-license' });
  });

  it('beta mode still uses the key path', () => {
    expect(aiCallStatus(base, false)).toEqual({ ok: false, reason: 'pro-needs-key' });
    expect(aiCallStatus({ ...base, claudeApiKey: 'sk-ant-x' }, false)).toEqual({ ok: true });
  });

  it('free users are refused in both modes', () => {
    const free = { ...base, plan: 'free' as const };
    expect(aiCallStatus(free, true)).toEqual({ ok: false, reason: 'not-pro' });
    expect(aiCallStatus(free, false)).toEqual({ ok: false, reason: 'not-pro' });
  });
});
