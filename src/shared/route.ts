/**
 * Between-class route math: building-name extraction from Workday location
 * strings, great-circle distance, and walk-time estimates used to warn when
 * the break between two classes is shorter than the walk between them.
 *
 * Distances are straight-line × a campus fudge factor (paths aren't straight),
 * so estimates are deliberately conservative-ish but honest about being
 * estimates — the UI always says "~".
 */
import { DAYS, type CampusBuilding, type DayMask, type Section } from './types';

/** Straight-line → real-path correction for campus walking. */
export const WALK_FUDGE = 1.3;
/** Default walking speed, km/h (≈3 mph). */
export const DEFAULT_WALK_KMH = 4.8;

/**
 * "Baker Hall 200", "Gates Hall Rm 114", "Statler Hall Room 196" → the
 * building part. Strips trailing room designators; returns the trimmed
 * original when stripping would leave nothing.
 */
export function buildingOf(location: string): string {
  let s = location.trim().replace(/\s+/g, ' ');
  // "Room 101" / "Rm. 12B" / "#12" designators
  s = s.replace(/\s*[,·-]?\s*\b(?:room|rm)\.?\s*\S+$/i, '');
  // trailing bare room number like "Baker Hall 200" or "Uris Hall 302B"
  s = s.replace(/\s+\d+[A-Za-z]?$/, '');
  s = s.replace(/[,·|-]\s*$/, '').trim();
  return s || location.trim();
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in meters. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Estimated minutes to walk `meters` (straight-line), fudge factor applied. */
export function walkMinutes(meters: number, speedKmh: number = DEFAULT_WALK_KMH): number {
  const metersPerMin = (speedKmh * 1000) / 60;
  return (meters * WALK_FUDGE) / metersPerMin;
}

export type TransitionRisk = 'ok' | 'tight' | 'miss' | 'unknown';

export interface Transition {
  dayMask: DayMask;
  dayLabel: string;
  fromCode: string;
  toCode: string;
  fromBuilding: string | null;
  toBuilding: string | null;
  /** minutes between the first class ending and the next starting */
  breakMin: number;
  /** estimated walk, or null when either building has no coordinates */
  walkMin: number | null;
  risk: TransitionRisk;
  /** identifies the arriving meeting so the calendar can badge its block */
  toKey: string;
}

export const DAY_LABELS: Array<{ mask: DayMask; label: string }> = [
  { mask: DAYS.MON, label: 'Mon' },
  { mask: DAYS.TUE, label: 'Tue' },
  { mask: DAYS.WED, label: 'Wed' },
  { mask: DAYS.THU, label: 'Thu' },
  { mask: DAYS.FRI, label: 'Fri' },
  { mask: DAYS.SAT, label: 'Sat' },
  { mask: DAYS.SUN, label: 'Sun' },
];

export function meetingKey(sectionId: string, dayMask: DayMask, startMin: number): string {
  return `${sectionId}|${dayMask}|${startMin}`;
}

/**
 * Every back-to-back pair of classes on each weekday, with break length,
 * estimated walk time between their buildings, and a risk verdict:
 *  - 'miss'    the walk is longer than the break
 *  - 'tight'   the walk eats 75%+ of the break
 *  - 'ok'      comfortable (or same building)
 *  - 'unknown' a building has no coordinates yet
 */
export function dayTransitions(
  sections: Section[],
  buildings: Record<string, CampusBuilding>,
  speedKmh: number = DEFAULT_WALK_KMH,
): Transition[] {
  const out: Transition[] = [];
  for (const { mask, label } of DAY_LABELS) {
    const events: Array<{ sectionId: string; code: string; startMin: number; endMin: number; location?: string }> = [];
    for (const s of sections) {
      for (const m of s.meetings) {
        if (m.days & mask) {
          events.push({ sectionId: s.sectionId, code: s.courseCode, startMin: m.startMin, endMin: m.endMin, location: m.location });
        }
      }
    }
    events.sort((a, b) => a.startMin - b.startMin);
    for (let i = 0; i + 1 < events.length; i++) {
      const cur = events[i]!;
      const next = events[i + 1]!;
      const breakMin = next.startMin - cur.endMin;
      if (breakMin < 0) continue; // overlapping classes are a conflict, not a route problem
      const fromB = cur.location ? buildingOf(cur.location) : null;
      const toB = next.location ? buildingOf(next.location) : null;
      let walkMin: number | null = null;
      let risk: TransitionRisk = 'unknown';
      if (fromB && toB && fromB.toLowerCase() === toB.toLowerCase()) {
        walkMin = 0;
        risk = 'ok';
      } else if (fromB && toB && buildings[fromB] && buildings[toB]) {
        walkMin = walkMinutes(haversineMeters(buildings[fromB]!, buildings[toB]!), speedKmh);
        risk = walkMin > breakMin ? 'miss' : walkMin > breakMin * 0.75 ? 'tight' : 'ok';
      }
      out.push({
        dayMask: mask,
        dayLabel: label,
        fromCode: cur.code,
        toCode: next.code,
        fromBuilding: fromB,
        toBuilding: toB,
        breakMin,
        walkMin,
        risk,
        toKey: meetingKey(next.sectionId, mask, next.startMin),
      });
    }
  }
  return out;
}
