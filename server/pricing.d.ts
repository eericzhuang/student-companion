/** Types for pricing.js so the vitest suite can exercise the relay's math. */
export interface UsageBlock {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  server_tool_use?: { web_search_requests?: number };
}
export const MODEL_PRICES: Record<string, { in: number; out: number; cacheWrite: number; cacheRead: number }>;
export const ALLOWED_MODELS: string[];
export const WEB_SEARCH_COST_CENTS: number;
export const PLAN_BUDGET_CENTS: { pro: number; supreme: number };
export function costCents(model: string, usage: UsageBlock | undefined): number;
export function monthKey(now?: Date): string;
