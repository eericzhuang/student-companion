/**
 * Suggest a term-by-term layout for remaining courses:
 *  - topological order on stated prerequisites
 *  - fill each configured term up to its credit cap
 *  - courses satisfying multiple degrees are scheduled first
 */
import type { RequirementCourse, TermConfig } from '../../shared/types';
import { normalizeCode } from './requirements';

export interface SuggestedTerm {
  term: TermConfig;
  courses: RequirementCourse[];
  credits: number;
}

export interface Suggestion {
  terms: SuggestedTerm[];
  /** courses that didn't fit in the configured terms */
  unplaced: RequirementCourse[];
  /** codes involved in a prerequisite cycle (scheduled ignoring prereqs) */
  cyclic: string[];
}

const DEFAULT_CREDITS = 3;

export function suggestSchedule(
  remaining: RequirementCourse[],
  completedCodes: Set<string>,
  terms: TermConfig[],
  overlapCount: (code: string) => number,
): Suggestion {
  // Dedupe by normalized code, keep richest info
  const byCode = new Map<string, RequirementCourse>();
  for (const c of remaining) {
    const code = normalizeCode(c.code);
    const existing = byCode.get(code);
    if (!existing || (existing.credits === null && c.credits !== null)) {
      byCode.set(code, { ...c, code });
    }
  }

  const pending = new Map(byCode);
  const placedOrDone = new Set(completedCodes);
  const cyclic: string[] = [];

  const prereqsMet = (c: RequirementCourse) =>
    c.prereqCodes.every((p) => {
      const norm = normalizeCode(p);
      // prereqs outside every requirement list can't be tracked — don't block on them
      return placedOrDone.has(norm) || (!byCode.has(norm) && !pending.has(norm));
    });

  const out: SuggestedTerm[] = terms.map((term) => ({ term, courses: [], credits: 0 }));

  for (const slot of out) {
    const placedThisTerm: string[] = [];
    let progressed = true;
    while (progressed) {
      progressed = false;
      const eligible = [...pending.values()]
        .filter((c) => prereqsMet(c))
        .sort(
          (a, b) =>
            overlapCount(b.code) - overlapCount(a.code) || a.code.localeCompare(b.code),
        );
      for (const course of eligible) {
        const credits = course.credits ?? DEFAULT_CREDITS;
        if (slot.credits + credits > slot.term.creditCap) continue;
        slot.courses.push(course);
        slot.credits += credits;
        pending.delete(course.code);
        placedThisTerm.push(course.code);
        progressed = true;
        break; // re-sort eligibility after each placement
      }
    }
    // courses placed this term become available as prereqs only for later terms
    for (const code of placedThisTerm) placedOrDone.add(code);
  }

  // Courses still blocked by other *pending* courses are part of a prereq
  // chain that never became placeable — either a data cycle or too few terms.
  for (const c of pending.values()) {
    if (!prereqsMet(c) && c.prereqCodes.some((p) => pending.has(normalizeCode(p)))) {
      cyclic.push(c.code);
    }
  }

  return { terms: out, unplaced: [...pending.values()], cyclic };
}
