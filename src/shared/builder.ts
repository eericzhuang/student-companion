/**
 * Auto schedule builder: enumerate conflict-free combinations of candidate
 * sections (one per course) on top of the locked schedule, then rank them by
 * the user's preference weights — mornings avoided, compact days, professor
 * ratings, and walking distance. Pure and synchronous; the UI supplies the
 * ratings map and building coordinates.
 */
import type { BuilderPrefs, CampusBuilding, Section } from './types';
import { sectionsConflict } from './time';
import { dayTransitions } from './route';

export const DEFAULT_PREFS: BuilderPrefs = { morning: 1, compact: 1, ratings: 1, walking: 1 };

export interface BuildContext {
  ratings: Map<string, number | null>;
  buildings: Record<string, CampusBuilding>;
  walkSpeedKmh: number;
}

export interface ScoreParts {
  /** minutes of class before the earliest-OK time, per week */
  earlyMin: number;
  /** total gap minutes between classes, per week */
  gapMin: number;
  /** average professor rating over rated instructors, or null */
  avgRating: number | null;
  /** total walking minutes per week, or null when no building is located */
  walkMin: number | null;
}

export interface BuiltSchedule {
  /** locked + chosen, ready to preview or save */
  sections: Section[];
  /** just the candidate sections this combo picked */
  chosen: Section[];
  score: number;
  parts: ScoreParts;
}

export interface BuildResult {
  results: BuiltSchedule[];
  /** distinct courses among usable candidates */
  courses: number;
  /** complete conflict-free combos found (before top-N cut) */
  combosFound: number;
  /** true when the search hit the exploration cap */
  truncated: boolean;
  /** candidate courses skipped because the course is already on the schedule */
  skippedLocked: string[];
}

export function scoreParts(sections: Section[], ctx: BuildContext, earliestOk: number): ScoreParts {
  let earlyMin = 0;
  for (const s of sections) {
    for (const m of s.meetings) {
      if (!m.days) continue;
      const days = countBits(m.days);
      earlyMin += Math.max(0, earliestOk - m.startMin) * days;
    }
  }
  const transitions = dayTransitions(sections, ctx.buildings, ctx.walkSpeedKmh);
  const gapMin = transitions.reduce((sum, t) => sum + t.breakMin, 0);
  const known = transitions.filter((t) => t.walkMin != null);
  const walkMin = known.length > 0 ? known.reduce((s, t) => s + (t.walkMin ?? 0), 0) : null;

  const rated = sections
    .map((s) => (s.instructor ? ctx.ratings.get(s.instructor) : null))
    .filter((r): r is number => r != null);
  const avgRating = rated.length > 0 ? rated.reduce((a, b) => a + b, 0) / rated.length : null;

  return { earlyMin, gapMin, avgRating, walkMin };
}

function countBits(mask: number): number {
  let n = 0;
  for (let m = mask; m; m >>= 1) n += m & 1;
  return n;
}

/** Higher is better. Each signal is normalized to roughly 0..1 before weighting. */
export function scoreSchedule(parts: ScoreParts, prefs: BuilderPrefs): number {
  let score = 0;
  score -= prefs.morning * Math.min(1, parts.earlyMin / 300);
  score -= prefs.compact * Math.min(1, parts.gapMin / 600);
  if (parts.avgRating != null) score += prefs.ratings * ((parts.avgRating - 2.5) / 2.5);
  if (parts.walkMin != null) score -= prefs.walking * Math.min(1, parts.walkMin / 120);
  return score;
}

export function generateSchedules(
  locked: Section[],
  candidates: Section[],
  prefs: BuilderPrefs,
  ctx: BuildContext,
  opts: { maxExplored?: number; maxResults?: number } = {},
): BuildResult {
  const maxExplored = opts.maxExplored ?? 5000;
  const maxResults = opts.maxResults ?? 10;
  const earliestOk = prefs.earliestOk ?? 540;

  const lockedCodes = new Set(locked.map((s) => s.courseCode));
  const skippedLocked = [...new Set(candidates.filter((c) => lockedCodes.has(c.courseCode)).map((c) => c.courseCode))];
  const usable = candidates.filter((c) => !lockedCodes.has(c.courseCode) && c.meetings.length > 0);

  // group by course, one section must be picked per group
  const groups = new Map<string, Section[]>();
  for (const c of usable) {
    const g = groups.get(c.courseCode);
    if (g) g.push(c);
    else groups.set(c.courseCode, [c]);
  }
  const groupList = [...groups.values()];

  const results: BuiltSchedule[] = [];
  let explored = 0;
  let combosFound = 0;
  let truncated = false;

  const pick: Section[] = [];
  const dfs = (gi: number): void => {
    if (truncated) return;
    if (gi === groupList.length) {
      combosFound++;
      const sections = [...locked, ...pick];
      const parts = scoreParts(sections, ctx, earliestOk);
      results.push({ sections, chosen: [...pick], score: scoreSchedule(parts, prefs), parts });
      return;
    }
    for (const cand of groupList[gi]!) {
      if (++explored > maxExplored) {
        truncated = true;
        return;
      }
      const clash =
        locked.some((s) => sectionsConflict(s, cand)) || pick.some((s) => sectionsConflict(s, cand));
      if (clash) continue;
      pick.push(cand);
      dfs(gi + 1);
      pick.pop();
    }
  };
  if (groupList.length > 0) dfs(0);

  results.sort((a, b) => b.score - a.score);
  return {
    results: results.slice(0, maxResults),
    courses: groupList.length,
    combosFound,
    truncated,
    skippedLocked,
  };
}
