/**
 * Rule-based parser for unofficial transcript text (from an uploaded PDF or
 * pasted text). Produces AcademicHistory courses. Transcript layouts vary, so
 * this is best-effort: it scans for course-code + grade patterns line by line,
 * tracks the current term heading, and skips in-progress / registered rows.
 */
import type { HistoryCourse } from './types';
import { AMBIGUOUS_GRADES, plausibleCredits, statusForGrade } from './grades';

const COURSE_CODE = /\b([A-Z]{2,6})\s?-?\s?(\d{3,5}[A-Z]?)\b/;
// Standalone grade token: whitespace/edge on both sides so "A-" isn't clipped to "A".
const GRADE_G =
  /(?:^|\s)(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D-|D|F|P|NP|CR|NC|S|U|W|I|IP|AU|TR)(?=\s|$)/g;
const TERM =
  /\b(fall|spring|summer|winter|autumn)\b[^\n]{0,12}?\b(\d{4})\b|\b(\d{4})\b[^\n]{0,4}?\b(fall|spring|summer|winter|autumn)\b/i;
const CREDIT = /\b(\d{1,2}(?:\.\d{1,2})?)\b/;

function findTerm(line: string): string | null {
  const m = line.match(TERM);
  if (!m) return null;
  return m[0].replace(/\s+/g, ' ').trim();
}

/**
 * Pull the grade token that appears late in the line (transcripts put it last).
 * "I"/"S"/"U"/"P" are only grades when nothing follows them — otherwise they're
 * Roman numerals or words in the title ("Physics I Mechanics").
 */
function findGrade(afterCode: string): string | null {
  const matches = [...afterCode.matchAll(GRADE_G)];
  for (let i = matches.length - 1; i >= 0; i--) {
    const token = matches[i]![1]!;
    const end = (matches[i]!.index ?? 0) + matches[i]![0].length;
    if (AMBIGUOUS_GRADES.has(token) && afterCode.slice(end).trim() !== '') continue;
    return token;
  }
  return null;
}

export function parseTranscriptText(text: string): HistoryCourse[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const courses: HistoryCourse[] = [];
  const seen = new Set<string>();
  let currentTerm: string | null = null;

  for (const line of lines) {
    // A line that is mostly a term heading updates the term context.
    const termInLine = findTerm(line);
    const codeMatch = line.match(COURSE_CODE);

    if (termInLine && !codeMatch) {
      currentTerm = termInLine;
      continue;
    }
    if (!codeMatch) continue;

    const code = `${codeMatch[1]} ${codeMatch[2]}`;
    // Drop a section suffix ("CSE 1302-01") first — otherwise "01" reads as a
    // one-credit course.
    const afterCode = line
      .slice((codeMatch.index ?? 0) + codeMatch[0].length)
      .replace(/^\s*-\s*[A-Z0-9]{1,4}\b/i, '');
    const grade = findGrade(afterCode);

    // Title = text right after the code, before numbers/grades.
    const titleMatch = afterCode.match(/^[\s:–—-]*([A-Za-z][A-Za-z0-9 &/,'.:()-]{2,70}?)(?=\s{2,}|\s\d|\s[A-F][\s+-]|$)/);
    const title = titleMatch ? titleMatch[1]!.trim() : null;

    // Credits: the first standalone small number after the title. Later numbers
    // on a transcript line are usually quality points, not credits.
    const creditMatch = afterCode.match(CREDIT);
    const creditValue = creditMatch ? parseFloat(creditMatch[1]!) : null;
    const credits = creditValue !== null && plausibleCredits(creditValue) ? creditValue : null;

    const term = termInLine ?? currentTerm;
    const key = `${code}|${term ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    courses.push({
      code,
      title: title ?? code,
      credits,
      grade,
      term,
      status: statusForGrade(grade),
    });
  }

  return courses;
}
