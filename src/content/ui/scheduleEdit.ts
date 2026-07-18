/**
 * Manual edits to the captured schedule (add / remove / rename sections),
 * shared by the calendar panel and the capture widget. All writes go through
 * SCHEDULE_SET so the stored schedule (and thus the calendar) refreshes.
 */
import { getStored } from '../../shared/storage';
import { sendToBackground } from '../../background/messages';
import { parseMeetingPatterns } from '../../shared/time';
import { mergeSections } from '../../shared/schedule';
import type { FinalExam, Section } from '../../shared/types';

// Serialize edits: each one is a read-modify-write on the stored schedule, so
// two quick edits (e.g. professor then location) must not read the same
// snapshot or the second write silently drops the first.
let editQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = editQueue.then(fn, fn);
  editQueue = run.catch(() => {});
  return run;
}

async function persist(sections: Section[], finals?: FinalExam[]): Promise<void> {
  const current = await getStored('schedule');
  await sendToBackground({
    kind: 'SCHEDULE_SET',
    snapshot: {
      termLabel: current?.termLabel ?? null,
      sections,
      capturedAt: Date.now(),
      source: 'dom',
      finals: finals ?? current?.finals ?? [],
    },
  }).catch(() => {});
}

/** Add a course by code + meeting-pattern text. Returns an error string or null. */
export async function addManualSection(code: string, patternText: string, instructor?: string): Promise<string | null> {
  const c = code.trim().replace(/\s+/g, ' ');
  if (!c) return 'Enter a course code.';
  const meetings = parseMeetingPatterns(patternText);
  if (meetings.length === 0) {
    return 'Couldn\'t read the time. Try like "MWF 10:00 AM - 10:50 AM".';
  }
  return enqueue(async () => {
    const current = await getStored('schedule');
    const section: Section = {
      sectionId: `manual:${c}:${Date.now()}`,
      courseCode: c,
      title: c,
      credits: null,
      instructor: instructor?.trim() || null,
      meetings,
    };
    await persist(mergeSections(current?.sections ?? [], [section]));
    return null;
  });
}

export async function removeSection(sectionId: string): Promise<void> {
  return enqueue(async () => {
    const current = await getStored('schedule');
    await persist((current?.sections ?? []).filter((s) => s.sectionId !== sectionId));
  });
}

export async function renameSection(
  sectionId: string,
  courseCode: string,
  title?: string,
): Promise<void> {
  return enqueue(async () => {
    const current = await getStored('schedule');
    await persist(
      (current?.sections ?? []).map((s) =>
        s.sectionId === sectionId
          ? { ...s, courseCode: courseCode.trim() || s.courseCode, title: title ?? s.title }
          : s,
      ),
    );
  });
}

/** Edit a section's professor and/or location (location applies to all its meetings). */
export async function updateSectionDetails(
  sectionId: string,
  patch: { instructor?: string; location?: string },
): Promise<void> {
  return enqueue(async () => {
    const current = await getStored('schedule');
    await persist(
      (current?.sections ?? []).map((s) => {
        if (s.sectionId !== sectionId) return s;
        return {
          ...s,
          instructor: patch.instructor !== undefined ? patch.instructor.trim() || null : s.instructor,
          meetings:
            patch.location !== undefined
              ? s.meetings.map((m) => ({ ...m, location: patch.location!.trim() || undefined }))
              : s.meetings,
        };
      }),
    );
  });
}

/** Add a final-exam sitting. Returns an error string or null. */
export async function addFinal(
  code: string,
  date: string,
  startMin: number,
  endMin: number,
  location?: string,
): Promise<string | null> {
  const c = code.trim().replace(/\s+/g, ' ');
  if (!c) return 'Enter a course code.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Pick the exam date.';
  if (endMin <= startMin) return 'The end time must be after the start.';
  return enqueue(async () => {
    const current = await getStored('schedule');
    const final: FinalExam = {
      id: `final:${c}:${Date.now()}`,
      code: c,
      date,
      startMin,
      endMin,
      location: location?.trim() || undefined,
    };
    await persist(current?.sections ?? [], [...(current?.finals ?? []), final]);
    return null;
  });
}

export async function removeFinal(id: string): Promise<void> {
  return enqueue(async () => {
    const current = await getStored('schedule');
    await persist(current?.sections ?? [], (current?.finals ?? []).filter((f) => f.id !== id));
  });
}
