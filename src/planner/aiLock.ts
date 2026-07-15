/**
 * AI request lane, shared across the planner's AI features (advisor chat,
 * degree research, prerequisite lookup). The MV3 keepalive makes long requests
 * safe, but unbounded parallelism still risks port churn and runaway credit
 * burn — so Free/Pro serialize (one request at a time) while Supreme gets a
 * priority lane: up to 3 AI requests running concurrently.
 */
import { computed, signal } from '@preact/signals';

const SUPREME_LANE_WIDTH = 3;
const STANDARD_LANE_WIDTH = 1;

/** Number of AI requests currently in flight. */
export const aiInFlight = signal(0);

/** True when at least one AI request is running (read-only). */
export const aiBusy = computed(() => aiInFlight.value > 0);

/** Whether a new AI request may start under the given plan's lane width. */
export function aiLaneOpen(supreme: boolean): boolean {
  return aiInFlight.value < (supreme ? SUPREME_LANE_WIDTH : STANDARD_LANE_WIDTH);
}

/** Human message for when the lane is full, tiered to the plan. */
export function aiLaneFullMessage(supreme: boolean): string {
  return supreme
    ? 'Three AI requests are already running — wait for one to finish.'
    : 'Another AI request is still running — please wait for it to finish. (Supreme runs several at once.)';
}

export function enterAiLane(): void {
  aiInFlight.value = aiInFlight.value + 1;
}

export function leaveAiLane(): void {
  aiInFlight.value = Math.max(0, aiInFlight.value - 1);
}
