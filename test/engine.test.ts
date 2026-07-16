import { describe, expect, it } from 'vitest';
import {
  buildCourseStates,
  evaluateDegree,
  evaluateGroup,
  normalizeCode,
} from '../src/planner/engine/requirements';
import { findOverlaps, groupOverlapsByCombo } from '../src/planner/engine/overlap';
import { evaluateWhatIf } from '../src/planner/engine/whatIf';
import { suggestSchedule } from '../src/planner/engine/scheduleSuggest';
import { buildSchedulingPlan } from '../src/planner/engine/plan';
import type { DegreeProgram, HistoryCourse, StoredDegree, TermConfig } from '../src/shared/types';

const hist = (code: string, grade: string | null = 'A'): HistoryCourse => ({
  code,
  title: code,
  credits: 3,
  grade,
  term: 'Fall 2025',
  status: grade ? 'completed' : 'in-progress',
});

const course = (code: string, prereqs: string[] = [], credits = 3) => ({
  code,
  title: code,
  credits,
  prereqCodes: prereqs,
});

describe('normalizeCode', () => {
  it('normalizes variants', () => {
    expect(normalizeCode('cs 2110')).toBe('CS 2110');
    expect(normalizeCode('CS-2110')).toBe('CS 2110');
    expect(normalizeCode('CS2110')).toBe('CS 2110');
  });
});

describe('course equivalents (incl. transfer/AP)', () => {
  const req = (code: string, equivalents: string[] = []) => ({
    code,
    title: code,
    credits: 3,
    prereqCodes: [],
    equivalents,
  });

  it('counts a parsed equivalent completed in history', () => {
    // Required MATH 1910, but the student has transfer credit MATH 1220 (grade TR).
    const states = buildCourseStates(
      [{ code: 'MATH 1220', title: 'Transfer Calc', credits: 4, grade: 'TR', term: null, status: 'completed' }],
      [],
      [],
    );
    const g = evaluateGroup(
      { title: 'Math', rule: { kind: 'all' }, courses: [req('MATH 1910', ['MATH 1220'])], notes: null },
      states,
    );
    expect(g.satisfied).toBe(true);
    expect(g.courses[0]!.state).toBe('completed');
    expect(g.courses[0]!.via).toBe('MATH 1220');
  });

  it('counts a user-defined (global) equivalent', () => {
    const states = buildCourseStates([hist('APCALC 1000')], [], []);
    const g = evaluateGroup(
      { title: 'Math', rule: { kind: 'all' }, courses: [req('MATH 1910')], notes: null },
      states,
      { 'MATH 1910': ['APCALC 1000'] },
    );
    expect(g.satisfied).toBe(true);
    expect(g.courses[0]!.via).toBe('APCALC 1000');
  });

  it('AP/transfer grades in history count as completed', () => {
    const states = buildCourseStates(
      [{ code: 'CHEM 2070', title: 'Gen Chem', credits: 4, grade: 'CR', term: null, status: 'completed' }],
      [],
      [],
    );
    const g = evaluateGroup(
      { title: 'Science', rule: { kind: 'all' }, courses: [req('CHEM 2070')], notes: null },
      states,
    );
    expect(g.satisfied).toBe(true);
  });
});

describe('evaluateGroup', () => {
  const states = buildCourseStates([hist('CS 1110'), hist('CS 2110')], ['CS 3110'], ['CS 4820']);

  it('evaluates "all" groups', () => {
    const g = evaluateGroup(
      {
        title: 'Core',
        rule: { kind: 'all' },
        courses: [course('CS 1110'), course('CS 2110'), course('CS 9999')],
        notes: null,
      },
      states,
    );
    expect(g.progress).toBe(2);
    expect(g.required).toBe(3);
    expect(g.satisfied).toBe(false);
  });

  it('evaluates chooseN with planned counting', () => {
    const g = evaluateGroup(
      {
        title: 'Electives',
        rule: { kind: 'chooseN', n: 2 },
        courses: [course('CS 3110'), course('CS 4820'), course('CS 5555')],
        notes: null,
      },
      states,
    );
    expect(g.satisfied).toBe(true); // scheduled + planned
    expect(g.satisfiedByCompletedOnly).toBe(false);
  });

  it('evaluates credit rules', () => {
    const g = evaluateGroup(
      {
        title: 'Breadth',
        rule: { kind: 'credits', credits: 6 },
        courses: [course('CS 1110', [], 4), course('CS 2110', [], 3), course('CS 7777', [], 3)],
        notes: null,
      },
      states,
    );
    expect(g.satisfied).toBe(true); // 4 + 3 = 7 >= 6
  });

  it('failed/withdrawn courses do not count', () => {
    const failed = buildCourseStates([hist('CS 1110', 'F'), hist('CS 2110', 'W')], [], []);
    const g = evaluateGroup(
      { title: 'Core', rule: { kind: 'all' }, courses: [course('CS 1110')], notes: null },
      failed,
    );
    expect(g.satisfied).toBe(false);
  });
});

describe('evaluateDegree', () => {
  it('collects remaining courses from unsatisfied groups only', () => {
    const degree: DegreeProgram = {
      name: 'CS BS',
      type: 'major',
      totalCredits: 120,
      groups: [
        { title: 'Done', rule: { kind: 'all' }, courses: [course('CS 1110')], notes: null },
        {
          title: 'Todo',
          rule: { kind: 'all' },
          courses: [course('CS 4410'), course('CS 4820')],
          notes: null,
        },
      ],
    };
    const states = buildCourseStates([hist('CS 1110')], [], []);
    const ev = evaluateDegree(degree, states);
    expect(ev.satisfiedGroups).toBe(1);
    expect(ev.remainingCourses.map((c) => c.code)).toEqual(['CS 4410', 'CS 4820']);
  });

  it('a manual done-count raises progress and can satisfy a group', () => {
    const degree: DegreeProgram = {
      name: 'CS BS',
      type: 'major',
      totalCredits: 120,
      groups: [
        {
          title: 'Electives',
          rule: { kind: 'chooseN', n: 3 },
          courses: [course('CS 4700'), course('CS 4780'), course('CS 4820'), course('CS 5430')],
          notes: null,
        },
      ],
    };
    const states = buildCourseStates([hist('CS 4700')], [], []);

    // computed progress is 1; the student says 2 are actually done
    const partial = evaluateDegree(degree, states, {}, { Electives: { done: 2 } }).groups[0]!;
    expect(partial.progress).toBe(2);
    expect(partial.satisfied).toBe(false);
    expect(partial.manualDone).toBe(2);

    // done >= required satisfies the group, and counts as completed credit
    const full = evaluateDegree(degree, states, {}, { Electives: { done: 3 } }).groups[0]!;
    expect(full.satisfied).toBe(true);
    expect(full.satisfiedByCompletedOnly).toBe(true);
  });

  it('a manual done-count is a floor, not a cap', () => {
    const degree: DegreeProgram = {
      name: 'CS BS',
      type: 'major',
      totalCredits: 120,
      groups: [
        {
          title: 'Core',
          rule: { kind: 'chooseN', n: 3 },
          courses: [course('CS 3110'), course('CS 3410'), course('CS 4410')],
          notes: null,
        },
      ],
    };
    // two courses actually completed, but the student only claimed 1 done
    const states = buildCourseStates([hist('CS 3110'), hist('CS 3410')], [], []);
    const g = evaluateDegree(degree, states, {}, { Core: { done: 1 } }).groups[0]!;
    expect(g.progress).toBe(2); // the larger computed value wins
    expect(g.manualDone).toBe(1);
  });
});

describe('evaluateWhatIf', () => {
  const mk = (id: string, groups: DegreeProgram['groups']): StoredDegree => ({
    id,
    name: id,
    type: 'major',
    totalCredits: null,
    sourceUrl: null,
    parsedAt: 0,
    userEdited: false,
    groups,
  });
  const cs = mk('cs', [
    { title: 'Core', rule: { kind: 'all' }, courses: [course('CS 1110'), course('CS 3410')], notes: null },
    { title: 'Math', rule: { kind: 'chooseN', n: 1 }, courses: [course('MATH 2940')], notes: null },
  ]);
  const ds = mk('ds', [
    { title: 'Foundations', rule: { kind: 'all' }, courses: [course('MATH 2940')], notes: null },
  ]);

  it('shows before→after deltas and newly-satisfied groups without mutating base states', () => {
    const states = buildCourseStates([hist('CS 1110')], [], []);
    const r = evaluateWhatIf([cs, ds], states, ['CS 3410', 'MATH 2940'], {}, {});
    const core = r.perDegree[0]!.groups[0]!;
    expect(core.before.progress).toBe(1);
    expect(core.after.progress).toBe(2);
    expect(core.newlySatisfied).toBe(true);
    // the same tryout course satisfies both degrees' math groups
    expect(r.perDegree[0]!.satisfiedAfter).toBe(2);
    expect(r.perDegree[1]!.groups[0]!.newlySatisfied).toBe(true);
    // base states untouched (sandbox)
    expect(states.planned.has('CS 3410')).toBe(false);
  });

  it('counts per-course impact across degrees; useless courses read 0', () => {
    const states = buildCourseStates([hist('CS 1110')], [], []);
    const r = evaluateWhatIf([cs, ds], states, ['MATH 2940', 'BIO 9999'], {}, {});
    expect(r.courseImpact.get('MATH 2940')).toBe(2); // cs Math + ds Foundations
    expect(r.courseImpact.get('BIO 9999')).toBe(0); // appears nowhere
  });

  it('a tryout course already completed adds nothing', () => {
    const states = buildCourseStates([hist('CS 1110')], [], []);
    const r = evaluateWhatIf([cs], states, ['CS 1110'], {}, {});
    expect(r.courseImpact.get('CS 1110')).toBe(0);
    expect(r.perDegree[0]!.groups[0]!.changed).toBe(false);
  });

  it('credits an equivalent tryout course to the requirement it satisfies', () => {
    const eq = mk('eq', [
      {
        title: 'Calc',
        rule: { kind: 'all' },
        courses: [{ ...course('MATH 1910'), equivalents: ['MATH 1220'] }],
        notes: null,
      },
    ]);
    const states = buildCourseStates([], [], []);
    const r = evaluateWhatIf([eq], states, ['MATH 1220'], {}, {});
    expect(r.perDegree[0]!.groups[0]!.after.progress).toBe(1);
    expect(r.courseImpact.get('MATH 1220')).toBe(1);
  });
});

describe('findOverlaps', () => {
  it('finds courses shared by 2+ degrees', () => {
    const mk = (id: string, codes: string[]): StoredDegree => ({
      id,
      name: id,
      type: 'major',
      totalCredits: null,
      sourceUrl: null,
      parsedAt: 0,
      userEdited: false,
      groups: [
        { title: 'g', rule: { kind: 'all' }, courses: codes.map((c) => course(c)), notes: null },
      ],
    });
    const overlaps = findOverlaps([
      mk('a', ['MATH 1910', 'CS 1110']),
      mk('b', ['MATH 1910', 'ECON 1110']),
      mk('c', ['MATH 1910']),
    ]);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.code).toBe('MATH 1910');
    expect(overlaps[0]!.appearsIn.size).toBe(3);
  });

  it('groups overlaps by exact degree combination, all-N first', () => {
    const mk = (id: string, codes: string[]): StoredDegree => ({
      id,
      name: id,
      type: 'major',
      totalCredits: null,
      sourceUrl: null,
      parsedAt: 0,
      userEdited: false,
      groups: [
        { title: 'g', rule: { kind: 'all' }, courses: codes.map((c) => course(c)), notes: null },
      ],
    });
    // MATH 1910 shared by all three; CS 1110 by a+b; ECON 1110 by b+c
    const combos = groupOverlapsByCombo(
      findOverlaps([
        mk('a', ['MATH 1910', 'CS 1110']),
        mk('b', ['MATH 1910', 'CS 1110', 'ECON 1110']),
        mk('c', ['MATH 1910', 'ECON 1110']),
      ]),
    );
    expect(combos).toHaveLength(3);
    expect(combos[0]!.degreeIds).toEqual(['a', 'b', 'c']); // largest combo first
    expect(combos[0]!.entries.map((e) => e.code)).toEqual(['MATH 1910']);
    expect(combos.slice(1).map((c) => c.degreeIds)).toEqual([['a', 'b'], ['b', 'c']]);
    expect(combos[1]!.entries.map((e) => e.code)).toEqual(['CS 1110']);
    expect(combos[2]!.entries.map((e) => e.code)).toEqual(['ECON 1110']);
    // no course listed twice across sections
    const all = combos.flatMap((c) => c.entries.map((e) => e.code));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('buildSchedulingPlan', () => {
  const degree = (id: string, groups: DegreeProgram['groups']): StoredDegree => ({
    id,
    name: id,
    type: 'major',
    totalCredits: null,
    sourceUrl: null,
    parsedAt: 0,
    userEdited: false,
    groups,
  });

  it('schedules only the shortfall of a choose-N group, not every option', () => {
    const d = degree('cs', [
      {
        title: 'Electives (choose 2)',
        rule: { kind: 'chooseN', n: 2 },
        courses: [course('CS 4700'), course('CS 4780'), course('CS 4820'), course('CS 5430')],
        notes: null,
      },
    ]);
    const states = buildCourseStates([], [], []);
    const plan = buildSchedulingPlan([d], states, {});
    // Only 2 required (not all 4); the rest are options.
    expect(plan.required).toHaveLength(2);
    expect(plan.electives).toHaveLength(1);
    expect(plan.electives[0]!.picked).toHaveLength(2);
    expect(plan.electives[0]!.options).toHaveLength(2);
    expect(plan.electives[0]!.needed).toBe(2);
  });

  it('counts already-taken options toward a choose-N group', () => {
    const d = degree('cs', [
      {
        title: 'Electives (choose 2)',
        rule: { kind: 'chooseN', n: 2 },
        courses: [course('CS 4700'), course('CS 4780'), course('CS 4820')],
        notes: null,
      },
    ]);
    const states = buildCourseStates([hist('CS 4700')], [], []);
    const plan = buildSchedulingPlan([d], states, {});
    expect(plan.required).toHaveLength(1); // only 1 more needed
    expect(plan.electives[0]!.needed).toBe(1);
  });

  it('requires every course in an "all" group', () => {
    const d = degree('cs', [
      { title: 'Core', rule: { kind: 'all' }, courses: [course('CS 2110'), course('CS 3110')], notes: null },
    ]);
    const plan = buildSchedulingPlan([d], buildCourseStates([], [], []), {});
    expect(plan.required.map((c) => c.code).sort()).toEqual(['CS 2110', 'CS 3110']);
    expect(plan.electives).toHaveLength(0);
  });

  it('merges manual prerequisite overrides into required courses', () => {
    const d = degree('cs', [
      { title: 'Core', rule: { kind: 'all' }, courses: [course('CS 4410')], notes: null },
    ]);
    const plan = buildSchedulingPlan([d], buildCourseStates([], [], []), { 'CS 4410': ['CS 3410'] });
    expect(plan.required[0]!.prereqCodes).toContain('CS 3410');
  });

  it('counts multi-requirement courses and picks them first (recommended)', () => {
    // MATH 1920 appears in a required group of both degrees -> counts toward 2.
    const a = degree('a', [
      { title: 'Math', rule: { kind: 'all' }, courses: [course('MATH 1920')], notes: null },
    ]);
    const b = degree('b', [
      { title: 'Quant', rule: { kind: 'all' }, courses: [course('MATH 1920')], notes: null },
      {
        title: 'Electives (choose 1)',
        rule: { kind: 'chooseN', n: 1 },
        courses: [course('ECON 3000'), course('MATH 1920')],
        notes: null,
      },
    ]);
    const plan = buildSchedulingPlan([a, b], buildCourseStates([], [], []), {});
    expect(plan.requirementCount.get('MATH 1920')).toBeGreaterThanOrEqual(2);
    // The elective auto-pick prefers the multi-requirement course.
    const elective = plan.electives.find((e) => e.groupTitle.includes('Electives'));
    expect(elective?.picked[0]!.code).toBe('MATH 1920');
  });
});

describe('suggestSchedule', () => {
  const terms: TermConfig[] = [
    { id: 't1', label: 'Fall 2026', creditCap: 6 },
    { id: 't2', label: 'Spring 2027', creditCap: 6 },
  ];

  it('respects prerequisites across terms', () => {
    const remaining = [course('CS 4820', ['CS 2110']), course('CS 2110')];
    const sugg = suggestSchedule(remaining, new Set(), terms, () => 1);
    const t1 = sugg.terms[0]!.courses.map((c) => c.code);
    const t2 = sugg.terms[1]!.courses.map((c) => c.code);
    expect(t1).toContain('CS 2110');
    expect(t2).toContain('CS 4820');
  });

  it('respects credit caps', () => {
    const tightTerms: TermConfig[] = [
      { id: 't1', label: 'Fall 2026', creditCap: 3 },
      { id: 't2', label: 'Spring 2027', creditCap: 3 },
    ];
    const remaining = [course('A 1000'), course('B 1000'), course('C 1000')];
    const sugg = suggestSchedule(remaining, new Set(), tightTerms, () => 1);
    expect(sugg.terms[0]!.credits).toBeLessThanOrEqual(3);
    expect(sugg.terms[1]!.credits).toBeLessThanOrEqual(3);
    expect(sugg.unplaced).toHaveLength(1);
  });

  it('prefers multi-degree overlap courses', () => {
    const remaining = [course('SOLO 1000'), course('SHARED 1000')];
    const oneTerm: TermConfig[] = [{ id: 't1', label: 'F', creditCap: 3 }];
    const sugg = suggestSchedule(remaining, new Set(), oneTerm, (code) =>
      code.startsWith('SHARED') ? 2 : 1,
    );
    expect(sugg.terms[0]!.courses[0]!.code).toBe('SHARED 1000');
  });

  it('does not block on prereqs already completed or untracked', () => {
    const remaining = [course('CS 3110', ['CS 2110', 'MATH 9999'])];
    const sugg = suggestSchedule(remaining, new Set(['CS 2110']), terms, () => 1);
    expect(sugg.terms[0]!.courses.map((c) => c.code)).toContain('CS 3110');
  });

  it('flags circular prerequisites', () => {
    const remaining = [course('A 1000', ['B 1000']), course('B 1000', ['A 1000'])];
    const sugg = suggestSchedule(remaining, new Set(), terms, () => 1);
    expect(sugg.unplaced).toHaveLength(2);
    expect(sugg.cyclic.sort()).toEqual(['A 1000', 'B 1000']);
  });
});

describe('manual requirement verdicts (reqOverrides)', () => {
  const degree: StoredDegree = {
    id: 'deg-1',
    name: 'Test Major',
    type: 'major',
    totalCredits: null,
    sourceUrl: null,
    parsedAt: 0,
    userEdited: false,
    groups: [
      { title: 'Core', rule: { kind: 'all' }, courses: [course('CS 1000')], notes: null },
      { title: 'Natural Science', rule: { kind: 'credits', credits: 9 }, courses: [], notes: '9 credits of any natural science' },
    ],
  };
  const states = buildCourseStates([hist('CS 1000')], [], []);

  it('marking met overrides the computed unsatisfied state', () => {
    const ev = evaluateDegree(degree, states, {}, { 'Natural Science': 'met' });
    const ns = ev.groups.find((g) => g.group.title === 'Natural Science')!;
    expect(ns.satisfied).toBe(true);
    expect(ns.manual).toBe('met');
    expect(ns.progress).toBe(ns.required);
  });

  it('marking unmet overrides the computed satisfied state', () => {
    const ev = evaluateDegree(degree, states, {}, { Core: 'unmet' });
    const core = ev.groups.find((g) => g.group.title === 'Core')!;
    expect(core.satisfied).toBe(false);
    expect(core.manual).toBe('unmet');
  });

  it('met groups drop out of the scheduling plan', () => {
    const d2: StoredDegree = {
      ...degree,
      groups: [{ title: 'Electives', rule: { kind: 'chooseN', n: 1 }, courses: [course('EL 2000')], notes: null }],
    };
    const withPlan = buildSchedulingPlan([d2], states, {}, {}, {});
    expect(withPlan.required.map((c) => c.code)).toContain('EL 2000');
    const overridden = buildSchedulingPlan([d2], states, {}, {}, { 'deg-1::Electives': 'met' });
    expect(overridden.required.map((c) => c.code)).not.toContain('EL 2000');
  });
});
