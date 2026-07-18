import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, generateSchedules, scoreParts, scoreSchedule } from '../src/shared/builder';
import { DAYS, type Section } from '../src/shared/types';

const sec = (id: string, code: string, days: number, startMin: number, endMin: number, over: Partial<Section> = {}): Section => ({
  sectionId: id,
  courseCode: code,
  title: code,
  credits: 3,
  instructor: null,
  meetings: [{ days, startMin, endMin }],
  ...over,
});

const CTX = { ratings: new Map<string, number | null>(), buildings: {}, walkSpeedKmh: 4.8 };

describe('generateSchedules', () => {
  it('picks one section per course and excludes conflicting combos', () => {
    const locked = [sec('L1', 'CS 2110', DAYS.MON | DAYS.WED, 600, 650)];
    const candidates = [
      sec('A1', 'MATH 2940', DAYS.MON, 600, 675), // clashes with locked
      sec('A2', 'MATH 2940', DAYS.TUE, 600, 675),
      sec('B1', 'ENGL 2010', DAYS.TUE, 600, 675), // clashes with A2
      sec('B2', 'ENGL 2010', DAYS.WED, 720, 795),
    ];
    const r = generateSchedules(locked, candidates, DEFAULT_PREFS, CTX);
    expect(r.courses).toBe(2);
    // only A2+B2 is conflict-free
    expect(r.combosFound).toBe(1);
    expect(r.results[0]!.chosen.map((s) => s.sectionId).sort()).toEqual(['A2', 'B2']);
    expect(r.results[0]!.sections).toHaveLength(3);
  });

  it('skips candidate courses already on the schedule', () => {
    const locked = [sec('L1', 'CS 2110', DAYS.MON, 600, 650)];
    const candidates = [sec('C1', 'CS 2110', DAYS.TUE, 600, 650)];
    const r = generateSchedules(locked, candidates, DEFAULT_PREFS, CTX);
    expect(r.skippedLocked).toEqual(['CS 2110']);
    expect(r.courses).toBe(0);
    expect(r.combosFound).toBe(0);
  });

  it('respects the exploration cap', () => {
    const candidates: Section[] = [];
    for (let c = 0; c < 6; c++)
      for (let i = 0; i < 6; i++)
        candidates.push(sec(`c${c}s${i}`, `CRS ${c}`, DAYS.MON << 0, 480 + c * 120, 530 + c * 120));
    const r = generateSchedules([], candidates, DEFAULT_PREFS, CTX, { maxExplored: 100 });
    expect(r.truncated).toBe(true);
  });

  it('ranks better-rated professors higher when ratings weight > 0', () => {
    const ratings = new Map<string, number | null>([
      ['Good Prof', 4.8],
      ['Bad Prof', 1.5],
    ]);
    const candidates = [
      sec('G', 'CRS 1', DAYS.MON, 600, 650, { instructor: 'Good Prof' }),
      sec('B', 'CRS 1', DAYS.TUE, 600, 650, { instructor: 'Bad Prof' }),
    ];
    const r = generateSchedules([], candidates, DEFAULT_PREFS, { ...CTX, ratings });
    expect(r.results[0]!.chosen[0]!.sectionId).toBe('G');
    expect(r.results[1]!.chosen[0]!.sectionId).toBe('B');
  });

  it('penalizes early mornings', () => {
    const early = scoreParts([sec('E', 'X', DAYS.MON | DAYS.WED | DAYS.FRI, 480, 530)], CTX, 540);
    const late = scoreParts([sec('L', 'X', DAYS.MON | DAYS.WED | DAYS.FRI, 600, 650)], CTX, 540);
    expect(early.earlyMin).toBe(180); // 60 min early × 3 days
    expect(late.earlyMin).toBe(0);
    expect(scoreSchedule(late, DEFAULT_PREFS)).toBeGreaterThan(scoreSchedule(early, DEFAULT_PREFS));
  });
});
