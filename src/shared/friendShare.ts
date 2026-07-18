/**
 * Friend schedule sharing: a tiny JSON file a student can send to a friend so
 * both can see shared classes and mutual free time. Deliberately minimal —
 * course codes, titles, and meeting times only (no professors, no locations),
 * and it never touches a server.
 */
import { DAYS, type Meeting, type ScheduleSnapshot, type Section } from './types';

export interface ShareFile {
  kind: 'wdc-share';
  version: 1;
  name: string;
  termLabel: string | null;
  sections: Array<{
    courseCode: string;
    title: string;
    meetings: Array<{ days: number; startMin: number; endMin: number }>;
  }>;
}

export function buildShareFile(schedule: ScheduleSnapshot, name: string): ShareFile {
  return {
    kind: 'wdc-share',
    version: 1,
    name: name.trim() || 'A friend',
    termLabel: schedule.termLabel,
    sections: schedule.sections.map((s) => ({
      courseCode: s.courseCode,
      title: s.title,
      meetings: s.meetings.map((m) => ({ days: m.days, startMin: m.startMin, endMin: m.endMin })),
    })),
  };
}

const ALL_DAYS = Object.values(DAYS).reduce((a, b) => a | b, 0);

/** Parse + validate a share file. Returns null if it isn't one. */
export function parseShareFile(text: string): { name: string; termLabel: string | null; sections: Section[] } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const f = raw as Partial<ShareFile>;
  if (f?.kind !== 'wdc-share' || !Array.isArray(f.sections)) return null;
  const sections: Section[] = [];
  for (const [i, s] of f.sections.entries()) {
    if (typeof s?.courseCode !== 'string' || !Array.isArray(s.meetings)) continue;
    const meetings: Meeting[] = [];
    for (const m of s.meetings) {
      if (
        typeof m?.days !== 'number' ||
        typeof m.startMin !== 'number' ||
        typeof m.endMin !== 'number' ||
        (m.days & ~ALL_DAYS) !== 0 ||
        m.startMin < 0 ||
        m.endMin > 24 * 60 ||
        m.endMin <= m.startMin
      ) {
        continue;
      }
      meetings.push({ days: m.days, startMin: m.startMin, endMin: m.endMin });
    }
    sections.push({
      sectionId: `friend:${i}:${s.courseCode}`,
      courseCode: s.courseCode,
      title: typeof s.title === 'string' ? s.title : s.courseCode,
      credits: null,
      instructor: null,
      meetings,
    });
  }
  if (sections.length === 0) return null;
  return {
    name: typeof f.name === 'string' && f.name.trim() ? f.name.trim() : 'A friend',
    termLabel: typeof f.termLabel === 'string' ? f.termLabel : null,
    sections,
  };
}

/** Course codes present in both schedules. */
export function sharedCourses(mine: Section[], friend: Section[]): string[] {
  const theirs = new Set(friend.map((s) => s.courseCode));
  return [...new Set(mine.map((s) => s.courseCode).filter((c) => theirs.has(c)))];
}
