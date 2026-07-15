/**
 * Decorates Find Course Sections result rows with:
 *  - a red "conflicts" badge when the row's meetings overlap the saved schedule
 *  - an RMP rating badge next to the instructor (click -> popover)
 *  - hover ghosting of the row's meetings into the calendar panel
 */
import { getStored } from '../../shared/storage';
import { sendToBackground, type RmpLookupResult } from '../../background/messages';
import { findConflicts } from '../../shared/time';
import { mergeSections } from '../../shared/schedule';
import type { Section, Settings } from '../../shared/types';
import type { ResultRow } from '../scrapers/findCourseSections';
import { scrapeResultRows } from '../scrapers/findCourseSections';
import { ghostSection } from './CalendarPanel';
import { showCaptureToast } from './captureState';
import { openRmpPopover } from './RmpPopover';
import badgeCss from './badges.css?inline';

const BADGE_STYLE_ID = 'wdc-badge-styles';
const CONFLICT_ATTR = 'data-wdc-conflict';
const RMP_ATTR = 'data-wdc-rmp';
const ADD_ATTR = 'data-wdc-add';

function ensureBadgeStyles(): void {
  if (document.getElementById(BADGE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = BADGE_STYLE_ID;
  style.textContent = badgeCss;
  document.head.appendChild(style);
}

function rowToSection(row: ResultRow): Section {
  return {
    sectionId: row.sectionId,
    courseCode: row.courseCode ?? row.sectionId,
    title: row.title,
    credits: null,
    instructor: row.instructor,
    meetings: row.meetings,
  };
}

function attachHoverGhost(row: ResultRow): void {
  const section = rowToSection(row);
  row.element.addEventListener('mouseenter', () => {
    if (section.meetings.length > 0) ghostSection.value = section;
  });
  row.element.addEventListener('mouseleave', () => {
    if (ghostSection.peek()?.sectionId === section.sectionId) ghostSection.value = null;
  });
}

async function applyConflictBadge(row: ResultRow, scheduleSections: Section[]): Promise<void> {
  row.element.querySelector(`[${CONFLICT_ATTR}]`)?.remove();
  if (row.meetings.length === 0) return;
  const conflicts = findConflicts(rowToSection(row), scheduleSections);
  if (conflicts.length === 0) return;
  const badge = document.createElement('span');
  badge.setAttribute(CONFLICT_ATTR, '1');
  badge.className = 'wdc-conflict-badge';
  badge.textContent = `⛔ conflicts: ${conflicts.map((c) => c.courseCode).join(', ')}`;
  badge.title = 'Overlaps your saved schedule';
  anchorFor(row).appendChild(badge);
}

/** Prefer appending badges next to the title-ish first text node's parent. */
function anchorFor(row: ResultRow): Element {
  const leaf = [...row.element.querySelectorAll('*')].find(
    (el) => el.children.length === 0 && (el.textContent?.trim().length ?? 0) > 8,
  );
  return leaf?.parentElement ?? row.element;
}

function ratingClass(rating: number | null): string {
  if (rating === null) return 'none';
  if (rating >= 3.8) return 'good';
  if (rating >= 2.8) return 'mid';
  return 'bad';
}

async function applyRmpBadge(row: ResultRow): Promise<void> {
  if (!row.instructor) return;
  if (row.element.querySelector(`[${RMP_ATTR}]`)) return;

  const result = await sendToBackground<RmpLookupResult>({
    kind: 'RMP_LOOKUP',
    instructorName: row.instructor,
  }).catch(() => null);
  if (!result || result.needsSetup) return;

  const entry = result.entry;
  const badge = document.createElement('button');
  badge.setAttribute(RMP_ATTR, '1');

  if (!entry || entry.teacher === null) {
    badge.className = 'wdc-rmp-badge none';
    badge.textContent = 'RMP —';
    badge.title = `No RateMyProfessors match for ${row.instructor} (click to search manually)`;
  } else {
    const t = entry.teacher;
    badge.className = `wdc-rmp-badge ${ratingClass(t.avgRating)}${entry.uncertain ? ' uncertain' : ''}`;
    badge.textContent = t.avgRating !== null ? `★ ${t.avgRating.toFixed(1)}` : 'RMP';
    badge.title = `${t.firstName} ${t.lastName} — ${t.numRatings} ratings. Click for details.`;
  }

  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    openRmpPopover(row.instructor!, entry, e.clientX, e.clientY);
  });
  anchorFor(row).appendChild(badge);
}

/**
 * "＋ Add to my calendar" button so the user can tell the extension a course
 * they just added — merges this row's section into the stored schedule.
 */
function applyAddButton(row: ResultRow, scheduleSections: Section[]): void {
  if (row.element.querySelector(`[${ADD_ATTR}]`)) return;
  if (row.meetings.length === 0) return;
  const already = scheduleSections.some((s) => s.sectionId === row.sectionId);
  const btn = document.createElement('button');
  btn.setAttribute(ADD_ATTR, '1');
  btn.className = 'wdc-add-btn';
  btn.textContent = already ? '✓ on calendar' : '＋ add to calendar';
  if (already) btn.classList.add('added');
  btn.title = 'I added this course — put it on my schedule calendar';
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();
    const current = await getStored('schedule');
    const merged = mergeSections(current?.sections ?? [], [rowToSection(row)]);
    await sendToBackground({
      kind: 'SCHEDULE_SET',
      snapshot: {
        termLabel: current?.termLabel ?? null,
        sections: merged,
        capturedAt: Date.now(),
        source: 'dom',
      },
    }).catch(() => {});
    btn.textContent = '✓ on calendar';
    btn.classList.add('added');
    showCaptureToast(`✓ Added ${row.courseCode ?? row.sectionId} to your calendar.`);
  });
  anchorFor(row).appendChild(btn);
}

export async function decorateRows(rows: ResultRow[], settings: Settings): Promise<void> {
  ensureBadgeStyles();
  const schedule = await getStored('schedule');
  const scheduleSections = schedule?.sections ?? [];

  for (const row of rows) {
    attachHoverGhost(row);
    void applyConflictBadge(row, scheduleSections);
    applyAddButton(row, scheduleSections);
    if (settings.rmpEnabled) void applyRmpBadge(row);
  }
}

/** Re-evaluate conflict badges on all rows (saved schedule changed). */
export async function redecorateAll(settings: Settings): Promise<void> {
  const schedule = await getStored('schedule');
  const scheduleSections = schedule?.sections ?? [];
  const rows = scrapeResultRows(document, true);
  for (const row of rows) {
    void applyConflictBadge(row, scheduleSections);
    applyAddButton(row, scheduleSections);
    if (settings.rmpEnabled) void applyRmpBadge(row);
  }
}
