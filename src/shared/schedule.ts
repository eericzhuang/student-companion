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

/**
 * Workday cells often concatenate a course title with credit/enrollment junk
 * ("SDS 4030 - Statistics for DS II3Quality Graded CreditSDS 4030-01 - …Lec").
 * Cut at the junk and drop a leading duplicated course code.
 */
export function cleanSectionTitle(courseCode: string, title: string): string {
  let s = title.trim();
  s = s.split(/\s*\d*\s*(?:Quality|Graded(?:\s+Credit)?|Units?|Credits?|Registered|Waitlisted|Enrolled|Unregistered)\b/i)[0]!;
  const esc = courseCode.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  s = s.replace(new RegExp(`^${esc}\\s*[-–·:]*\\s*`, 'i'), '');
  s = s.trim().replace(/[-–·:,\s]+$/, '');
  return s || title.trim();
}
