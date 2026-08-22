/**
 * DOM scraper for academic history / transcript grids.
 *
 * Workday grids carry column headers, so read by column when they're there:
 * picking "the first cell that looks like a grade" mistakes a Grading Basis of
 * "S" for a grade, and "the first small number" grabs a section number or a
 * Grade Points value instead of credits.
 */
import type { AcademicHistory, HistoryCourse } from '../../shared/types';
import {
  AMBIGUOUS_GRADES,
  GRADE_TOKEN_RE,
  isCreditsHeader,
  isGradeHeader,
  plausibleCredits,
  statusForGrade,
} from '../../shared/grades';
import { cleanSectionTitle } from '../../shared/schedule';
import { COURSE_CODE_RE } from './workdayJson';
import { queryAll, textOf } from './selectors';

const TERM_RE = /\b(fall|spring|summer|winter)\b.*\d{4}|\d{4}.*\b(fall|spring|summer|winter)\b/i;
const CREDITS_VALUE_RE = /^(\d{1,2}(?:\.\d{1,2})?)$/;

interface ColumnMap {
  grade: number | null;
  credits: number | null;
  term: number | null;
  course: number | null;
  title: number | null;
}

/** Map column indexes from the grid's header row, when it has one. */
function readHeaders(table: Element): ColumnMap {
  const cells = [...table.querySelectorAll('thead th, [role="columnheader"]')].map((c) =>
    textOf(c).toLowerCase(),
  );
  const map: ColumnMap = { grade: null, credits: null, term: null, course: null, title: null };
  cells.forEach((h, i) => {
    if (!h) return;
    if (map.grade === null && isGradeHeader(h)) map.grade = i;
    if (map.credits === null && isCreditsHeader(h)) map.credits = i;
    if (map.term === null && /\b(term|academic period|period|session|semester)\b/.test(h)) map.term = i;
    if (map.course === null && /\b(course|class|catalog|subject|listing)\b/.test(h)) map.course = i;
    if (map.title === null && /\b(title|description|name)\b/.test(h)) map.title = i;
  });
  return map;
}

const at = (cells: string[], index: number | null): string | null =>
  index !== null && index < cells.length ? (cells[index] || null) : null;

/** Last grade-looking cell, ignoring words that only look like grades. */
function fallbackGrade(cells: string[]): string | null {
  for (let i = cells.length - 1; i >= 0; i--) {
    const c = cells[i]!.trim();
    if (!GRADE_TOKEN_RE.test(c)) continue;
    // A bare "S"/"I" in a middle column is far more likely a grading basis or a
    // Roman numeral than a grade; only trust it near the end of the row.
    if (AMBIGUOUS_GRADES.has(c.toUpperCase()) && i < cells.length - 2) continue;
    return c;
  }
  return null;
}

function fallbackCredits(cells: string[]): number | null {
  const values = cells
    .map((c) => c.match(CREDITS_VALUE_RE))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => parseFloat(m[1]!))
    .filter(plausibleCredits);
  // Several numeric columns (units attempted/earned/points) — the smallest
  // plausible one is the course's credit value; points are larger.
  return values.length ? Math.min(...values) : null;
}

export function scrapeAcademicHistory(root: ParentNode): AcademicHistory | null {
  const courses: HistoryCourse[] = [];
  const seen = new Set<string>();

  for (const table of queryAll(root, 'academicHistoryTable')) {
    const cols = readHeaders(table);

    for (const row of table.querySelectorAll('tbody tr, [role="row"]')) {
      // Skip the header row itself when the grid uses ARIA roles.
      if (row.querySelector('[role="columnheader"]')) continue;

      const cellTexts = [...row.querySelectorAll('td, th, [role="cell"], [role="gridcell"]')].map((c) =>
        textOf(c),
      );
      if (cellTexts.filter(Boolean).length < 2) continue;

      const joined = cellTexts.join(' | ');
      const codeMatch = joined.match(COURSE_CODE_RE);
      if (!codeMatch) continue;
      const code = `${codeMatch[1]} ${codeMatch[2]}`;

      const headerGrade = at(cellTexts, cols.grade);
      const grade =
        headerGrade && GRADE_TOKEN_RE.test(headerGrade.trim())
          ? headerGrade.trim()
          : fallbackGrade(cellTexts);

      const term = at(cellTexts, cols.term) ?? cellTexts.find((c) => TERM_RE.test(c)) ?? null;
      if (!grade && !term) continue;

      const headerCredits = at(cellTexts, cols.credits)?.match(CREDITS_VALUE_RE);
      const credits =
        headerCredits && plausibleCredits(parseFloat(headerCredits[1]!))
          ? parseFloat(headerCredits[1]!)
          : fallbackCredits(cellTexts);

      // Title: its own column when the grid has one, else the course cell with
      // the code stripped off. Cleaned either way — Workday glues "Actions" and
      // repeated section ids onto these cells.
      const rawTitle =
        at(cellTexts, cols.title) ??
        at(cellTexts, cols.course) ??
        cellTexts.find((c) => {
          const m = c.match(COURSE_CODE_RE);
          return m && c.length > m[0].length + 3;
        }) ??
        null;
      const title = rawTitle ? cleanSectionTitle(code, rawTitle) : code;

      const key = `${code}|${term ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);

      courses.push({
        code,
        title: title || code,
        credits,
        grade,
        term,
        status: statusForGrade(grade),
      });
    }
  }

  if (courses.length === 0) return null;
  return { courses, capturedAt: Date.now(), source: 'dom' };
}
