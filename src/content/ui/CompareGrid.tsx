/**
 * Two-person week grid for the friend-compare view: your classes on the left
 * half of each day column, the friend's on the right half, and green bands
 * behind everything where you're BOTH free — overlaps and mutual gaps are
 * visible at a glance instead of read from a list.
 */
import { useMemo } from 'preact/hooks';
import { DAYS, type DayMask, type Section } from '../../shared/types';
import { formatMinutes } from '../../shared/time';

const DAY_ORDER: Array<{ mask: DayMask; label: string }> = [
  { mask: DAYS.MON, label: 'Mon' },
  { mask: DAYS.TUE, label: 'Tue' },
  { mask: DAYS.WED, label: 'Wed' },
  { mask: DAYS.THU, label: 'Thu' },
  { mask: DAYS.FRI, label: 'Fri' },
  { mask: DAYS.SAT, label: 'Sat' },
  { mask: DAYS.SUN, label: 'Sun' },
];

const PX_PER_MIN = 0.72;

/** Merge overlapping [start,end] intervals (input need not be sorted). */
function mergeIntervals(list: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

export function CompareGrid({
  mine,
  friend,
  friendName,
}: {
  mine: Section[];
  friend: Section[];
  friendName: string;
}) {
  const all = useMemo(() => [...mine, ...friend], [mine, friend]);
  const showWeekend = all.some((s) => s.meetings.some((m) => m.days & (DAYS.SAT | DAYS.SUN)));
  const days = showWeekend ? DAY_ORDER : DAY_ORDER.slice(0, 5);

  const { startHour, endHour } = useMemo(() => {
    const meetings = all.flatMap((s) => s.meetings.filter((m) => m.days));
    if (meetings.length === 0) return { startHour: 8, endHour: 18 };
    return {
      startHour: Math.max(0, Math.floor(Math.min(...meetings.map((m) => m.startMin)) / 60) - 1),
      endHour: Math.min(24, Math.ceil(Math.max(...meetings.map((m) => m.endMin)) / 60) + 1),
    };
  }, [all]);

  const rangeStart = startHour * 60;
  const rangeEnd = endHour * 60;
  const totalHeight = (rangeEnd - rangeStart) * PX_PER_MIN;
  const top = (min: number) => (Math.min(Math.max(min, rangeStart), rangeEnd) - rangeStart) * PX_PER_MIN;

  const hours: number[] = [];
  for (let h = startHour; h <= endHour; h++) hours.push(h);

  const busyOf = (sections: Section[], mask: DayMask): Array<[number, number]> =>
    mergeIntervals(
      sections.flatMap((s) =>
        s.meetings.filter((m) => m.days & mask).map((m): [number, number] => [m.startMin, m.endMin]),
      ),
    );

  /** intervals inside the visible range where NEITHER has class */
  const bothFree = (mask: DayMask): Array<[number, number]> => {
    const busy = mergeIntervals([...busyOf(mine, mask), ...busyOf(friend, mask)]);
    const free: Array<[number, number]> = [];
    let cursor = rangeStart;
    for (const [s, e] of busy) {
      if (s > cursor) free.push([cursor, Math.min(s, rangeEnd)]);
      cursor = Math.max(cursor, e);
    }
    if (cursor < rangeEnd) free.push([cursor, rangeEnd]);
    return free.filter(([s, e]) => e - s >= 15); // ignore slivers
  };

  const personBlocks = (sections: Section[], mask: DayMask, side: 'mine' | 'friend') =>
    sections.flatMap((s) =>
      s.meetings
        .filter((m) => m.days & mask)
        .map((m) => (
          <div
            class={`wdc-cmp-block wdc-cmp-${side}`}
            style={{ top: `${top(m.startMin)}px`, height: `${Math.max((m.endMin - m.startMin) * PX_PER_MIN, 13)}px` }}
            title={`${side === 'mine' ? 'You' : friendName}: ${s.courseCode} ${formatMinutes(m.startMin)}–${formatMinutes(m.endMin)}`}
          >
            {s.courseCode}
          </div>
        )),
    );

  return (
    <div class="wdc-cmp">
      <div class="wdc-cmp-legend">
        <span class="wdc-cmp-key wdc-cmp-mine">You</span>
        <span class="wdc-cmp-key wdc-cmp-friend">{friendName}</span>
        <span class="wdc-cmp-key wdc-cmp-freekey">both free</span>
      </div>
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
              {bothFree(d.mask).map(([s, e]) => (
                <div
                  class="wdc-cmp-free"
                  style={{ top: `${top(s)}px`, height: `${(e - s) * PX_PER_MIN}px` }}
                  title={`Both free ${formatMinutes(s)}–${formatMinutes(e)}`}
                />
              ))}
              {personBlocks(mine, d.mask, 'mine')}
              {personBlocks(friend, d.mask, 'friend')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
