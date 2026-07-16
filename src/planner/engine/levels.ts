/**
 * Level-up game: turns real academic progress into XP and an academic rank.
 * Only *finished* work earns XP — planned courses move requirement bars but
 * never the level, so the game can't be cheated by stacking a wishlist.
 *
 * XP sources (overlap courses pay per degree, on purpose — the game rewards
 * exactly the double-counting the planner teaches):
 *   +10  each unique completed course in academic history
 *   +40  each requirement group satisfied by completed work (per degree)
 *   +200 each degree fully satisfied by completed work
 */
import type { CourseStates, DegreeEvaluation } from './requirements';

export const XP_PER_COURSE = 10;
export const XP_PER_GROUP = 40;
export const XP_PER_DEGREE = 200;

export interface Rank {
  level: number;
  title: string;
  icon: string;
  /** cumulative XP needed to reach this level */
  at: number;
  /** UI accent color for this tier (kept in sync with the pl-lv-N CSS map) */
  accent: string;
}

// Early levels come fast (the hook); the last ones need a nearly finished
// double major. Tuned against ~10 XP/course, ~40/group, 200/degree.
export const RANKS: Rank[] = [
  { level: 1, title: 'Novice', icon: '🌱', at: 0, accent: '#64748b' },
  { level: 2, title: 'Apprentice', icon: '📖', at: 40, accent: '#0284c7' },
  { level: 3, title: 'Junior Scholar', icon: '✏️', at: 100, accent: '#0d9488' },
  { level: 4, title: 'Scholar', icon: '🎓', at: 180, accent: '#16a34a' },
  { level: 5, title: 'Senior Scholar', icon: '📜', at: 300, accent: '#7c3aed' },
  { level: 6, title: 'Honors Scholar', icon: '🏅', at: 460, accent: '#b45309' },
  { level: 7, title: "Dean's List", icon: '🏆', at: 680, accent: '#b45309' },
  { level: 8, title: 'Distinguished Scholar', icon: '💎', at: 980, accent: '#0369a1' },
  { level: 9, title: 'Valedictorian', icon: '👑', at: 1380, accent: '#7e22ce' },
  { level: 10, title: 'Academic Legend', icon: '🌟', at: 1900, accent: '#be185d' },
];

/**
 * The theme level the UI should wear: normally your real level; the owner
 * (admin unlock) can pin any rank's theme instead. Progress numbers always
 * stay real — a theme is a coat of paint, never a claim.
 */
export function effectiveThemeLevel(
  realLevel: number,
  settings: { admin?: boolean; themeLevel?: number },
): number {
  const pinned = settings.admin ? settings.themeLevel : undefined;
  return pinned && pinned >= 1 && pinned <= RANKS.length ? Math.floor(pinned) : realLevel;
}

export interface LevelInfo {
  xp: number;
  level: number;
  title: string;
  icon: string;
  /** next rank, or null at max level */
  next: Rank | null;
  /** 0–100 progress from the current rank's floor to the next one */
  pct: number;
  breakdown: {
    courses: number;
    groups: number;
    degrees: number;
    courseXp: number;
    groupXp: number;
    degreeXp: number;
  };
}

export function computeLevel(evaluations: DegreeEvaluation[], states: CourseStates): LevelInfo {
  const courses = states.completed.size;
  let groups = 0;
  let degreesDone = 0;
  for (const ev of evaluations) {
    const done = ev.groups.filter((g) => g.satisfiedByCompletedOnly).length;
    groups += done;
    if (ev.groups.length > 0 && done === ev.groups.length) degreesDone++;
  }
  const courseXp = courses * XP_PER_COURSE;
  const groupXp = groups * XP_PER_GROUP;
  const degreeXp = degreesDone * XP_PER_DEGREE;
  const xp = courseXp + groupXp + degreeXp;

  let rank = RANKS[0]!;
  for (const r of RANKS) if (xp >= r.at) rank = r;
  const next = RANKS.find((r) => r.level === rank.level + 1) ?? null;
  const pct = next ? Math.min(100, Math.round(((xp - rank.at) / (next.at - rank.at)) * 100)) : 100;

  return {
    xp,
    level: rank.level,
    title: rank.title,
    icon: rank.icon,
    next,
    pct,
    breakdown: { courses, groups, degrees: degreesDone, courseXp, groupXp, degreeXp },
  };
}
