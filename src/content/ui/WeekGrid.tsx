/**
 * Weekly calendar grid rendering schedule sections as positioned blocks.
 * A "ghost" section (hovered search result) renders dashed; blocks overlapping
 * a ghost get a red conflict outline.
 */
import { useMemo } from 'preact/hooks';
import { DAYS, type DayMask, type Meeting, type Section } from '../../shared/types';
import { formatMinutes, meetingsOverlap } from '../../shared/time';
import { meetingKey } from '../../shared/route';
import { displayInstructorName } from '../../shared/fuzzy';
import { ratingClass } from '../../shared/rmpUrl';

const DAY_ORDER: Array<{ mask: DayMask; label: string }> = [
  { mask: DAYS.MON, label: 'Mon' },
  { mask: DAYS.TUE, label: 'Tue' },
  { mask: DAYS.WED, label: 'Wed' },
  { mask: DAYS.THU, label: 'Thu' },
  { mask: DAYS.FRI, label: 'Fri' },
  { mask: DAYS.SAT, label: 'Sat' },
  { mask: DAYS.SUN, label: 'Sun' },
];

export const PALETTE = ['#0f4c81', '#0e7490', '#7c2d92', '#b45309', '#166534', '#9f1239', '#3730a3'];

const PX_PER_MIN = 0.8; // vertical scale; a 10-hour span ≈ 480px

interface Props {
  sections: Section[];
  ghost: Section | null;
  /** meetingKey -> warning ("10 min break, ~26 min walk …"); ⚠-badges the block */
  warnings?: Map<string, { text: string; miss: boolean }>;
  /** clicking a block opens its details (professor, rating, room) */
  onEventClick?: (section: Section, meeting: Meeting) => void;
  /** vertical zoom (1 = compact); a stretched panel passes >1 so taller blocks
   *  reveal room, professor, and rating inline */
  scale?: number;
  /** instructor (raw scraped name) -> RMP avg rating, for inline display */
  ratings?: Map<string, number | null>;
}

export function WeekGrid({ sections, ghost, warnings, onEventClick, scale = 1, ratings }: Props) {
  const pxPerMin = PX_PER_MIN * Math.max(1, scale);
  const all = useMemo(() => [...sections, ...(ghost ? [ghost] : [])], [sections, ghost]);

  const showWeekend = useMemo(
    () => all.some((s) => s.meetings.some((m) => m.days & (DAYS.SAT | DAYS.SUN))),
    [all],
  );
  const days = showWeekend ? DAY_ORDER : DAY_ORDER.slice(0, 5);

  // Fit the visible range to the actual meetings so every course shows, with a
  // small pad. Falls back to a normal school day when there are no meetings.
  const { startHour, endHour } = useMemo(() => {
    const meetings = all.flatMap((s) => s.meetings);
    if (meetings.length === 0) return { startHour: 8, endHour: 18 };
    const minStart = Math.min(...meetings.map((m) => m.startMin));
    const maxEnd = Math.max(...meetings.map((m) => m.endMin));
    return {
      startHour: Math.max(0, Math.floor(minStart / 60) - 1),
      endHour: Math.min(24, Math.ceil(maxEnd / 60) + 1),
    };
  }, [all]);

  const colorFor = useMemo(() => {
    const map = new Map<string, string>();
    sections.forEach((s, i) => map.set(s.sectionId, PALETTE[i % PALETTE.length]!));
    return (id: string) => map.get(id) ?? '#475569';
  }, [sections]);

  const totalHeight = (endHour - startHour) * 60 * pxPerMin;
  const top = (min: number) =>
    (Math.min(Math.max(min, startHour * 60), endHour * 60) - startHour * 60) * pxPerMin;

  const hours: number[] = [];
  for (let h = startHour; h <= endHour; h++) hours.push(h);

  const renderBlocks = (dayMask: DayMask) => {
    const blocks = [];
    for (const section of sections) {
      for (const m of section.meetings) {
        if (!(m.days & dayMask)) continue;
        const conflictsGhost =
          ghost !== null &&
          ghost.sectionId !== section.sectionId &&
          ghost.meetings.some((gm) => (gm.days & dayMask) && meetingsOverlap(gm, m));
        const warn = warnings?.get(meetingKey(section.sectionId, dayMask, m.startMin));
        const heightPx = Math.max((m.endMin - m.startMin) * pxPerMin, 14);
        blocks.push(
          <div
            class={`wdc-block${conflictsGhost ? ' wdc-block-conflict' : ''}${onEventClick ? ' wdc-block-click' : ''}`}
            style={{
              top: `${top(m.startMin)}px`,
              height: `${heightPx}px`,
              background: colorFor(section.sectionId),
            }}
            title={`${section.courseCode} ${formatMinutes(m.startMin)}–${formatMinutes(m.endMin)}${m.location ? ` · ${m.location}` : ''}${section.instructor ? ` · ${section.instructor}` : ''}${warn ? `\n⚠ ${warn.text}` : ''}${onEventClick ? '\nClick for details' : ''}`}
            onClick={() => onEventClick?.(section, m)}
          >
            {warn && (
              <span class={`wdc-block-warn${warn.miss ? ' wdc-warn-miss' : ''}`} title={warn.text}>
                ⚠
              </span>
            )}
            <div>{section.courseCode}</div>
            <div class="wdc-block-time">
              {formatMinutes(m.startMin)}–{formatMinutes(m.endMin)}
            </div>
            {m.location && heightPx > 42 && <div class="wdc-block-room">📍 {m.location}</div>}
            {section.instructor && heightPx > 58 && (
              <div class="wdc-block-room">
                👤 {displayInstructorName(section.instructor)}
                {ratings?.get(section.instructor) != null && (
                  <b class={`wdc-rate-block-${ratingClass(ratings.get(section.instructor))}`}>
                    {' '}★{ratings.get(section.instructor)!.toFixed(1)}
                  </b>
                )}
              </div>
            )}
          </div>,
        );
      }
    }
    if (ghost) {
      for (const m of ghost.meetings) {
        if (!(m.days & dayMask)) continue;
        blocks.push(
          <div
            class="wdc-block wdc-block-ghost"
            style={{
              top: `${top(m.startMin)}px`,
              height: `${Math.max((m.endMin - m.startMin) * pxPerMin, 14)}px`,
            }}
          >
            <div>{ghost.courseCode}</div>
            <div class="wdc-block-time">
              {formatMinutes(m.startMin)}–{formatMinutes(m.endMin)}
            </div>
          </div>,
        );
      }
    }
    return blocks;
  };

  return (
    <div class="wdc-grid" style={{ '--wdc-days': days.length }}>
      <div>
        <div class="wdc-grid-daylabel">&nbsp;</div>
        <div class="wdc-grid-hours" style={{ height: `${totalHeight}px` }}>
          {hours.map((h) => (
            <span class="wdc-hour-label" style={{ top: `${top(h * 60)}px` }}>
              {h % 12 === 0 ? 12 : h % 12}
              {h >= 12 ? 'p' : 'a'}
            </span>
          ))}
        </div>
      </div>
      {days.map((d) => (
        <div class="wdc-grid-day">
          <div class="wdc-grid-daylabel">{d.label}</div>
          <div style={{ position: 'relative', height: `${totalHeight}px` }}>
            {hours.map((h) => (
              <div class="wdc-hour-line" style={{ top: `${top(h * 60)}px` }} />
            ))}
            {renderBlocks(d.mask)}
          </div>
        </div>
      ))}
    </div>
  );
}
