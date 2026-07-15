/**
 * Manual edits to the captured schedule (add / remove / rename sections),
 * shared by the calendar panel and the capture widget. All writes go through
 * SCHEDULE_SET so the stored schedule (and thus the calendar) refreshes.
 */
import { getStored } from '../../shared/storage';
import { sendToBackground } from '../../background/messages';
import { parseMeetingPatterns } from '../../shared/time';
import { mergeSections } from '../../shared/schedule';
import type { Section } from '../../shared/types';

async function persist(sections: Section[]): Promise<void> {
  const current = await getStored('schedule');
  await sendToBackground({
    kind: 'SCHEDULE_SET',
    snapshot: {
      termLabel: current?.termLabel ?? null,
      sections,
      capturedAt: Date.now(),
      source: 'dom',
    },
  }).catch(() => {});
}

/** Add a course by code + meeting-pattern text. Returns an error string or null. */
export async function addManualSection(code: string, patternText: string): Promise<string | null> {
  const c = code.trim().replace(/\s+/g, ' ');
  if (!c) return 'Enter a course code.';
  const meetings = parseMeetingPatterns(patternText);
  if (meetings.length === 0) {
    return 'Couldn\'t read the time. Try like "MWF 10:00 AM - 10:50 AM".';
  }
  const current = await getStored('schedule');
  const section: Section = {
    sectionId: `manual:${c}:${Date.now()}`,
    courseCode: c,
    title: c,
    credits: null,
    instructor: null,
    meetings,
  };
  await persist(mergeSections(current?.sections ?? [], [section]));
  return null;
}

export async function removeSection(sectionId: string): Promise<void> {
  const current = await getStored('schedule');
  await persist((current?.sections ?? []).filter((s) => s.sectionId !== sectionId));
}

export async function renameSection(
  sectionId: string,
  courseCode: string,
  title?: string,
): Promise<void> {
  const current = await getStored('schedule');
  await persist(
    (current?.sections ?? []).map((s) =>
      s.sectionId === sectionId
        ? { ...s, courseCode: courseCode.trim() || s.courseCode, title: title ?? s.title }
        : s,
    ),
  );
}
