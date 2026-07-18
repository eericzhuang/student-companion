/**
 * GPA math over the captured academic history, plus "what-if grades"
 * projection. Standard 4.0 scale; non-letter grades (CR/P/S/W/TR/IP …) and
 * courses with unknown credits are excluded from the GPA and reported so the
 * user can fill them in.
 */
import type { HistoryCourse } from '../../shared/types';

export const GRADE_POINTS: Record<string, number> = {
  'A+': 4.0,
  A: 4.0,
  'A-': 3.7,
  'B+': 3.3,
  B: 3.0,
  'B-': 2.7,
  'C+': 2.3,
  C: 2.0,
  'C-': 1.7,
  'D+': 1.3,
  D: 1.0,
  'D-': 0.7,
  F: 0.0,
};

/** Letter grades a what-if dropdown should offer, best first. */
export const GRADE_CHOICES = Object.keys(GRADE_POINTS);

export function gradePoints(grade: string | null): number | null {
  if (!grade) return null;
  const g = grade.trim().toUpperCase();
  return GRADE_POINTS[g] ?? null;
}

export interface GpaResult {
  /** null when nothing counts (no letter-graded courses with credits) */
  gpa: number | null;
  qualityPoints: number;
  gpaCredits: number;
  /** courses that count toward the GPA */
  counted: number;
  /** letter-graded courses skipped because credits are unknown */
  missingCredits: HistoryCourse[];
}

export function computeGpa(courses: HistoryCourse[]): GpaResult {
  let qualityPoints = 0;
  let gpaCredits = 0;
  let counted = 0;
  const missingCredits: HistoryCourse[] = [];
  for (const c of courses) {
    const pts = gradePoints(c.grade);
    if (pts === null) continue; // CR/P/W/transfer/in-progress etc.
    if (c.credits === null || c.credits <= 0) {
      missingCredits.push(c);
      continue;
    }
    qualityPoints += pts * c.credits;
    gpaCredits += c.credits;
    counted++;
  }
  return {
    gpa: gpaCredits > 0 ? qualityPoints / gpaCredits : null,
    qualityPoints,
    gpaCredits,
    counted,
    missingCredits,
  };
}

export interface Hypothetical {
  code: string;
  credits: number;
  grade: string;
}

export interface GpaProjection {
  current: GpaResult;
  /** GPA of just the hypothetical set */
  termGpa: number | null;
  /** cumulative GPA if the hypotheticals land as chosen */
  projected: number | null;
}

export function projectGpa(courses: HistoryCourse[], hypotheticals: Hypothetical[]): GpaProjection {
  const current = computeGpa(courses);
  let hq = 0;
  let hc = 0;
  for (const h of hypotheticals) {
    const pts = gradePoints(h.grade);
    if (pts === null || h.credits <= 0) continue;
    hq += pts * h.credits;
    hc += h.credits;
  }
  const totalCredits = current.gpaCredits + hc;
  return {
    current,
    termGpa: hc > 0 ? hq / hc : null,
    projected: totalCredits > 0 ? (current.qualityPoints + hq) / totalCredits : null,
  };
}
