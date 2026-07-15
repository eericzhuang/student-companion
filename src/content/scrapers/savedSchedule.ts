/**
 * DOM fallback scraper for the saved-schedule page (primary source is the
 * network interceptor; this covers tenants where interception misses).
 */
import type { ScheduleSnapshot, Section } from '../../shared/types';
import { parseMeetingPatterns } from '../../shared/time';
import { COURSE_CODE_RE, looksLikePersonName } from './workdayJson';
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
    const instructor = cellTexts.find((c) => looksLikePersonName(c)) ?? null;
    const creditsCell = cellTexts.find((c) => /^\d{1,2}(\.\d{1,2})?$/.test(c));

    sections.push({
      sectionId: sectionSuffix ? `${courseCode}-${sectionSuffix[1]}` : courseCode,
      courseCode,
      title: text.slice(0, 120),
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
