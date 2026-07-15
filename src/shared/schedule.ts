/** Schedule helpers shared by the capture widget and auto-capture. */
import type { Section } from './types';

/** Union two schedules by sectionId, preferring the richer (more meetings) entry. */
export function mergeSections(existing: Section[], incoming: Section[]): Section[] {
  const map = new Map<string, Section>();
  for (const s of existing) map.set(s.sectionId, s);
  for (const s of incoming) {
    const prev = map.get(s.sectionId);
    if (!prev || s.meetings.length > prev.meetings.length) map.set(s.sectionId, s);
  }
  return [...map.values()];
}
