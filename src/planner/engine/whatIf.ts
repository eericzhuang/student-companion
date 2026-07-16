/**
 * What-if evaluation: "if I took these courses, how would every degree's
 * progress change?" Pure sandbox math — runs the normal requirement engine on
 * hypothetical course states without touching stored data.
 */
import type { StoredDegree } from '../../shared/types';
import {
  courseState,
  evaluateDegree,
  normalizeCode,
  scopeReqOverrides,
  type CourseStates,
  type Equivalents,
  type GroupEvaluation,
} from './requirements';

export interface WhatIfGroupDelta {
  before: GroupEvaluation;
  after: GroupEvaluation;
  /** progress or satisfaction changed */
  changed: boolean;
  /** unmet before, satisfied with the tryout courses */
  newlySatisfied: boolean;
}

export interface WhatIfDegreeDelta {
  degree: StoredDegree;
  groups: WhatIfGroupDelta[];
  satisfiedBefore: number;
  satisfiedAfter: number;
}

export interface WhatIfResult {
  perDegree: WhatIfDegreeDelta[];
  /** normalized tryout code -> number of requirement groups it advances */
  courseImpact: Map<string, number>;
}

/** Course states with the tryout codes added as planned. */
export function statesWith(base: CourseStates, tryCodes: string[]): CourseStates {
  return {
    completed: base.completed,
    inProgress: base.inProgress,
    planned: new Set([...base.planned, ...tryCodes.map(normalizeCode)]),
  };
}

export function evaluateWhatIf(
  degrees: StoredDegree[],
  baseStates: CourseStates,
  tryCodes: string[],
  equivalents: Equivalents,
  reqOverridesAll: Parameters<typeof scopeReqOverrides>[0],
): WhatIfResult {
  const afterStates = statesWith(baseStates, tryCodes);
  const tryNorm = tryCodes.map(normalizeCode);
  const courseImpact = new Map<string, number>(tryNorm.map((c) => [c, 0]));

  const perDegree = degrees.map((degree) => {
    const overrides = scopeReqOverrides(reqOverridesAll, degree.id);
    const before = evaluateDegree(degree, baseStates, equivalents, overrides);
    const after = evaluateDegree(degree, afterStates, equivalents, overrides);
    const groups = before.groups.map((b, i) => {
      const a = after.groups[i]!;
      const changed = a.progress !== b.progress || a.satisfied !== b.satisfied;
      if (changed) {
        // Credit each tryout course that newly counts in this group (it, or an
        // equivalent of it, matches a course that had no state before).
        for (const c of b.group.courses) {
          if (courseState(c, baseStates, equivalents).state !== 'none') continue;
          const afterHit = courseState(c, afterStates, equivalents);
          if (afterHit.state === 'none') continue;
          const satisfyingCode = normalizeCode(afterHit.via ?? c.code);
          if (courseImpact.has(satisfyingCode)) {
            courseImpact.set(satisfyingCode, (courseImpact.get(satisfyingCode) ?? 0) + 1);
          }
        }
      }
      return { before: b, after: a, changed, newlySatisfied: !b.satisfied && a.satisfied };
    });
    return {
      degree,
      groups,
      satisfiedBefore: before.satisfiedGroups,
      satisfiedAfter: after.satisfiedGroups,
    };
  });

  return { perDegree, courseImpact };
}
