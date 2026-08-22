/**
 * Grade vocabulary shared by every history source (Workday JSON, the DOM
 * grid scraper, and pasted transcript text) so a "W" means the same thing
 * wherever it was read from.
 */
import type { HistoryCourse } from './types';

/** A cell/token that is exactly a grade. */
export const GRADE_TOKEN_RE =
  /^(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D-|D|F|P|NP|CR|NC|S|U|W|I|IP|AU|TR)$/;

/**
 * Grades that are also ordinary words or Roman numerals in course titles
 * ("Physics I", "Statistics U"). Only trust these when nothing follows them.
 */
export const AMBIGUOUS_GRADES = new Set(['I', 'S', 'U', 'P']);

/** Grades that mean the course is not finished / carries no earned credit. */
const NOT_COMPLETED = new Set(['NP', 'NC', 'U', 'I', 'IP', 'AU']);

/**
 * F is "completed but failed" — it belongs in history (and in GPA) while the
 * requirements engine excludes it from earned credit. W is its own state so a
 * dropped course never counts as done.
 */
export function statusForGrade(grade: string | null | undefined): HistoryCourse['status'] {
  if (!grade) return 'in-progress';
  const g = grade.trim().toUpperCase();
  if (g === 'W') return 'withdrawn';
  if (NOT_COMPLETED.has(g)) return 'in-progress';
  return 'completed';
}

/** Column-header text that identifies a credits/units column (not a points column). */
export function isCreditsHeader(header: string): boolean {
  const h = header.toLowerCase();
  if (/point/.test(h)) return false; // "Grade Points" / "Quality Points" are not credits
  return /\b(units?|credits?|hours?|cred)\b/.test(h);
}

/** Column-header text that identifies the letter-grade column. */
export function isGradeHeader(header: string): boolean {
  const h = header.toLowerCase();
  if (/point|basis|type|scale/.test(h)) return false; // "Grading Basis", "Grade Points"
  return /\bgrade\b|\bmark\b/.test(h);
}

/** Plausible credit value for one course — rules out quality points and years. */
export function plausibleCredits(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 12;
}
