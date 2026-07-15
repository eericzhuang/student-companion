/**
 * Heuristic parser for intercepted Workday UI-model JSON.
 *
 * Workday's SPA fetches "UI model" payloads (nested widget trees). Rather than
 * depending on any tenant-specific shape, we deep-walk the tree, cluster the
 * string leaves of each subtree, and recognize course-section rows (course
 * code + parseable meeting pattern) and transcript rows (course code + grade
 * + credits). Tune against real fixtures captured from the user's tenant.
 */
import type { HistoryCourse, Meeting, Section } from '../../shared/types';
import { parseMeetingPatterns } from '../../shared/time';

export const COURSE_CODE_RE = /\b([A-Z]{2,6})\s?-?\s?(\d{3,5}[A-Z]?)\b/;
const GRADE_RE = /^(A|A-|A\+|B\+|B|B-|C\+|C|C-|D\+|D|D-|F|P|NP|CR|NC|W|I|S|U|IP)$/;
const SECTION_SUFFIX_RE = /\b\d{3,5}[A-Z]?-([A-Z0-9]{1,4})\b/;

interface LeafCluster {
  strings: string[];
  depth: number;
}

/** Collect string leaves of a subtree, stopping at nested arrays (row bounds). */
function collectStrings(node: unknown, out: string[], depth = 0): void {
  if (depth > 6 || out.length > 60) return;
  if (typeof node === 'string') {
    const t = node.trim();
    if (t && t.length < 300) out.push(t);
    return;
  }
  if (typeof node === 'number') {
    out.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out, depth + 1);
    return;
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectStrings(value, out, depth + 1);
  }
}

/** Walk the tree yielding every object/array subtree ("candidate row"). */
function* walkSubtrees(node: unknown, depth = 0): Generator<unknown> {
  if (depth > 25 || node === null || typeof node !== 'object') return;
  yield node;
  const children = Array.isArray(node) ? node : Object.values(node);
  for (const child of children) yield* walkSubtrees(child, depth + 1);
}

function extractCourseCode(strings: string[]): { code: string; title: string | null } | null {
  for (const s of strings) {
    const m = s.match(COURSE_CODE_RE);
    if (!m) continue;
    const code = `${m[1]} ${m[2]}`;
    // Title often follows the code in the same string: "CS 2110 - Data Structures"
    const after = s.slice((m.index ?? 0) + m[0].length).replace(/^[\s:–—-]+/, '').trim();
    return { code, title: after || null };
  }
  return null;
}

function extractMeetings(strings: string[]): Meeting[] {
  for (const s of strings) {
    const meetings = parseMeetingPatterns(s);
    if (meetings.length > 0) return meetings;
  }
  return [];
}

function extractCredits(strings: string[]): number | null {
  for (const s of strings) {
    const m = s.match(/^(\d{1,2}(?:\.\d{1,2})?)\s*(credits?|units?|hours?)?$/i);
    if (m && (m[2] || (parseFloat(m[1]!) > 0 && parseFloat(m[1]!) <= 12))) {
      return parseFloat(m[1]!);
    }
  }
  return null;
}

/** Workday column labels that look like capitalized name pairs but aren't people. */
const LABEL_WORDS =
  /\b(section|course|meeting|pattern|patterns|instructor|credits?|units?|instructional|format|delivery|mode|start|end|date|location|campus|building|room|waitlist|enrolled|status|academic|period|details|subject|catalog|title|term|semester|offering|component|schedule|type)\b/i;

/**
 * Academic/course-title words that produce Title-Case false positives
 * ("Linear Algebra", "Core Systems"). Filtering these keeps professor scanning
 * accurate and fast (fewer wasted RMP lookups).
 */
const SUBJECT_WORDS =
  /\b(algebra|calculus|programming|systems?|mechanics|physics|chemistry|biology|history|economics|engineering|science|sciences|mathematics|statistics|analysis|structures?|computing|design|theory|methods?|principles?|introduction|introductory|fundamentals?|sequence|requirements?|electives?|concentration|core|minor|major|bachelor|master|seminar|laboratory|studies|management|accounting|marketing|finance|psychology|sociology|philosophy|literature|writing|communications?|networks?|database|algorithms?|architecture|operating|organization|discrete|linear|differential|quantum|organic|molecular|cellular|genetics|ecology|anatomy|topics|foundations?|survey|workshop|practicum|capstone|thesis|honors|general|applied|advanced|intermediate|elementary)\b/i;

function isLabelLike(s: string): boolean {
  return LABEL_WORDS.test(s) || SUBJECT_WORDS.test(s);
}

/** A plausible person name: 2-4 capitalized words, no digits, not a label/code. */
export function looksLikePersonName(s: string): boolean {
  if (COURSE_CODE_RE.test(s) || /\d/.test(s) || isLabelLike(s)) return false;
  return /^[A-Z][a-zA-Z'.-]+(,)?(\s[A-Z][a-zA-Z'.-]+){1,3}$/.test(s);
}

function extractInstructor(strings: string[]): string | null {
  for (const s of strings) {
    if (looksLikePersonName(s)) return s;
  }
  return null;
}

/** Recognize course sections (rows with a course code AND meeting pattern). */
export function extractSections(json: unknown): Section[] {
  const seen = new Map<string, Section>();
  for (const subtree of walkSubtrees(json)) {
    const strings: string[] = [];
    collectStrings(subtree, strings);
    if (strings.length < 2 || strings.length > 50) continue;

    const course = extractCourseCode(strings);
    if (!course) continue;
    const meetings = extractMeetings(strings);
    if (meetings.length === 0) continue;

    const sectionMatch = strings.map((s) => s.match(SECTION_SUFFIX_RE)).find(Boolean);
    const sectionId = sectionMatch ? `${course.code}-${sectionMatch[1]}` : course.code;
    const existing = seen.get(sectionId);
    const section: Section = {
      sectionId,
      courseCode: course.code,
      title: course.title ?? existing?.title ?? course.code,
      credits: extractCredits(strings) ?? existing?.credits ?? null,
      instructor: extractInstructor(strings) ?? existing?.instructor ?? null,
      meetings,
    };
    // Keep the richest variant (deepest subtrees repeat the same row)
    if (!existing || (existing.instructor === null && section.instructor !== null)) {
      seen.set(sectionId, section);
    }
  }
  return [...seen.values()];
}

/** Recognize transcript rows (course code + grade token, no meeting pattern needed). */
export function extractHistoryCourses(json: unknown): HistoryCourse[] {
  const seen = new Map<string, HistoryCourse>();
  for (const subtree of walkSubtrees(json)) {
    const strings: string[] = [];
    collectStrings(subtree, strings);
    if (strings.length < 2 || strings.length > 40) continue;

    const course = extractCourseCode(strings);
    if (!course) continue;
    const grade = strings.find((s) => GRADE_RE.test(s.trim())) ?? null;
    const term = strings.find((s) => /\b(fall|spring|summer|winter)\b.*\d{4}|\d{4}.*\b(fall|spring|summer|winter)\b/i.test(s)) ?? null;
    // Require at least a grade or a term so arbitrary course mentions don't count
    if (!grade && !term) continue;

    const key = `${course.code}|${term ?? ''}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      code: course.code,
      title: course.title ?? course.code,
      credits: extractCredits(strings),
      grade,
      term,
      status: grade ? 'completed' : 'in-progress',
    });
  }
  return [...seen.values()];
}
