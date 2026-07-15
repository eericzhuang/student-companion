import { describe, expect, it } from 'vitest';
import {
  computeFreeSlots,
  findConflicts,
  formatMinutes,
  meetingsOverlap,
  parseClockTime,
  parseCompactDays,
  parseDays,
  parseMeetingPattern,
  parseMeetingPatterns,
} from '../src/shared/time';
import { DAYS, type Section } from '../src/shared/types';

describe('parseClockTime', () => {
  it('parses 12-hour times', () => {
    expect(parseClockTime('10:00 AM')).toBe(600);
    expect(parseClockTime('1:30PM')).toBe(810);
    expect(parseClockTime('12:00 PM')).toBe(720);
    expect(parseClockTime('12:15 AM')).toBe(15);
    expect(parseClockTime('9:05 p.m.')).toBe(1265);
  });
  it('parses 24-hour times', () => {
    expect(parseClockTime('13:30')).toBe(810);
    expect(parseClockTime('09:00')).toBe(540);
  });
  it('rejects garbage', () => {
    expect(parseClockTime('25:00')).toBeNull();
    expect(parseClockTime('10:75 AM')).toBeNull();
    expect(parseClockTime('noon')).toBeNull();
  });
});

describe('day parsing', () => {
  it('parses compact strings', () => {
    expect(parseCompactDays('MWF')).toBe(DAYS.MON | DAYS.WED | DAYS.FRI);
    expect(parseCompactDays('TTh')).toBe(DAYS.TUE | DAYS.THU);
    expect(parseCompactDays('TR')).toBe(DAYS.TUE | DAYS.THU);
    expect(parseCompactDays('MTWThF')).toBe(
      DAYS.MON | DAYS.TUE | DAYS.WED | DAYS.THU | DAYS.FRI,
    );
  });
  it('parses day lists', () => {
    expect(parseDays('Mon/Wed/Fri')).toBe(DAYS.MON | DAYS.WED | DAYS.FRI);
    expect(parseDays('Tue Thu')).toBe(DAYS.TUE | DAYS.THU);
    expect(parseDays('Monday, Wednesday')).toBe(DAYS.MON | DAYS.WED);
  });
});

describe('parseMeetingPattern', () => {
  it('parses inline format', () => {
    const m = parseMeetingPattern('MWF 10:00 AM - 10:50 AM');
    expect(m).toEqual({
      days: DAYS.MON | DAYS.WED | DAYS.FRI,
      startMin: 600,
      endMin: 650,
      location: undefined,
    });
  });
  it('parses Workday pipe format with location', () => {
    const m = parseMeetingPattern('Mon/Wed | 1:00 PM - 2:15 PM | Science Hall 101');
    expect(m?.days).toBe(DAYS.MON | DAYS.WED);
    expect(m?.startMin).toBe(780);
    expect(m?.endMin).toBe(855);
    expect(m?.location).toBe('Science Hall 101');
  });
  it('parses 24h and en-dash', () => {
    const m = parseMeetingPattern('TTh 13:30–14:45');
    expect(m?.days).toBe(DAYS.TUE | DAYS.THU);
    expect(m?.startMin).toBe(810);
    expect(m?.endMin).toBe(885);
  });
  it('assumes PM crossing noon when meridiem missing', () => {
    const m = parseMeetingPattern('MW 11:00 - 1:50');
    expect(m?.startMin).toBe(660);
    expect(m?.endMin).toBe(13 * 60 + 50);
  });
  it('returns null on unparseable input', () => {
    expect(parseMeetingPattern('TBA')).toBeNull();
    expect(parseMeetingPattern('Online Asynchronous')).toBeNull();
    expect(parseMeetingPattern('')).toBeNull();
  });
  it('parses multiple patterns from a blob', () => {
    const ms = parseMeetingPatterns('MWF 9:00 AM - 9:50 AM\nT 2:00 PM - 4:00 PM');
    expect(ms).toHaveLength(2);
  });
});

describe('conflicts', () => {
  const mk = (id: string, days: number, start: number, end: number): Section => ({
    sectionId: id,
    courseCode: id,
    title: id,
    credits: 3,
    instructor: null,
    meetings: [{ days, startMin: start, endMin: end }],
  });

  it('detects overlap on shared days', () => {
    expect(
      meetingsOverlap(
        { days: DAYS.MON | DAYS.WED, startMin: 600, endMin: 650 },
        { days: DAYS.WED, startMin: 640, endMin: 700 },
      ),
    ).toBe(true);
  });
  it('no overlap on disjoint days or times', () => {
    expect(
      meetingsOverlap(
        { days: DAYS.MON, startMin: 600, endMin: 650 },
        { days: DAYS.TUE, startMin: 600, endMin: 650 },
      ),
    ).toBe(false);
    expect(
      meetingsOverlap(
        { days: DAYS.MON, startMin: 600, endMin: 650 },
        { days: DAYS.MON, startMin: 650, endMin: 700 },
      ),
    ).toBe(false);
  });
  it('findConflicts excludes self and finds overlapping sections', () => {
    const schedule = [mk('A', DAYS.MON, 600, 650), mk('B', DAYS.MON, 630, 700)];
    const candidate = mk('C', DAYS.MON, 640, 660);
    expect(findConflicts(candidate, schedule).map((s) => s.sectionId)).toEqual(['A', 'B']);
    expect(findConflicts(schedule[0]!, schedule).map((s) => s.sectionId)).toEqual(['B']);
  });
});

describe('computeFreeSlots', () => {
  const mk = (id: string, days: number, start: number, end: number): Section => ({
    sectionId: id,
    courseCode: id,
    title: id,
    credits: 3,
    instructor: null,
    meetings: [{ days, startMin: start, endMin: end }],
  });

  it('returns open windows around a class', () => {
    // Mon class 10:00–10:50 within 8:00–21:00 window
    const days = computeFreeSlots([mk('A', DAYS.MON, 600, 650)]);
    const mon = days.find((d) => d.label === 'Mon')!;
    expect(mon.slots).toEqual([
      { startMin: 480, endMin: 600 },
      { startMin: 650, endMin: 1260 },
    ]);
  });

  it('a fully open day is one big slot', () => {
    const days = computeFreeSlots([mk('A', DAYS.MON, 600, 650)]);
    const tue = days.find((d) => d.label === 'Tue')!;
    expect(tue.slots).toEqual([{ startMin: 480, endMin: 1260 }]);
  });

  it('merges overlapping/adjacent classes into one busy block', () => {
    const days = computeFreeSlots([
      mk('A', DAYS.MON, 600, 700),
      mk('B', DAYS.MON, 700, 800),
    ]);
    const mon = days.find((d) => d.label === 'Mon')!;
    // free before 10:00 and after 13:20
    expect(mon.slots).toEqual([
      { startMin: 480, endMin: 600 },
      { startMin: 800, endMin: 1260 },
    ]);
  });

  it('shows weekend days only when there are weekend classes', () => {
    const noWeekend = computeFreeSlots([mk('A', DAYS.MON, 600, 650)]);
    expect(noWeekend.map((d) => d.label)).not.toContain('Sat');
    const weekend = computeFreeSlots([mk('A', DAYS.SAT, 600, 650)]);
    expect(weekend.map((d) => d.label)).toContain('Sat');
  });
});

describe('formatMinutes', () => {
  it('formats', () => {
    expect(formatMinutes(600)).toBe('10:00 AM');
    expect(formatMinutes(810)).toBe('1:30 PM');
    expect(formatMinutes(0)).toBe('12:00 AM');
    expect(formatMinutes(720)).toBe('12:00 PM');
  });
});
