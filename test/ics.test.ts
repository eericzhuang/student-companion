import { describe, expect, it } from 'vitest';
import { buildIcs, defaultTermStart } from '../src/shared/ics';
import { DAYS, type Section } from '../src/shared/types';

const sec = (over: Partial<Section> = {}): Section => ({
  sectionId: 'CS 2110-001',
  courseCode: 'CS 2110',
  title: 'CS 2110 - Object-Oriented Programming',
  credits: 4,
  instructor: 'Bracy, Anne',
  meetings: [{ days: DAYS.MON | DAYS.WED | DAYS.FRI, startMin: 600, endMin: 650, location: 'Hollister Hall 110' }],
  ...over,
});

const NOW = new Date(2026, 6, 18); // Sat Jul 18 2026

describe('buildIcs', () => {
  it('maps day bitmask to BYDAY codes', () => {
    const ics = buildIcs([sec()], { termStart: '2026-08-24', termEnd: '2026-12-05', now: NOW });
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261205T235959');
  });

  it('starts on the first matching weekday on/after termStart', () => {
    // 2026-08-25 is a Tuesday; MWF class should first occur Wed 08-26
    const ics = buildIcs([sec()], { termStart: '2026-08-25', termEnd: '2026-12-05', now: NOW });
    expect(ics).toContain('DTSTART:20260826T100000');
    expect(ics).toContain('DTEND:20260826T105000');
  });

  it('cleans titles and escapes text; includes location and professor', () => {
    const s = sec({
      title: 'CS 2110 - Design, Implementation; Testing 4 Units Registered',
      instructor: 'InstructorBracy, Anne',
    });
    const ics = buildIcs([s], { termStart: '2026-08-24', now: NOW });
    expect(ics).toContain('SUMMARY:CS 2110 — Design\\, Implementation\\; Testing');
    expect(ics).toContain('LOCATION:Hollister Hall 110');
    expect(ics).toContain('DESCRIPTION:Professor: Anne Bracy');
  });

  it('uses CRLF endings and folds long lines at 75 chars', () => {
    const s = sec({ title: `CS 2110 - ${'Very Long Title '.repeat(10)}` });
    const ics = buildIcs([s], { termStart: '2026-08-24', now: NOW });
    expect(ics.includes('\r\n')).toBe(true);
    for (const line of ics.split('\r\n')) expect(line.length).toBeLessThanOrEqual(75);
  });

  it('defaults term start to next Monday and runs 16 weeks', () => {
    expect(defaultTermStart(NOW).getDay()).toBe(1);
    const ics = buildIcs([sec()], { now: NOW }); // start Mon 2026-07-20 → +112 days = 2026-11-09
    expect(ics).toContain('DTSTART:20260720T100000');
    expect(ics).toContain('UNTIL=20261109T235959');
  });

  it('skips meetings with no days and sections yield one VEVENT per meeting', () => {
    const s = sec({
      meetings: [
        { days: DAYS.TUE | DAYS.THU, startMin: 810, endMin: 885 },
        { days: 0, startMin: 0, endMin: 0 },
      ],
    });
    const ics = buildIcs([s], { termStart: '2026-08-24', now: NOW });
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(1);
    expect(ics).toContain('BYDAY=TU,TH');
  });
});
