/**
 * Cross-degree overlap analysis: which courses appear in the requirements of
 * two or more selected degrees (prime double-count candidates).
 */
import type { StoredDegree } from '../../shared/types';
import { normalizeCode } from './requirements';

export interface OverlapEntry {
  code: string;
  title: string | null;
  credits: number | null;
  /** degree id -> group titles the course appears in */
  appearsIn: Map<string, string[]>;
}

export function findOverlaps(degrees: StoredDegree[]): OverlapEntry[] {
  const byCode = new Map<string, OverlapEntry>();
  for (const degree of degrees) {
    for (const group of degree.groups) {
      for (const course of group.courses) {
        const code = normalizeCode(course.code);
        let entry = byCode.get(code);
        if (!entry) {
          entry = { code, title: course.title, credits: course.credits, appearsIn: new Map() };
          byCode.set(code, entry);
        }
        entry.title ??= course.title;
        entry.credits ??= course.credits;
        const groups = entry.appearsIn.get(degree.id) ?? [];
        if (!groups.includes(group.title)) groups.push(group.title);
        entry.appearsIn.set(degree.id, groups);
      }
    }
  }
  return [...byCode.values()]
    .filter((e) => e.appearsIn.size >= 2)
    .sort((a, b) => b.appearsIn.size - a.appearsIn.size || a.code.localeCompare(b.code));
}

export interface OverlapCombo {
  /** the exact set of degree ids (sorted) sharing this combo's courses */
  degreeIds: string[];
  entries: OverlapEntry[];
}

/**
 * Group overlap entries by the EXACT set of degrees each course appears in,
 * largest combination first. With 3+ selected degrees this answers both
 * "which courses count toward ALL of them?" and "which count toward this
 * particular pair?" without listing any course twice.
 */
export function groupOverlapsByCombo(overlaps: OverlapEntry[]): OverlapCombo[] {
  const combos = new Map<string, OverlapCombo>();
  for (const o of overlaps) {
    const degreeIds = [...o.appearsIn.keys()].sort();
    const key = degreeIds.join('|');
    let combo = combos.get(key);
    if (!combo) {
      combo = { degreeIds, entries: [] };
      combos.set(key, combo);
    }
    combo.entries.push(o);
  }
  return [...combos.values()].sort(
    (a, b) =>
      b.degreeIds.length - a.degreeIds.length ||
      a.degreeIds.join('|').localeCompare(b.degreeIds.join('|')),
  );
}

/**
 * How many distinct requirement groups (across all given degrees) each course
 * can satisfy. A course counting toward several requirements should be taken
 * first — used to rank/recommend courses in the board and overlap view.
 */
export function requirementAppearances(degrees: StoredDegree[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const degree of degrees) {
    for (const group of degree.groups) {
      const seenInGroup = new Set<string>();
      for (const course of group.courses) {
        const code = normalizeCode(course.code);
        if (seenInGroup.has(code)) continue;
        seenInGroup.add(code);
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
    }
  }
  return counts;
}
