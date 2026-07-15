/**
 * Rule-based degree-requirements parser used when no Claude API key is set.
 * Far less accurate than the LLM path — it detects headings, "choose N" /
 * "N credits" phrases, and course codes by regex — but it gives the user a
 * structured starting point to fix up in the ReviewEditor, keeping the key
 * strictly optional.
 */
import type { DegreeProgram, RequirementCourse, RequirementGroup } from '../shared/types';

const COURSE_CODE = /\b([A-Z]{2,6})\s?-?\s?(\d{3,5}[A-Z]?)\b/g;
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

function parseCount(text: string): number | null {
  const digit = text.match(/\b(\d{1,2})\b/);
  if (digit) return parseInt(digit[1]!, 10);
  for (const [word, n] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text)) return n;
  }
  return null;
}

function detectRule(line: string): RequirementGroup['rule'] | null {
  if (/\b(choose|select|complete|take)\b.*\bfollowing\b/i.test(line) || /\bof the following\b/i.test(line)) {
    const n = parseCount(line);
    if (n !== null) return { kind: 'chooseN', n };
  }
  const creditsMatch = line.match(/\b(\d{1,2})\s*(credits?|units?|hours?)\b/i);
  if (creditsMatch && /\b(from|of|among|following|choose|select)\b/i.test(line)) {
    return { kind: 'credits', credits: parseInt(creditsMatch[1]!, 10) };
  }
  return null;
}

/** A heading is a short line with no course code that isn't a sentence. */
function looksLikeHeading(line: string): boolean {
  if (line.length === 0 || line.length > 90) return false;
  COURSE_CODE.lastIndex = 0;
  if (COURSE_CODE.test(line)) return false;
  if (/[.]{1}\s|[.]$/.test(line) && line.split(' ').length > 10) return false;
  return (
    /requirement|core|elective|foundation|concentration|capstone|track|option|sequence|select|choose|credits?|units?|courses?/i.test(
      line,
    ) || /:$/.test(line)
  );
}

function coursesFromLine(line: string): RequirementCourse[] {
  const out: RequirementCourse[] = [];
  COURSE_CODE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COURSE_CODE.exec(line)) !== null) {
    const code = `${m[1]} ${m[2]}`;
    const rest = line.slice(m.index + m[0].length).replace(/^[\s:–—-]+/, '');
    const titleMatch = rest.match(/^([A-Za-z][A-Za-z0-9 &/,'-]{2,60})/);
    const creditsMatch = line.match(/\b(\d(?:\.\d)?)\s*(credits?|units?|hours?)\b/i);
    out.push({
      code,
      title: titleMatch ? titleMatch[1]!.trim() : null,
      credits: creditsMatch ? parseFloat(creditsMatch[1]!) : null,
      prereqCodes: [],
      equivalents: [],
    });
  }
  return out;
}

export function heuristicParseDegree(text: string): DegreeProgram {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const groups: RequirementGroup[] = [];
  let current: RequirementGroup | null = null;
  const ensureGroup = (title: string, rule: RequirementGroup['rule']): RequirementGroup => {
    const g: RequirementGroup = { title, rule, courses: [], notes: null };
    groups.push(g);
    return g;
  };

  for (const line of lines) {
    if (looksLikeHeading(line)) {
      const rule = detectRule(line) ?? { kind: 'all' };
      current = ensureGroup(line.replace(/:$/, ''), rule);
      continue;
    }
    const courses = coursesFromLine(line);
    if (courses.length === 0) continue;
    if (!current) current = ensureGroup('Requirements', { kind: 'all' });
    // dedupe within group
    for (const c of courses) {
      if (!current.courses.some((x) => x.code === c.code)) current.courses.push(c);
    }
  }

  // Drop empty groups; if nothing found, leave one editable placeholder.
  const nonEmpty = groups.filter((g) => g.courses.length > 0);
  const finalGroups = nonEmpty.length
    ? nonEmpty
    : [{ title: 'Requirements', rule: { kind: 'all' as const }, courses: [], notes: null }];

  const totalCreditsMatch = text.match(/\b(\d{2,3})\s*(credits?|units?|hours?)\b[^.]*\b(degree|program|major|minor|total|required)\b/i);

  // Guess a name from the first heading-ish line
  const name = lines.find((l) => /\b(b\.?s\.?|b\.?a\.?|bachelor|major|minor|certificate)\b/i.test(l)) ?? 'Imported degree';

  return {
    name: name.slice(0, 80),
    type: /minor/i.test(name) ? 'minor' : /certificate/i.test(name) ? 'certificate' : 'major',
    totalCredits: totalCreditsMatch ? parseInt(totalCreditsMatch[1]!, 10) : null,
    groups: finalGroups,
  };
}
