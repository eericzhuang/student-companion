/**
 * Meeting-pattern parsing and time-overlap math.
 *
 * Workday renders meeting patterns in several shapes, e.g.:
 *   "MWF 10:00 AM - 10:50 AM"
 *   "Mon/Wed/Fri | 10:00 AM - 10:50 AM | Room 101"
 *   "TTh 1:30 PM - 2:45 PM"
 *   "Tue Thu | 13:30 - 14:45"
 * Unknown patterns return null; callers render an "unscheduled" chip rather
 * than guessing.
 */
import { DAYS, type DayMask, type Meeting, type Section } from './types';

const DAY_TOKENS: Record<string, DayMask> = {
  // full + common abbreviations
  monday: DAYS.MON, mon: DAYS.MON, mo: DAYS.MON,
  tuesday: DAYS.TUE, tues: DAYS.TUE, tue: DAYS.TUE, tu: DAYS.TUE,
  wednesday: DAYS.WED, wed: DAYS.WED, we: DAYS.WED,
  thursday: DAYS.THU, thurs: DAYS.THU, thur: DAYS.THU, thu: DAYS.THU, th: DAYS.THU,
  friday: DAYS.FRI, fri: DAYS.FRI, fr: DAYS.FRI,
  saturday: DAYS.SAT, sat: DAYS.SAT, sa: DAYS.SAT,
  sunday: DAYS.SUN, sun: DAYS.SUN, su: DAYS.SUN,
};

/**
 * Parse compact day strings like "MWF", "TTh", "MTWThF", "TR".
 * Single letters: M T W R(=Thu) F S U; "Th" consumes two chars.
 */
export function parseCompactDays(s: string): DayMask | null {
  let mask = 0;
  let i = 0;
  while (i < s.length) {
    const two = s.slice(i, i + 2).toLowerCase();
    if (two === 'th') { mask |= DAYS.THU; i += 2; continue; }
    if (two === 'tu') { mask |= DAYS.TUE; i += 2; continue; }
    if (two === 'sa') { mask |= DAYS.SAT; i += 2; continue; }
    if (two === 'su') { mask |= DAYS.SUN; i += 2; continue; }
    if (two === 'mo') { mask |= DAYS.MON; i += 2; continue; }
    if (two === 'we') { mask |= DAYS.WED; i += 2; continue; }
    if (two === 'fr') { mask |= DAYS.FRI; i += 2; continue; }
    const c = s[i]!.toLowerCase();
    switch (c) {
      case 'm': mask |= DAYS.MON; break;
      case 't': mask |= DAYS.TUE; break;
      case 'w': mask |= DAYS.WED; break;
      case 'r': mask |= DAYS.THU; break; // TR convention
      case 'f': mask |= DAYS.FRI; break;
      case 's': mask |= DAYS.SAT; break;
      case 'u': mask |= DAYS.SUN; break;
      default: return null;
    }
    i += 1;
  }
  return mask || null;
}

/** Parse day names separated by space, comma, slash, or ampersand. */
export function parseDayList(s: string): DayMask | null {
  const tokens = s.split(/[\s,/&]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  let mask = 0;
  for (const t of tokens) {
    const day = DAY_TOKENS[t.toLowerCase().replace(/\.$/, '')];
    if (day === undefined) return null;
    mask |= day;
  }
  return mask;
}

export function parseDays(s: string): DayMask | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  return parseDayList(trimmed) ?? parseCompactDays(trimmed.replace(/[^a-zA-Z]/g, ''));
}

/** "10:00 AM" | "1:30PM" | "13:30" -> minutes since midnight, or null. */
export function parseClockTime(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*([ap])?\.?m?\.?$/i);
  if (!m) return null;
  let hours = parseInt(m[1]!, 10);
  const minutes = parseInt(m[2]!, 10);
  if (minutes > 59) return null;
  const meridiem = m[3]?.toLowerCase();
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'p' && hours !== 12) hours += 12;
    if (meridiem === 'a' && hours === 12) hours = 0;
  } else if (hours > 23) {
    return null;
  }
  return hours * 60 + minutes;
}

const TIME_RANGE_RE =
  /(\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?)\s*(?:-|–|—|to)\s*(\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?)/i;

/**
 * Parse a full meeting-pattern string into a Meeting.
 * Handles "|"-separated Workday format ("Mon/Wed | 10:00 AM - 10:50 AM | Hall 1")
 * and inline format ("MWF 10:00 AM - 10:50 AM").
 */
export function parseMeetingPattern(raw: string): Meeting | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const rangeMatch = text.match(TIME_RANGE_RE);
  if (!rangeMatch) return null;
  let start = parseClockTime(rangeMatch[1]!);
  let end = parseClockTime(rangeMatch[2]!);
  if (start === null || end === null) return null;
  // "11:00 - 1:50" with no meridiem: assume PM end crossing noon
  if (end <= start && end + 720 > start) end += 720;
  if (end <= start) return null;

  const before = text.slice(0, rangeMatch.index).replace(/[|]/g, ' ').trim();
  const after = text.slice((rangeMatch.index ?? 0) + rangeMatch[0].length);

  const days = parseDays(before);
  if (days === null) return null;

  const location = after.replace(/^[\s|,-]+/, '').trim() || undefined;
  return { days, startMin: start, endMin: end, location };
}

/** Parse a blob that may contain several patterns separated by newlines/semicolons. */
export function parseMeetingPatterns(raw: string): Meeting[] {
  return raw
    .split(/[\n;]+/)
    .map((part) => parseMeetingPattern(part))
    .filter((m): m is Meeting => m !== null);
}

export function meetingsOverlap(a: Meeting, b: Meeting): boolean {
  return (a.days & b.days) !== 0 && a.startMin < b.endMin && b.startMin < a.endMin;
}

export function sectionsConflict(a: Section, b: Section): boolean {
  return a.meetings.some((ma) => b.meetings.some((mb) => meetingsOverlap(ma, mb)));
}

/** Find sections in `schedule` that conflict with `candidate`. */
export function findConflicts(candidate: Section, schedule: Section[]): Section[] {
  return schedule.filter(
    (s) => s.sectionId !== candidate.sectionId && sectionsConflict(candidate, s),
  );
}

export function formatMinutes(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const meridiem = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${meridiem}`;
}

export interface FreeSlot {
  startMin: number;
  endMin: number;
}

/**
 * Compute open time windows per weekday within [windowStart, windowEnd],
 * given the busy meetings. Used for the "available time options" list so the
 * student can see when they can fit another course.
 */
export function computeFreeSlots(
  sections: Section[],
  windowStart = 8 * 60,
  windowEnd = 21 * 60,
): Array<{ day: DayMask; label: string; slots: FreeSlot[] }> {
  const DAY_LIST: Array<{ day: DayMask; label: string }> = [
    { day: DAYS.MON, label: 'Mon' },
    { day: DAYS.TUE, label: 'Tue' },
    { day: DAYS.WED, label: 'Wed' },
    { day: DAYS.THU, label: 'Thu' },
    { day: DAYS.FRI, label: 'Fri' },
    { day: DAYS.SAT, label: 'Sat' },
    { day: DAYS.SUN, label: 'Sun' },
  ];

  const hasWeekend = sections.some((s) =>
    s.meetings.some((m) => m.days & (DAYS.SAT | DAYS.SUN)),
  );
  const days = hasWeekend ? DAY_LIST : DAY_LIST.slice(0, 5);

  return days.map(({ day, label }) => {
    // Busy intervals on this day, merged.
    const busy = sections
      .flatMap((s) => s.meetings)
      .filter((m) => m.days & day)
      .map((m) => ({ startMin: Math.max(m.startMin, windowStart), endMin: Math.min(m.endMin, windowEnd) }))
      .filter((m) => m.endMin > m.startMin)
      .sort((a, b) => a.startMin - b.startMin);

    const merged: FreeSlot[] = [];
    for (const b of busy) {
      const last = merged[merged.length - 1];
      if (last && b.startMin <= last.endMin) last.endMin = Math.max(last.endMin, b.endMin);
      else merged.push({ ...b });
    }

    const slots: FreeSlot[] = [];
    let cursor = windowStart;
    for (const b of merged) {
      if (b.startMin - cursor >= 30) slots.push({ startMin: cursor, endMin: b.startMin });
      cursor = Math.max(cursor, b.endMin);
    }
    if (windowEnd - cursor >= 30) slots.push({ startMin: cursor, endMin: windowEnd });

    return { day, label, slots };
  });
}

export function dayMaskToLabels(mask: DayMask): string[] {
  const out: string[] = [];
  if (mask & DAYS.MON) out.push('Mon');
  if (mask & DAYS.TUE) out.push('Tue');
  if (mask & DAYS.WED) out.push('Wed');
  if (mask & DAYS.THU) out.push('Thu');
  if (mask & DAYS.FRI) out.push('Fri');
  if (mask & DAYS.SAT) out.push('Sat');
  if (mask & DAYS.SUN) out.push('Sun');
  return out;
}
