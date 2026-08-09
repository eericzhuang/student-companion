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
  s = s.split(/\s*\d*\s*(?:Quality|Graded(?:\s+Credit)?|Units?|Credits?|Registered|Waitlisted|Enrolled|Unregistered|Actions?)\b/i)[0]!;
  // meeting times / pattern separators concatenated after the title
  s = s.split(/\s*\|\s*/)[0]!;
  s = s.split(/\s*\d{1,2}:\d{2}\s*(?:AM|PM)?/i)[0]!;
  const esc = courseCode.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  s = s.replace(new RegExp(`^${esc}\\s*[-–·:]*\\s*`, 'i'), '');
  // rows often repeat the code as a section id ("CODE-01 - Title…Lec") — cut there
  const again = s.search(new RegExp(`${esc}(?:-\\w+)?\\s*[-–·:]`, 'i'));
  if (again > 0) s = s.slice(0, again);
  // day abbreviations glued after the title once the time was cut ("…ProgrammingMWF")
  s = s.replace(/(?<=[a-z])(?:[MTWF]|Th|Tu|Sa|Su)+$/, '');
  // credit counts glued straight onto the last word ("…for DS II3")
  s = s.replace(/(?<=[A-Za-z])\d+(?:\.\d+)?$/, '');
  s = s.trim().replace(/[-–·:,\s]+$/, '');
  return s || title.trim();
}

/**
 * The full course name to show next to a code, or '' when none is known
 * (missing title, the title is just the code again, or cleaning still left
 * something too long to be a real course name).
 */
export function courseTitle(code: string, title?: string | null): string {
  if (!title) return '';
  const t = cleanSectionTitle(code, title);
  if (t.toLowerCase() === code.trim().toLowerCase()) return '';
  return t.length > 80 ? '' : t;
}

/** "CSE 4107 · Introduction to Machine Learning", or just the code when no title is known. */
export function courseLabel(code: string, title?: string | null): string {
  const t = courseTitle(code, title);
  return t ? `${code} · ${t}` : code;
}
