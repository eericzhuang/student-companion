/**
 * Final-exam helpers: chronological ordering and clash detection between
 * date-specific sittings (unlike weekly meetings, finals compare by date).
 */
import type { FinalExam } from './types';

/** Sorted copy: by date, then start time. */
export function sortFinals(finals: FinalExam[]): FinalExam[] {
  return [...finals].sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
}

/** ids of finals that overlap another sitting on the same date. */
export function finalConflictIds(finals: FinalExam[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < finals.length; i++) {
    for (let j = i + 1; j < finals.length; j++) {
      const a = finals[i]!;
      const b = finals[j]!;
      if (a.date === b.date && a.startMin < b.endMin && b.startMin < a.endMin) {
        out.add(a.id);
        out.add(b.id);
      }
    }
  }
  return out;
}

/** "14:05" (time-input value) -> minutes from midnight, or null. */
export function timeInputToMinutes(value: string): number | null {
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return min >= 0 && min < 24 * 60 ? min : null;
}

/** "2026-12-14" -> "Mon, Dec 14" (local). Falls back to the raw string. */
export function formatFinalDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
