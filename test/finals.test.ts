import { describe, expect, it } from 'vitest';
import { finalConflictIds, sortFinals, timeInputToMinutes } from '../src/shared/finals';
import { buildIcs } from '../src/shared/ics';
import type { FinalExam } from '../src/shared/types';

const f = (id: string, date: string, startMin: number, endMin: number): FinalExam => ({
  id,
  code: id.toUpperCase(),
  date,
  startMin,
  endMin,
});

describe('finals', () => {
  it('sorts by date then time', () => {
    const sorted = sortFinals([f('b', '2026-12-15', 540, 660), f('a', '2026-12-14', 840, 960), f('c', '2026-12-15', 480, 530)]);
    expect(sorted.map((x) => x.id)).toEqual(['a', 'c', 'b']);
  });

  it('flags only same-date overlapping sittings', () => {
    const ids = finalConflictIds([
      f('a', '2026-12-14', 540, 660),
      f('b', '2026-12-14', 600, 720), // overlaps a
      f('c', '2026-12-15', 540, 660), // same time, other day — fine
      f('d', '2026-12-14', 720, 840), // back-to-back with b — fine
    ]);
    expect([...ids].sort()).toEqual(['a', 'b']);
  });

  it('parses time-input values', () => {
    expect(timeInputToMinutes('09:05')).toBe(545);
    expect(timeInputToMinutes('23:59')).toBe(1439);
    expect(timeInputToMinutes('')).toBeNull();
  });

  it('exports finals as one-off ICS events (no RRULE)', () => {
    const ics = buildIcs([], {
      termStart: '2026-08-24',
      finals: [{ ...f('final:cs', '2026-12-14', 540, 690), code: 'CS 2110', location: 'Barton Hall' }],
      now: new Date(2026, 6, 18),
    });
    expect(ics).toContain('SUMMARY:🎓 FINAL — CS 2110');
    expect(ics).toContain('DTSTART:20261214T090000');
    expect(ics).toContain('DTEND:20261214T113000');
    expect(ics).toContain('LOCATION:Barton Hall');
    const evt = ics.split('BEGIN:VEVENT')[1]!;
    expect(evt).not.toContain('RRULE');
  });
});
