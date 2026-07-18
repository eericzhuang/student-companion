import { describe, expect, it } from 'vitest';
import { buildShareFile, parseShareFile, sharedCourses } from '../src/shared/friendShare';
import { DAYS, type ScheduleSnapshot, type Section } from '../src/shared/types';

const sec = (code: string): Section => ({
  sectionId: `${code}-001`,
  courseCode: code,
  title: `${code} Title`,
  credits: 4,
  instructor: 'Someone Private',
  meetings: [{ days: DAYS.MON, startMin: 600, endMin: 650, location: 'Secret Hall 1' }],
});

const snapshot: ScheduleSnapshot = {
  termLabel: 'Spring 2026',
  sections: [sec('CS 2110'), sec('MATH 1920')],
  capturedAt: 1,
  source: 'dom',
};

describe('friend share', () => {
  it('round-trips through build + parse, stripping private fields', () => {
    const text = JSON.stringify(buildShareFile(snapshot, 'Eric'));
    expect(text).not.toContain('Someone Private');
    expect(text).not.toContain('Secret Hall');
    const parsed = parseShareFile(text)!;
    expect(parsed.name).toBe('Eric');
    expect(parsed.sections.map((s) => s.courseCode)).toEqual(['CS 2110', 'MATH 1920']);
    expect(parsed.sections[0]!.meetings[0]).toEqual({ days: DAYS.MON, startMin: 600, endMin: 650 });
  });

  it('rejects junk and invalid meetings', () => {
    expect(parseShareFile('not json')).toBeNull();
    expect(parseShareFile('{"kind":"other"}')).toBeNull();
    const bad = JSON.stringify({
      kind: 'wdc-share',
      version: 1,
      name: 'X',
      termLabel: null,
      sections: [{ courseCode: 'A', title: 'A', meetings: [{ days: 999999, startMin: -5, endMin: 2000 }] }],
    });
    const parsed = parseShareFile(bad)!;
    expect(parsed.sections[0]!.meetings).toHaveLength(0);
  });

  it('finds shared course codes', () => {
    expect(sharedCourses([sec('CS 2110'), sec('PHYS 1112')], [sec('CS 2110')])).toEqual(['CS 2110']);
  });
});
