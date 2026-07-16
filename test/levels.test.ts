import { describe, expect, it } from 'vitest';
import { buildCourseStates, evaluateDegree } from '../src/planner/engine/requirements';
import {
  computeLevel,
  RANKS,
  XP_PER_COURSE,
  XP_PER_DEGREE,
  XP_PER_GROUP,
} from '../src/planner/engine/levels';
import type { DegreeProgram, HistoryCourse } from '../src/shared/types';

const hist = (code: string): HistoryCourse => ({
  code,
  title: code,
  credits: 3,
  grade: 'A',
  term: 'Fall 2025',
  status: 'completed',
});

const course = (code: string) => ({ code, title: code, credits: 3, prereqCodes: [] });

const degree = (name: string, groups: Array<{ title: string; codes: string[] }>): DegreeProgram => ({
  name,
  type: 'major',
  totalCredits: null,
  groups: groups.map((g) => ({
    title: g.title,
    rule: { kind: 'all' as const },
    courses: g.codes.map(course),
    notes: null,
  })),
});

describe('level-up game (computeLevel)', () => {
  it('scores courses, satisfied groups, and finished degrees', () => {
    const d = degree('CS', [
      { title: 'Intro', codes: ['CS 1110', 'CS 2110'] },
      { title: 'Systems', codes: ['CS 3410'] },
    ]);
    const states = buildCourseStates([hist('CS 1110'), hist('CS 2110'), hist('CS 3410')], [], []);
    const info = computeLevel([evaluateDegree(d, states)], states);
    // 3 courses + 2 groups + whole degree done
    expect(info.breakdown).toMatchObject({ courses: 3, groups: 2, degrees: 1 });
    expect(info.xp).toBe(3 * XP_PER_COURSE + 2 * XP_PER_GROUP + XP_PER_DEGREE);
  });

  it('planned courses move nothing — only completed work earns XP', () => {
    const d = degree('CS', [{ title: 'Intro', codes: ['CS 1110'] }]);
    const states = buildCourseStates([], [], ['CS 1110']); // planned only
    const ev = evaluateDegree(d, states);
    expect(ev.groups[0]!.satisfied).toBe(true); // the bar moves…
    const info = computeLevel([ev], states);
    expect(info.xp).toBe(0); // …but the game doesn't
    expect(info.level).toBe(1);
  });

  it('overlap pays per degree: one course satisfying groups in two degrees earns both', () => {
    const cs = degree('CS', [{ title: 'Math req', codes: ['MATH 2940'] }]);
    const math = degree('Math minor', [{ title: 'Linear algebra', codes: ['MATH 2940'] }]);
    const states = buildCourseStates([hist('MATH 2940')], [], []);
    const info = computeLevel([evaluateDegree(cs, states), evaluateDegree(math, states)], states);
    // 1 unique course, but 2 groups and 2 finished degrees
    expect(info.breakdown).toMatchObject({ courses: 1, groups: 2, degrees: 2 });
    expect(info.xp).toBe(XP_PER_COURSE + 2 * XP_PER_GROUP + 2 * XP_PER_DEGREE);
  });

  it('maps XP to ranks with sane progress math', () => {
    const states = buildCourseStates([], [], []);
    const at = (xp: number) => {
      // fabricate xp via completed courses only (10 XP each)
      const s = buildCourseStates(
        Array.from({ length: xp / XP_PER_COURSE }, (_, i) => hist(`FAKE ${1000 + i}`)),
        [],
        [],
      );
      return computeLevel([], s);
    };
    expect(computeLevel([], states).level).toBe(1);
    expect(at(40).level).toBe(2); // exactly at the threshold
    expect(at(90).level).toBe(2); // just under level 3 (100)
    expect(at(100).level).toBe(3);
    const l2 = at(70); // halfway from 40 to 100
    expect(l2.pct).toBe(50);
    expect(l2.next?.title).toBe('Junior Scholar');
    const max = at(2000);
    expect(max.level).toBe(10);
    expect(max.next).toBeNull();
    expect(max.pct).toBe(100);
  });

  it('rank thresholds are strictly increasing and start at 0', () => {
    expect(RANKS[0]!.at).toBe(0);
    for (let i = 1; i < RANKS.length; i++) expect(RANKS[i]!.at).toBeGreaterThan(RANKS[i - 1]!.at);
  });
});
