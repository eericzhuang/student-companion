/**
 * Comparison metrics for saved schedule scenarios (Plan A vs Plan B):
 * credits, average professor rating, earliest class, and daily walking.
 */
import type { CampusBuilding, Section } from './types';
import { dayTransitions } from './route';
import { formatMinutes } from './time';

export interface ScenarioMetrics {
  sections: number;
  /** sum of known section credits (null credits skipped) */
  credits: number;
  /** average RMP rating across instructors with a rating, or null */
  avgRating: number | null;
  /** earliest class start as "9:05 AM", or null with no meetings */
  earliest: string | null;
  /** total walking minutes across the whole week, or null when unknown */
  walkMinPerWeek: number | null;
  /** number of transitions at risk (tight or miss) */
  riskyLegs: number;
}

export function scenarioMetrics(
  sections: Section[],
  ratings: Map<string, number | null>,
  buildings: Record<string, CampusBuilding>,
  walkSpeedKmh: number,
): ScenarioMetrics {
  const credits = sections.reduce((sum, s) => sum + (s.credits ?? 0), 0);

  const rated = sections
    .map((s) => (s.instructor ? ratings.get(s.instructor) : null))
    .filter((r): r is number => r != null);
  const avgRating = rated.length > 0 ? rated.reduce((a, b) => a + b, 0) / rated.length : null;

  const starts = sections.flatMap((s) => s.meetings.filter((m) => m.days).map((m) => m.startMin));
  const earliest = starts.length > 0 ? formatMinutes(Math.min(...starts)) : null;

  const transitions = dayTransitions(sections, buildings, walkSpeedKmh);
  const known = transitions.filter((t) => t.walkMin != null);
  const walkMinPerWeek =
    known.length > 0 ? known.reduce((sum, t) => sum + (t.walkMin ?? 0), 0) : null;
  const riskyLegs = transitions.filter((t) => t.risk === 'tight' || t.risk === 'miss').length;

  return { sections: sections.length, credits, avgRating, earliest, walkMinPerWeek, riskyLegs };
}
