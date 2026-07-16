/**
 * What-if tab (all plans): try hypothetical courses and see, before
 * registering, how every degree's progress would change. The tryout list is
 * saved in plannerState.whatIfCourses; nothing counts as real until the user
 * commits a course to the semester plan.
 */
import { useMemo, useState } from 'preact/hooks';
import type { PlannerState, StoredDegree, TermConfig } from '../shared/types';
import { sendToBackground } from '../background/messages';
import { normalizeCode, stateOf, type CourseStates } from './engine/requirements';
import { evaluateWhatIf } from './engine/whatIf';
import { requirementAppearances } from './engine/overlap';

interface Props {
  degrees: StoredDegree[];
  states: CourseStates;
  terms: TermConfig[];
  plannerState: PlannerState;
  courseEquivalents: Record<string, string[]>;
  reqOverrides: Parameters<typeof evaluateWhatIf>[4];
}

export function WhatIf({ degrees, states, terms, plannerState, courseEquivalents, reqOverrides }: Props) {
  const [input, setInput] = useState('');
  const tryCodes = plannerState.whatIfCourses ?? [];

  const save = (codes: string[]) =>
    void sendToBackground({
      kind: 'PLANNER_STATE_UPDATE',
      state: { ...plannerState, whatIfCourses: codes },
    });

  const add = () => {
    // Accept several at once: "CS 3410, MATH 2940" or newline-separated.
    const parts = input
      .split(/[,;\n]/)
      .map((s) => normalizeCode(s.trim()))
      .filter((s) => /^[A-Z]{2,6} \d{3,5}[A-Z]?$/.test(s));
    const next = [...tryCodes];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    if (next.length !== tryCodes.length) save(next);
    setInput('');
  };

  const remove = (code: string) => save(tryCodes.filter((c) => c !== code));

  // Commit: becomes a real planned course on the semester board.
  const commit = (code: string) => {
    const termId = terms[0]?.id;
    if (!termId) return;
    void sendToBackground({
      kind: 'PLANNER_STATE_UPDATE',
      state: {
        ...plannerState,
        assignments: { ...plannerState.assignments, [code]: termId },
        whatIfCourses: tryCodes.filter((c) => c !== code),
      },
    });
  };

  const result = useMemo(
    () => evaluateWhatIf(degrees, states, tryCodes, courseEquivalents, reqOverrides),
    [degrees, states, tryCodes, courseEquivalents, reqOverrides],
  );

  // Quick-add suggestions: untaken courses that appear in the most requirement
  // groups (the classic "take these first" double-counters).
  const suggestions = useMemo(() => {
    const counts = requirementAppearances(degrees);
    return [...counts.entries()]
      .filter(([code]) => stateOf(code, states) === 'none' && !tryCodes.includes(normalizeCode(code)))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([code, n]) => ({ code, n }));
  }, [degrees, states, tryCodes]);

  if (degrees.length === 0) {
    return (
      <div class="pl-card">
        <h2>🔮 What-if</h2>
        <p class="pl-muted">Add a degree first — then you can try courses and see how they'd move your progress.</p>
      </div>
    );
  }

  return (
    <>
      <div class="pl-card">
        <h2>🔮 What-if: try courses before you register</h2>
        <p class="pl-muted">
          Add courses you're <i>considering</i> — nothing here changes your real data. Every degree
          below shows how its progress <b>would</b> change. Like what you see? Send a course to your
          semester plan with one click.
        </p>
        <div class="pl-row">
          <input
            type="text"
            placeholder="e.g. CS 3410, MATH 2940"
            value={input}
            onInput={(e) => setInput((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button class="pl-btn" onClick={add} disabled={!input.trim()}>
            Try it
          </button>
        </div>

        {suggestions.length > 0 && (
          <p class="pl-muted" style={{ marginTop: '8px' }}>
            Worth trying (count toward the most requirements):{' '}
            {suggestions.map((s) => (
              <button class="pl-chip none pl-click" onClick={() => save([...tryCodes, normalizeCode(s.code)])} title={`Appears in ${s.n} requirement group(s)`}>
                + {s.code}
              </button>
            ))}
          </p>
        )}

        {tryCodes.length > 0 && (
          <div style={{ marginTop: '10px' }}>
            {tryCodes.map((code) => {
              const impact = result.courseImpact.get(code) ?? 0;
              return (
                <span class={`pl-whatif-chip${impact === 0 ? ' zero' : ''}`}>
                  {code}
                  <span class="pl-whatif-impact" title={impact === 0 ? 'This course would not advance any requirement — check the code, or it may already be counted' : `Advances ${impact} requirement group(s)`}>
                    {impact === 0 ? '⚠ no effect' : `+${impact} req${impact === 1 ? '' : 's'}`}
                  </span>
                  {terms[0] && impact > 0 && (
                    <button class="pl-whatif-commit" title={`Add to your real plan (${terms[0].label} on the Semester board)`} onClick={() => commit(code)}>
                      → plan
                    </button>
                  )}
                  <button class="pl-whatif-x" title="Remove from tryout" onClick={() => remove(code)}>
                    ✕
                  </button>
                </span>
              );
            })}
            <button class="pl-link-inline" style={{ marginLeft: '6px' }} onClick={() => save([])}>
              clear all
            </button>
          </div>
        )}
      </div>

      {tryCodes.length === 0 ? (
        <div class="pl-card">
          <p class="pl-muted">Your tryout list is empty — add a course above to see its impact.</p>
        </div>
      ) : (
        result.perDegree.map(({ degree, groups, satisfiedBefore, satisfiedAfter }) => {
          const anyChange = groups.some((g) => g.changed);
          return (
            <div class="pl-card">
              <div class="pl-row">
                <h2>
                  {degree.name} <span class="pl-degree-tag">{degree.type}</span>
                </h2>
                <span class="pl-muted">
                  {satisfiedBefore}
                  {satisfiedAfter !== satisfiedBefore && <b class="pl-whatif-arrow"> → {satisfiedAfter}</b>}/
                  {groups.length} groups satisfied
                </span>
              </div>
              {!anyChange && <p class="pl-muted">No change — none of the tryout courses count toward this program.</p>}
              {groups.map(({ before, after, changed, newlySatisfied }) => (
                <div class={`pl-group${newlySatisfied ? ' pl-whatif-won' : ''}`}>
                  <div class="pl-group-title">
                    <span>
                      {after.satisfied ? '✅' : after.progress > 0 ? '🕐' : '⭕'} {before.group.title}
                      {newlySatisfied && <span class="pl-manual-tag pl-whatif-tag">would be satisfied! 🎉</span>}
                    </span>
                    <span class="pl-muted">
                      {before.progress}
                      {changed && <b class="pl-whatif-arrow"> → {after.progress}</b>}/{before.required} {before.unit}
                    </span>
                  </div>
                  <div class="pl-progressbar pl-whatif-bar">
                    <div style={{ width: `${before.required ? Math.min(100, (before.progress / before.required) * 100) : 0}%` }} />
                    {changed && (
                      <div
                        class="pl-whatif-delta"
                        style={{
                          left: `${before.required ? Math.min(100, (before.progress / before.required) * 100) : 0}%`,
                          width: `${before.required ? Math.min(100, ((after.progress - before.progress) / before.required) * 100) : 0}%`,
                        }}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        })
      )}
    </>
  );
}
