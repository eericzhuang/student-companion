import { describe, expect, it } from 'vitest';
import { parseLocalDateTime, reminderFires, reminderMessage } from '../src/background/reminders';
import type { TermConfig } from '../src/shared/types';

const term = (over: Partial<TermConfig> = {}): TermConfig => ({
  id: 'f26',
  label: 'Fall 2026',
  creditCap: 18,
  registrationAt: '2026-11-05T08:00',
  ...over,
});

describe('registration reminders', () => {
  it('parses datetime-local values', () => {
    const t = parseLocalDateTime('2026-11-05T08:00')!;
    expect(new Date(t).getHours()).toBe(8);
    expect(parseLocalDateTime('nope')).toBeNull();
    expect(parseLocalDateTime(undefined)).toBeNull();
  });

  it('creates 24h and 10m firings only when still in the future', () => {
    const at = parseLocalDateTime('2026-11-05T08:00')!;
    const wayBefore = reminderFires([term()], at - 48 * 3600_000);
    expect(wayBefore.map((f) => f.kind)).toEqual(['24h', '10m']);
    expect(wayBefore[0]!.when).toBe(at - 24 * 3600_000);
    const between = reminderFires([term()], at - 3600_000);
    expect(between.map((f) => f.kind)).toEqual(['10m']);
    expect(reminderFires([term()], at + 1)).toHaveLength(0);
    expect(reminderFires([term({ registrationAt: undefined })], 0)).toHaveLength(0);
  });

  it('renders messages and ignores unknown alarms/terms', () => {
    const msg = reminderMessage('reg:f26:10m', [term()])!;
    expect(msg.title).toContain('10 minutes');
    expect(msg.message).toContain('Fall 2026');
    expect(reminderMessage('reg:gone:24h', [term()])).toBeNull();
    expect(reminderMessage('rmp-cache-sweep', [term()])).toBeNull();
  });
});
