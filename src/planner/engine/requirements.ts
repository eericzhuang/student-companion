/**
 * Degree-requirement evaluation: which groups are satisfied / in progress /
 * remaining given completed courses (academic history) and planned courses
 * (saved schedule + planner assignments).
 */
import type {
  DegreeProgram,
  HistoryCourse,
  ReqOverrideValue,
  RequirementCourse,
  RequirementGroup,
} from '../../shared/types';

export type CourseState = 'completed' | 'in-progress' | 'planned' | 'none';

export interface CourseEvaluation {
  course: RequirementCourse;
  state: CourseState;
  /** the code that satisfied it, when an equivalent/transfer course was used */
  via?: string;
}

export type Equivalents = Record<string, string[]>;

export interface GroupEvaluation {
  group: RequirementGroup;
  courses: CourseEvaluation[];
  /** how many courses (or credits) currently count, incl. planned */
  progress: number;
  required: number;
  satisfied: boolean;
  satisfiedByCompletedOnly: boolean;
  unit: 'courses' | 'credits';
  /** set when the student manually marked this group met/unmet */
  manual?: 'met' | 'unmet';
  /** set when the student manually entered a completed count for this group */
  manualDone?: number;
}

/** Manual per-group overrides, keyed by group title (already scoped to a degree). */
export type ReqOverrides = Record<string, ReqOverrideValue>;

/** Storage key for a manual requirement verdict. */
export function reqOverrideKey(degreeId: string, groupTitle: string): string {
  return `${degreeId}::${groupTitle}`;
}

/** Extract the title-keyed overrides for one degree from the global map. */
export function scopeReqOverrides(
  all: Record<string, ReqOverrideValue>,
  degreeId: string,
): ReqOverrides {
  const prefix = `${degreeId}::`;
  const out: ReqOverrides = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  }
  return out;
}

export interface DegreeEvaluation {
  degree: DegreeProgram;
  groups: GroupEvaluation[];
  satisfiedGroups: number;
  totalGroups: number;
  /** codes still needed (from unsatisfied groups) */
  remainingCourses: RequirementCourse[];
}

/** Normalize "CS-2110", "cs 2110", "CS2110" to "CS 2110" for comparison. */
export function normalizeCode(code: string): string {
  const m = code.toUpperCase().match(/([A-Z]{2,6})\s?-?\s?(\d{3,5}[A-Z]?)/);
  return m ? `${m[1]} ${m[2]}` : code.toUpperCase().trim();
}

export interface CourseStates {
  completed: Set<string>;
  inProgress: Set<string>;
  planned: Set<string>;
}

export function buildCourseStates(
  history: HistoryCourse[],
  scheduledCodes: string[],
  plannedCodes: string[],
): CourseStates {
  const completed = new Set<string>();
  const inProgress = new Set<string>();
  for (const c of history) {
    const code = normalizeCode(c.code);
    if (c.status === 'completed' && c.grade !== 'F' && c.grade !== 'W' && c.grade !== 'NP') {
      completed.add(code);
    } else if (c.status === 'in-progress') {
      inProgress.add(code);
    }
  }
  const planned = new Set<string>([...scheduledCodes, ...plannedCodes].map(normalizeCode));
  return { completed, inProgress, planned };
}

function stateOfCode(norm: string, states: CourseStates): CourseState {
  if (states.completed.has(norm)) return 'completed';
  if (states.inProgress.has(norm)) return 'in-progress';
  if (states.planned.has(norm)) return 'planned';
  return 'none';
}

export function stateOf(code: string, states: CourseStates): CourseState {
  return stateOfCode(normalizeCode(code), states);
}

/**
 * Evaluate a course, counting equivalent/transfer courses. Checks the course's
 * own code, its parsed equivalents, and any user-defined equivalents. Since
 * academic history already marks transfer/AP credit as completed, an AP or
 * transfer course listed as an equivalent will satisfy the requirement.
 */
export function courseState(
  course: RequirementCourse,
  states: CourseStates,
  equivalents: Equivalents = {},
): { state: CourseState; via?: string } {
  const primary = normalizeCode(course.code);
  const alts = [...(course.equivalents ?? []), ...(equivalents[primary] ?? [])].map(normalizeCode);
  const candidates = [primary, ...alts];

  // Prefer the strongest state (completed > in-progress > planned).
  const rank: Record<CourseState, number> = { completed: 3, 'in-progress': 2, planned: 1, none: 0 };
  let best: CourseState = 'none';
  let via: string | undefined;
  for (const cand of candidates) {
    const st = stateOfCode(cand, states);
    if (rank[st] > rank[best]) {
      best = st;
      via = cand === primary ? undefined : cand;
    }
  }
  return { state: best, via };
}

export function evaluateGroup(
  group: RequirementGroup,
  states: CourseStates,
  equivalents: Equivalents = {},
): GroupEvaluation {
  const courses = group.courses.map((course) => {
    const { state, via } = courseState(course, states, equivalents);
    return { course, state, via };
  });

  const counting = courses.filter((c) => c.state !== 'none');
  const completedOnly = courses.filter((c) => c.state === 'completed');

  let progress: number;
  let required: number;
  let unit: 'courses' | 'credits';
  let completedProgress: number;

  if (group.rule.kind === 'credits') {
    unit = 'credits';
    required = group.rule.credits ?? 0;
    progress = counting.reduce((sum, c) => sum + (c.course.credits ?? 3), 0);
    completedProgress = completedOnly.reduce((sum, c) => sum + (c.course.credits ?? 3), 0);
  } else if (group.rule.kind === 'chooseN') {
    unit = 'courses';
    required = group.rule.n ?? 1;
    progress = counting.length;
    completedProgress = completedOnly.length;
  } else {
    unit = 'courses';
    required = group.courses.length;
    progress = counting.length;
    completedProgress = completedOnly.length;
  }

  return {
    group,
    courses,
    progress: Math.min(progress, required),
    required,
    satisfied: progress >= required && required > 0,
    satisfiedByCompletedOnly: completedProgress >= required && required > 0,
    unit,
  };
}

export function evaluateDegree(
  degree: DegreeProgram,
  states: CourseStates,
  equivalents: Equivalents = {},
  reqOverrides: ReqOverrides = {},
): DegreeEvaluation {
  const groups = degree.groups.map((g) => {
    const ev = evaluateGroup(g, states, equivalents);
    // A manual verdict from the student beats the computed one — e.g. a
    // distribution requirement met by courses the extension can't see.
    const manual = reqOverrides[g.title];
    if (manual === 'met') {
      return { ...ev, satisfied: true, satisfiedByCompletedOnly: true, progress: ev.required, manual };
    }
    if (manual === 'unmet') {
      return { ...ev, satisfied: false, satisfiedByCompletedOnly: false, manual };
    }
    if (typeof manual === 'object' && manual !== null) {
      // "This many are already completed" — a floor, not a cap: if the
      // computed progress later grows past it, the larger value wins.
      const done = Math.max(0, Math.floor(manual.done));
      const progress = Math.min(Math.max(ev.progress, done), ev.required);
      return {
        ...ev,
        progress,
        satisfied: progress >= ev.required && ev.required > 0,
        // the student's count refers to finished work, so it counts as completed
        satisfiedByCompletedOnly:
          ev.satisfiedByCompletedOnly || (done >= ev.required && ev.required > 0),
        manualDone: done,
      };
    }
    return ev;
  });
  const remainingCourses: RequirementCourse[] = [];
  for (const g of groups) {
    if (g.satisfied) continue;
    for (const c of g.courses) {
      if (c.state === 'none') remainingCourses.push(c.course);
    }
  }
  return {
    degree,
    groups,
    satisfiedGroups: groups.filter((g) => g.satisfied).length,
    totalGroups: groups.length,
    remainingCourses,
  };
}
