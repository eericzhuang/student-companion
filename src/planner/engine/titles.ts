/**
 * Course-code → full-title lookup assembled from every source that knows a
 * name: degree catalogs, the captured academic history, and the captured
 * schedule. Used to show "CSE 4107 · Introduction to Machine Learning"
 * instead of a bare code in planner views that only carry codes.
 */
import type { HistoryCourse, Section, StoredDegree } from '../../shared/types';
import { courseTitle } from '../../shared/schedule';
import { normalizeCode } from './requirements';

export function buildCourseTitleMap(
  degrees: StoredDegree[],
  history: HistoryCourse[] = [],
  sections: Section[] = [],
): Map<string, string> {
  const map = new Map<string, string>();
  const add = (code: string, title?: string | null) => {
    const key = normalizeCode(code);
    if (map.has(key)) return;
    const t = courseTitle(code, title);
    if (t) map.set(key, t);
  };
  for (const d of degrees) for (const g of d.groups) for (const c of g.courses) add(c.code, c.title);
  for (const c of history) add(c.code, c.title);
  for (const s of sections) add(s.courseCode, s.title);
  return map;
}

/** Full title for a code, or '' when unknown. */
export function titleFor(titles: Map<string, string>, code: string): string {
  return titles.get(normalizeCode(code)) ?? '';
}
