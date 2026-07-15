import { beforeEach, describe, expect, it } from 'vitest';
import { aiBusy, aiInFlight, aiLaneOpen, enterAiLane, leaveAiLane } from '../src/planner/aiLock';

describe('AI priority lane', () => {
  beforeEach(() => {
    aiInFlight.value = 0;
  });

  it('serializes Free/Pro: lane closes after one request', () => {
    expect(aiLaneOpen(false)).toBe(true);
    enterAiLane();
    expect(aiLaneOpen(false)).toBe(false);
    leaveAiLane();
    expect(aiLaneOpen(false)).toBe(true);
  });

  it('gives Supreme a 3-wide lane', () => {
    enterAiLane();
    enterAiLane();
    expect(aiLaneOpen(true)).toBe(true); // 2 in flight, room for a 3rd
    enterAiLane();
    expect(aiLaneOpen(true)).toBe(false); // full at 3
    leaveAiLane();
    expect(aiLaneOpen(true)).toBe(true);
  });

  it('a busy Supreme lane still blocks standard users', () => {
    enterAiLane();
    expect(aiLaneOpen(true)).toBe(true);
    expect(aiLaneOpen(false)).toBe(false);
  });

  it('aiBusy reflects any in-flight request and never goes negative', () => {
    expect(aiBusy.value).toBe(false);
    enterAiLane();
    expect(aiBusy.value).toBe(true);
    leaveAiLane();
    leaveAiLane(); // extra leave must not underflow
    expect(aiInFlight.value).toBe(0);
    expect(aiBusy.value).toBe(false);
  });
});
