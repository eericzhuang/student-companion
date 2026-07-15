/**
 * DOM fallback scraper for academic history / transcript grids.
 */
import type { AcademicHistory, HistoryCourse } from '../../shared/types';
import { COURSE_CODE_RE } from './workdayJson';
import { queryAll, textOf } from './selectors';

const GRADE_RE = /^(A|A-|A\+|B\+|B|B-|C\+|C|C-|D\+|D|D-|F|P|NP|CR|NC|W|I|S|U|IP)$/;
const TERM_RE = /\b(fall|spring|summer|winter)\b.*\d{4}|\d{4}.*\b(fall|spring|summer|winter)\b/i;

export function scrapeAcademicHistory(root: ParentNode): AcademicHistory | null {
  const courses: HistoryCourse[] = [];
  const seen = new Set<string>();

  for (const table of queryAll(root, 'academicHistoryTable')) {
    for (const row of table.querySelectorAll('tbody tr, [role="row"]')) {
      const cellTexts = [...row.querySelectorAll('td, th, [role="cell"], [role="gridcell"]')]
        .map((c) => textOf(c))
        .filter(Boolean);
      if (cellTexts.length < 2) continue;

      const joined = cellTexts.join(' | ');
      const codeMatch = joined.match(COURSE_CODE_RE);
      if (!codeMatch) continue;

      const grade = cellTexts.find((c) => GRADE_RE.test(c)) ?? null;
      const term = cellTexts.find((c) => TERM_RE.test(c)) ?? null;
      if (!grade && !term) continue;

      const code = `${codeMatch[1]} ${codeMatch[2]}`;
      const key = `${code}|${term ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const titleCell = cellTexts.find((c) => {
        const m = c.match(COURSE_CODE_RE);
        return m && c.length > m[0].length + 3;
      });
      const creditsCell = cellTexts.find((c) => /^\d{1,2}(\.\d{1,2})?$/.test(c));

      courses.push({
        code,
        title: titleCell
          ? titleCell.replace(COURSE_CODE_RE, '').replace(/^[\s:–—-]+/, '').trim()
          : code,
        credits: creditsCell ? parseFloat(creditsCell) : null,
        grade,
        term,
        status: grade ? 'completed' : 'in-progress',
      });
    }
  }

  if (courses.length === 0) return null;
  return { courses, capturedAt: Date.now(), source: 'dom' };
}
