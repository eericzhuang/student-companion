import { describe, expect, it } from 'vitest';
import { computeGpa, gradePoints, projectGpa } from '../src/planner/engine/gpa';
import type { HistoryCourse } from '../src/shared/types';

const course = (code: string, grade: string | null, credits: number | null): HistoryCourse => ({
  code,
  title: code,
  credits,
  grade,
  term: null,
  status: 'completed',
});

describe('gradePoints', () => {
  it('maps letters (case/space-insensitive) and rejects non-letter grades', () => {
    expect(gradePoints('A')).toBe(4.0);
    expect(gradePoints(' b+ ')).toBe(3.3);
    expect(gradePoints('CR')).toBeNull();
    expect(gradePoints('W')).toBeNull();
    expect(gradePoints(null)).toBeNull();
  });
});

describe('computeGpa', () => {
  it('computes a known GPA', () => {
    // A(4)×4 + B+(3.3)×3 + C(2)×3 = 16 + 9.9 + 6 = 31.9 over 10 credits
    const r = computeGpa([course('X', 'A', 4), course('Y', 'B+', 3), course('Z', 'C', 3)]);
    expect(r.gpa).toBeCloseTo(3.19, 5);
    expect(r.gpaCredits).toBe(10);
    expect(r.counted).toBe(3);
  });

  it('skips null-credit letter grades and reports them; ignores pass/fail', () => {
    const r = computeGpa([course('X', 'A', 4), course('Y', 'B', null), course('Z', 'CR', 3)]);
    expect(r.gpa).toBe(4.0);
    expect(r.missingCredits.map((c) => c.code)).toEqual(['Y']);
    expect(r.counted).toBe(1);
  });

  it('returns null GPA when nothing counts', () => {
    expect(computeGpa([course('X', 'CR', 3)]).gpa).toBeNull();
  });
});

describe('projectGpa', () => {
  it('projects cumulative and term GPA', () => {
    const history = [course('X', 'A', 4)]; // 16 QP / 4 cr
    const p = projectGpa(history, [{ code: 'N', credits: 4, grade: 'B' }]); // +12 QP / 4 cr
    expect(p.current.gpa).toBe(4.0);
    expect(p.termGpa).toBe(3.0);
    expect(p.projected).toBeCloseTo(28 / 8, 5);
  });

  it('ignores invalid hypotheticals', () => {
    const p = projectGpa([course('X', 'A', 4)], [{ code: 'N', credits: 0, grade: 'B' }]);
    expect(p.termGpa).toBeNull();
    expect(p.projected).toBe(4.0);
  });
});
