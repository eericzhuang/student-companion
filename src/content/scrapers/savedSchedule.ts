/**
 * DOM fallback scraper for the saved-schedule page (primary source is the
 * network interceptor; this covers tenants where interception misses).
 */
import type { ScheduleSnapshot, Section } from '../../shared/types';
import { parseMeetingPatterns } from '../../shared/time';
import { COURSE_CODE_RE, looksLikePersonName } from './workdayJson';
import { cleanInstructorName } from '../../shared/fuzzy';
import { queryFirst, textOf } from './selectors';

export function scrapeSavedSchedule(root: ParentNode): ScheduleSnapshot | null {
  const table = queryFirst(root, 'savedScheduleTable');
  if (!table) return null;

  const sections: Section[] = [];
  for (const row of table.querySelectorAll('tbody tr, [role="row"]')) {
    const text = textOf(row);
    const codeMatch = text.match(COURSE_CODE_RE);
    if (!codeMatch) continue;

    const cellTexts = [...row.querySelectorAll('td, [role="cell"], [role="gridcell"]')].map(
      (c) => textOf(c),
    );
    const meetings = parseMeetingPatterns(cellTexts.join('\n') || text);
    if (meetings.length === 0) continue;

    const courseCode = `${codeMatch[1]} ${codeMatch[2]}`;
    const sectionSuffix = text.match(/\b\d{3,5}[A-Z]?-([A-Z0-9]{1,4})\b/);
    // Workday often labels the cell ("Instructor: Grace Chen", "InstructorChen,
    // Grace") — strip the label before deciding whether it's a person.
    const instructor =
      cellTexts.map((c) => cleanInstructorName(c)).find((c) => looksLikePersonName(c)) ?? null;
    const creditsCell = cellTexts.find((c) => /^\d{1,2}(\.\d{1,2})?$/.test(c));
    // The course cell, not the whole row: joining every cell used to make the
    // title "CSE 1302-01 - Intro … MWF | 10:00 AM … InstructorKatsianos, Bill".
    const courseCell =
      cellTexts.find((c) => {
        const m = c.match(COURSE_CODE_RE);
        return m && c.length > m[0].length + 3 && !/\d{1,2}:\d{2}/.test(c);
      }) ?? text.slice(0, 120);

    sections.push({
      sectionId: sectionSuffix ? `${courseCode}-${sectionSuffix[1]}` : courseCode,
      courseCode,
      title: courseCell,
      credits: creditsCell ? parseFloat(creditsCell) : null,
      instructor,
      meetings,
    });
  }

  if (sections.length === 0) return null;
  const titleEl = queryFirst(root, 'pageTitle');
  return {
    termLabel: textOf(titleEl) || null,
    sections,
    capturedAt: Date.now(),
    source: 'dom',
  };
}
