/**
 * Turns evaluated degree requirements into a concrete, non-chaotic scheduling
 * plan.
 *
 * The key fix over the old board: an unsatisfied "choose N" / "credits" group
 * lists many *options*, but only the shortfall actually needs scheduling. This
 * picks just enough courses per group (preferring cross-degree overlap and
 * prereq-light courses) and exposes the rest as electives to choose from,
 * instead of dumping every option onto the calendar.
 *
 * Also merges user-supplied prerequisite overrides into each course.
 */
import type { ReqOverrideValue, RequirementCourse, StoredDegree } from '../../shared/types';
import { evaluateDegree, normalizeCode, scopeReqOverrides, type CourseStates } from './requirements';
import { findOverlaps, requirementAppearances } from './overlap';

export interface ElectiveChoice {
  degreeName: string;
  groupTitle: string;
  /** courses (or credits) still needed from this group */
  needed: number;
  unit: 'courses' | 'credits';
  /** the ones this plan auto-picked to satisfy the shortfall */
  picked: RequirementCourse[];
  /** the remaining options the user could swap in instead */
  options: RequirementCourse[];
}

export interface SchedulingPlan {
  /** courses that must be scheduled (required + auto-picked electives), deduped */
  required: RequirementCourse[];
  electives: ElectiveChoice[];
  /** course code -> number of requirement groups it satisfies (>=2 = recommended) */
  requirementCount: Map<string, number>;
}

const DEFAULT_CREDITS = 3;

function withMergedPrereqs(
  course: RequirementCourse,
  overrides: Record<string, string[]>,
): RequirementCourse {
  const code = normalizeCode(course.code);
  const extra = (overrides[code] ?? []).map(normalizeCode);
  const set = new Set([...course.prereqCodes.map(normalizeCode), ...extra]);
  return { ...course, code, prereqCodes: [...set] };
}

export function buildSchedulingPlan(
  degrees: StoredDegree[],
  states: CourseStates,
  prereqOverrides: Record<string, string[]>,
  equivalents: Record<string, string[]> = {},
  reqOverrides: Record<string, ReqOverrideValue> = {},
): SchedulingPlan {
  const overlap = new Map(findOverlaps(degrees).map((o) => [o.code, o.appearsIn.size]));
  const reqCount = requirementAppearances(degrees);
  const required = new Map<string, RequirementCourse>();
  const electives: ElectiveChoice[] = [];

  // Recommend courses satisfying more requirements (and more degrees) first.
  const rank = (a: RequirementCourse, b: RequirementCourse) =>
    (reqCount.get(b.code) ?? 1) - (reqCount.get(a.code) ?? 1) ||
    (overlap.get(b.code) ?? 1) - (overlap.get(a.code) ?? 1) ||
    a.prereqCodes.length - b.prereqCodes.length ||
    a.code.localeCompare(b.code);

  for (const degree of degrees) {
    // Manual verdicts remove satisfied groups from scheduling entirely.
    const evaluation = evaluateDegree(degree, states, equivalents, scopeReqOverrides(reqOverrides, degree.id));
    for (const g of evaluation.groups) {
      if (g.satisfied) continue;
      const candidates = g.courses
        .filter((c) => c.state === 'none')
        .map((c) => withMergedPrereqs(c.course, prereqOverrides));

      if (g.group.rule.kind === 'all') {
        for (const c of candidates) required.set(c.code, c);
        continue;
      }

      // chooseN / credits: schedule only the shortfall, prefer overlap.
      const scored = [...candidates].sort(rank);
      const picked: RequirementCourse[] = [];
      if (g.group.rule.kind === 'chooseN') {
        const need = Math.max(0, g.required - g.progress);
        picked.push(...scored.slice(0, need));
      } else {
        let credits = g.progress;
        for (const c of scored) {
          if (credits >= g.required) break;
          picked.push(c);
          credits += c.credits ?? DEFAULT_CREDITS;
        }
      }
      for (const c of picked) required.set(c.code, c);
      electives.push({
        degreeName: degree.name,
        groupTitle: g.group.title,
        needed: Math.max(0, g.required - g.progress),
        unit: g.unit,
        picked,
        options: scored.filter((c) => !picked.includes(c)),
      });
    }
  }

  return { required: [...required.values()], electives, requirementCount: reqCount };
}
