/**
 * Cost accounting for relayed AI calls. Pure math, no I/O — unit-tested from
 * test/pricing.test.ts.
 *
 * Prices are STANDARD (non-promotional) Anthropic list prices in dollars per
 * million tokens, so budgets stay safe if an intro discount lapses. Web fetch
 * has no per-use fee (fetched pages bill as input tokens, already counted).
 */

export const MODEL_PRICES = {
  'claude-sonnet-5': { in: 3, out: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5': { in: 1, out: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

/** Only models the relay will forward — nobody runs Opus on our dime. */
export const ALLOWED_MODELS = Object.keys(MODEL_PRICES);

/** $10 per 1,000 web searches. */
export const WEB_SEARCH_COST_CENTS = 1;

/**
 * Included monthly AI budget per plan, in cents of underlying API cost.
 * Pro $6.99 keeps ≥ $3.30 after Stripe fees even if the budget is fully used;
 * Supreme $14.99 keeps ≥ $6.90. Typical users use a fraction of this.
 */
export const PLAN_BUDGET_CENTS = { pro: 300, supreme: 700 };

/** Cost of one completed call, in (fractional) cents, from the API's usage block. */
export function costCents(model, usage) {
  const p = MODEL_PRICES[model] ?? MODEL_PRICES['claude-sonnet-5'];
  const cents = (dollarsPerM, tokens) => (dollarsPerM * 100 * (tokens || 0)) / 1e6;
  return (
    cents(p.in, usage?.input_tokens) +
    cents(p.out, usage?.output_tokens) +
    cents(p.cacheWrite, usage?.cache_creation_input_tokens) +
    cents(p.cacheRead, usage?.cache_read_input_tokens) +
    (usage?.server_tool_use?.web_search_requests || 0) * WEB_SEARCH_COST_CENTS
  );
}

/** "2026-07" — budget periods are calendar months (simple and predictable). */
export function monthKey(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
