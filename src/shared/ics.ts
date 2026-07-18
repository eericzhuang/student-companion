/**
 * iCalendar (.ics) export of the captured schedule: one weekly-recurring
 * VEVENT per section meeting, importable into Google/Apple/Outlook calendars.
 * Times are floating local (no TZID) — a 10 AM class is 10 AM wherever the
 * calendar lives, which is what students expect.
 */
import { DAYS, type DayMask, type FinalExam, type Section } from './types';
import { cleanSectionTitle } from './schedule';
import { displayInstructorName } from './fuzzy';

const BYDAY: Array<{ mask: DayMask; code: string; jsDay: number }> = [
  { mask: DAYS.MON, code: 'MO', jsDay: 1 },
  { mask: DAYS.TUE, code: 'TU', jsDay: 2 },
  { mask: DAYS.WED, code: 'WE', jsDay: 3 },
  { mask: DAYS.THU, code: 'TH', jsDay: 4 },
  { mask: DAYS.FRI, code: 'FR', jsDay: 5 },
  { mask: DAYS.SAT, code: 'SA', jsDay: 6 },
  { mask: DAYS.SUN, code: 'SU', jsDay: 0 },
];

/** RFC 5545 text escaping: backslash, comma, semicolon, newline. */
function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\r?\n/g, '\\n');
}

/** Fold lines longer than 75 octets (simple char-based fold is fine for ASCII-ish content). */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest) parts.push(` ${rest}`);
  return parts.join('\r\n');
}

/** "2026-08-24" -> local Date at midnight. Returns null on bad input. */
function parseIsoDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local floating date-time: 20260824T100000 */
function dt(date: Date, minutes: number): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(
    Math.floor(minutes / 60),
  )}${pad(minutes % 60)}00`;
}

/** First date on/after `from` whose weekday is one of the mask's days. */
function firstOccurrence(from: Date, mask: DayMask): Date {
  const d = new Date(from);
  for (let i = 0; i < 7; i++) {
    if (BYDAY.some((b) => b.mask & mask && b.jsDay === d.getDay())) return d;
    d.setDate(d.getDate() + 1);
  }
  return from;
}

export interface IcsOptions {
  /** ISO yyyy-mm-dd; first day of classes. Defaults to the next Monday. */
  termStart?: string;
  /** ISO yyyy-mm-dd; last day of classes. Defaults to 16 weeks after start. */
  termEnd?: string;
  termLabel?: string | null;
  /** one-off final-exam sittings, exported as single (non-recurring) events */
  finals?: FinalExam[];
  /** injectable "today" for tests */
  now?: Date;
}

/** Next Monday strictly after `now` (or `now` itself if it is a Monday). */
export function defaultTermStart(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d;
}

export function buildIcs(sections: Section[], opts: IcsOptions = {}): string {
  const now = opts.now ?? new Date();
  const start = parseIsoDate(opts.termStart) ?? defaultTermStart(now);
  const end =
    parseIsoDate(opts.termEnd) ??
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + 16 * 7);
  // UNTIL is inclusive of the whole last day
  const until = `${end.getFullYear()}${pad(end.getMonth() + 1)}${pad(end.getDate())}T235959`;
  const stamp = dt(new Date(now.getFullYear(), now.getMonth(), now.getDate()), now.getHours() * 60 + now.getMinutes());

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Student Companion for Workday//EN',
    'CALSCALE:GREGORIAN',
  ];
  if (opts.termLabel) lines.push(`X-WR-CALNAME:${escapeText(opts.termLabel)}`);

  for (const s of sections) {
    const title = cleanSectionTitle(s.courseCode, s.title);
    const summary = title && title !== s.courseCode ? `${s.courseCode} — ${title}` : s.courseCode;
    s.meetings.forEach((m, mi) => {
      if (!m.days) return;
      const byday = BYDAY.filter((b) => b.mask & m.days).map((b) => b.code);
      if (byday.length === 0) return;
      const first = firstOccurrence(start, m.days);
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${escapeText(s.sectionId)}-${mi}@student-companion`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`DTSTART:${dt(first, m.startMin)}`);
      lines.push(`DTEND:${dt(first, m.endMin)}`);
      lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${byday.join(',')};UNTIL=${until}`);
      lines.push(`SUMMARY:${escapeText(summary)}`);
      if (m.location) lines.push(`LOCATION:${escapeText(m.location)}`);
      if (s.instructor) lines.push(`DESCRIPTION:${escapeText(`Professor: ${displayInstructorName(s.instructor)}`)}`);
      lines.push('END:VEVENT');
    });
  }

  for (const f of opts.finals ?? []) {
    const d = parseIsoDate(f.date);
    if (!d) continue;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeText(f.id)}@student-companion`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${dt(d, f.startMin)}`);
    lines.push(`DTEND:${dt(d, f.endMin)}`);
    lines.push(`SUMMARY:${escapeText(`🎓 FINAL — ${f.code}`)}`);
    if (f.location) lines.push(`LOCATION:${escapeText(f.location)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
