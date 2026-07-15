/**
 * DOM scraper for the "Find Course Sections" results list.
 * Returns parsed rows with live element references so the UI layer can inject
 * RMP badges and conflict indicators next to them. Runs incrementally on
 * MutationObserver ticks; Workday virtualizes/paginates, so never assume the
 * full list is present.
 */
import type { Meeting } from '../../shared/types';
import { parseMeetingPatterns } from '../../shared/time';
import { COURSE_CODE_RE, looksLikePersonName } from './workdayJson';
import { queryAll, textOf } from './selectors';

export interface ResultRow {
  element: Element;
  sectionId: string;
  courseCode: string | null;
  title: string;
  instructor: string | null;
  meetings: Meeting[];
}

const PROCESSED_ATTR = 'data-wdc-processed';

/** Heuristic: instructor names inside a row are capitalized word pairs without digits. */
function findInstructor(rowText: string, lines: string[]): string | null {
  for (const line of lines) {
    if (looksLikePersonName(line)) return line;
  }
  // "Last, First" form embedded in the row text
  const m = rowText.match(/([A-Z][a-zA-Z'-]+,\s[A-Z][a-zA-Z'.-]+(?:\s[A-Z][a-zA-Z'.-]+)?)/);
  return m ? m[1]! : null;
}

/**
 * Scan for result rows not yet processed. Marks rows so repeat scans are cheap.
 * `forceAll` rescans everything (used when the saved schedule changes).
 */
export function scrapeResultRows(root: ParentNode, forceAll = false): ResultRow[] {
  const rows: ResultRow[] = [];
  for (const el of queryAll(root, 'courseSectionRow')) {
    if (!forceAll && el.hasAttribute(PROCESSED_ATTR)) continue;

    const text = textOf(el);
    const codeMatch = text.match(COURSE_CODE_RE);
    if (!codeMatch) continue;

    const meetings = parseMeetingPatterns(
      // Prefer per-line parsing: innerText-ish reconstruction from child nodes
      [...el.querySelectorAll('*')]
        .filter((child) => child.children.length === 0)
        .map((child) => child.textContent?.trim() ?? '')
        .filter(Boolean)
        .join('\n') || text,
    );

    const lines = [...el.querySelectorAll('*')]
      .filter((child) => child.children.length === 0)
      .map((child) => child.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .filter(Boolean);

    const courseCode = `${codeMatch[1]} ${codeMatch[2]}`;
    const sectionSuffix = text.match(/\b\d{3,5}[A-Z]?-([A-Z0-9]{1,4})\b/);

    el.setAttribute(PROCESSED_ATTR, '1');
    rows.push({
      element: el,
      sectionId: sectionSuffix ? `${courseCode}-${sectionSuffix[1]}` : courseCode,
      courseCode,
      title: text.slice(0, 120),
      instructor: findInstructor(text, lines),
      meetings,
    });
  }
  return rows;
}

export function clearProcessedMarks(root: ParentNode): void {
  for (const el of root.querySelectorAll(`[${PROCESSED_ATTR}]`)) {
    el.removeAttribute(PROCESSED_ATTR);
  }
}

/** Count candidate result rows without side effects (for diagnostics). */
export function countCandidateRows(root: ParentNode): number {
  return queryAll(root, 'courseSectionRow').filter((el) => COURSE_CODE_RE.test(textOf(el))).length;
}
