/**
 * Semester-by-semester board: auto-suggested layout of remaining courses with
 * drag-between-terms manual overrides (persisted in plannerState.assignments).
 */
import { useMemo, useState } from 'preact/hooks';
import type { PlannerState, ReqOverrideValue, RequirementCourse, StoredDegree, TermConfig } from '../shared/types';
import { sendToBackground } from '../background/messages';
import { evaluateDegree, normalizeCode, scopeReqOverrides, type CourseStates } from './engine/requirements';
import { findOverlaps } from './engine/overlap';
import { buildSchedulingPlan } from './engine/plan';
import { suggestSchedule } from './engine/scheduleSuggest';

interface Props {
  degrees: StoredDegree[];
  states: CourseStates;
  terms: TermConfig[];
  plannerState: PlannerState;
  prereqOverrides: Record<string, string[]>;
  courseEquivalents: Record<string, string[]>;
  reqOverrides: Record<string, ReqOverrideValue>;
  onStateChange: (next: PlannerState) => void;
}

export function PlannerBoard({ degrees, states, terms, plannerState, prereqOverrides, courseEquivalents, reqOverrides, onStateChange }: Props) {
  const [dragCode, setDragCode] = useState<string | null>(null);
  const [dragOverTerm, setDragOverTerm] = useState<string | null>(null);

  const overlapCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of findOverlaps(degrees)) map.set(o.code, o.appearsIn.size);
    return map;
  }, [degrees]);

  // Only the courses actually needed: required + the shortfall of each
  // "choose N"/credits group (not every option).
  const plan = useMemo(
    () => buildSchedulingPlan(degrees, states, prereqOverrides, courseEquivalents, reqOverrides),
    [degrees, states, prereqOverrides, courseEquivalents, reqOverrides],
  );
  const remaining = plan.required;

  const suggestion = useMemo(() => {
    // Manual assignments pin courses; suggest around them
    const manual = plannerState.assignments;
    const unpinned = remaining.filter((c) => !manual[c.code]);
    const completedAndInProgress = new Set([...states.completed, ...states.inProgress]);
    const sugg = suggestSchedule(
      unpinned,
      completedAndInProgress,
      terms.map((t) => ({
        ...t,
        creditCap:
          t.creditCap -
          remaining
            .filter((c) => manual[c.code] === t.id)
            .reduce((sum, c) => sum + (c.credits ?? 3), 0),
      })),
      (code) => overlapCounts.get(normalizeCode(code)) ?? 1,
    );
    return sugg;
  }, [remaining, states, terms, plannerState.assignments, overlapCounts]);

  // Unmet category/credit requirements (distribution, breadth, other-department
  // credits) have no fixed course list, so no card can represent them — keep a
  // standing reminder so they're never forgotten when laying out terms.
  const categoryReminders = useMemo(() => {
    const out: Array<{ degree: string; title: string; rule: string; progress: string; notes: string | null }> = [];
    for (const d of degrees) {
      for (const g of evaluateDegree(d, states, courseEquivalents, scopeReqOverrides(reqOverrides, d.id)).groups) {
        if (!g.satisfied && g.group.courses.length === 0) {
          out.push({
            degree: d.name,
            title: g.group.title,
            rule:
              g.group.rule.kind === 'credits'
                ? `${g.group.rule.credits ?? '?'} credits`
                : g.group.rule.kind === 'chooseN'
                  ? `choose ${g.group.rule.n ?? 1}`
                  : 'required',
            progress: `${g.progress}/${g.required}`,
            notes: g.group.notes,
          });
        }
      }
    }
    return out;
  }, [degrees, states, courseEquivalents, reqOverrides]);

  const coursesForTerm = (term: TermConfig): RequirementCourse[] => {
    const pinned = remaining.filter((c) => plannerState.assignments[c.code] === term.id);
    // Assigned courses that aren't in the remaining-requirements list (AI
    // Advisor plans, what-if commits of electives, free choices) still belong
    // on the board — render them as plain cards so no saved plan goes invisible.
    const known = new Set(remaining.map((c) => normalizeCode(c.code)));
    const extras: RequirementCourse[] = Object.entries(plannerState.assignments)
      .filter(
        ([code, tid]) =>
          tid === term.id &&
          !known.has(normalizeCode(code)) &&
          !states.completed.has(normalizeCode(code)) &&
          !states.inProgress.has(normalizeCode(code)),
      )
      .map(([code]) => ({ code, title: '', credits: null, prereqCodes: [] }));
    const suggested = suggestion.terms.find((t) => t.term.id === term.id)?.courses ?? [];
    return [...pinned, ...extras, ...suggested];
  };

  const drop = (termId: string) => {
    if (!dragCode) return;
    const next: PlannerState = {
      ...plannerState,
      assignments: { ...plannerState.assignments, [dragCode]: termId },
    };
    onStateChange(next);
    void sendToBackground({ kind: 'PLANNER_STATE_UPDATE', state: next }).catch(() => {});
    setDragCode(null);
    setDragOverTerm(null);
  };

  const unpin = (code: string) => {
    const assignments = { ...plannerState.assignments };
    delete assignments[code];
    const next = { ...plannerState, assignments };
    onStateChange(next);
    void sendToBackground({ kind: 'PLANNER_STATE_UPDATE', state: next }).catch(() => {});
  };

  if (terms.length === 0) {
    return (
      <div class="pl-card">
        <h2>Future terms</h2>
        <p class="pl-muted">
          Add your upcoming terms (e.g. “Fall 2026”, credit cap 18) in the extension options to get
          a suggested semester-by-semester layout.
        </p>
        <button class="pl-btn" onClick={() => chrome.runtime.openOptionsPage()}>
          Open options
        </button>
      </div>
    );
  }

  return (
    <div class="pl-card">
      <h2>Suggested layout — {remaining.length} courses remaining</h2>
      <p class="pl-muted">
        Auto-arranged respecting stated prerequisites and each term's credit cap. Courses that
        satisfy multiple requirements (⭐, purple edge) are recommended and placed first. Drag a
        card to pin it to a term.
      </p>
      <div class="pl-board">
        {terms.map((term) => {
          const courses = coursesForTerm(term);
          const credits = courses.reduce((sum, c) => sum + (c.credits ?? 3), 0);
          return (
            <div
              class={`pl-term${dragOverTerm === term.id ? ' dragover' : ''}${credits > term.creditCap ? ' over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverTerm(term.id);
              }}
              onDragLeave={() => setDragOverTerm(null)}
              onDrop={() => drop(term.id)}
            >
              <h3>{term.label}</h3>
              <div class="pl-credits">
                {credits} / {term.creditCap} credits
              </div>
              {courses.map((c) => {
                const pinned = plannerState.assignments[c.code] === term.id;
                const reqCount = plan.requirementCount.get(normalizeCode(c.code)) ?? 1;
                const multi = reqCount > 1 || (overlapCounts.get(normalizeCode(c.code)) ?? 1) > 1;
                return (
                  <div
                    class={`pl-course-card${multi ? ' multi' : ''}`}
                    draggable
                    onDragStart={() => setDragCode(c.code)}
                  >
                    {reqCount > 1 && <span title={`Satisfies ${reqCount} requirements`}>⭐ </span>}
                    <b>{c.code}</b> {c.credits !== null ? `· ${c.credits}cr` : ''}
                    {pinned && (
                      <button
                        class="pl-btn secondary"
                        style={{ float: 'right', padding: '0 6px', fontSize: '10px' }}
                        title="Unpin (return to auto-placement)"
                        onClick={() => unpin(c.code)}
                      >
                        📌
                      </button>
                    )}
                    {c.title && <div class="pl-muted">{c.title}</div>}
                    {c.prereqCodes.length > 0 && (
                      <div class="pl-muted">req: {c.prereqCodes.join(', ')}</div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {categoryReminders.length > 0 && (
        <div class="pl-catreq">
          <div class="pl-catreq-title">📋 Don't forget — requirements without a fixed course list</div>
          <p class="pl-muted" style={{ margin: '2px 0 8px' }}>
            These count toward graduation but can be satisfied by many courses (often from other
            departments), so the board can't place them automatically. Leave room for them in your
            terms — the ✨ AI Advisor can suggest specific courses that satisfy each.
          </p>
          {categoryReminders.map((r) => (
            <div class="pl-catreq-row">
              <span class="pl-degree-tag">{r.degree}</span>
              <b>{r.title}</b>
              <span class="pl-muted">
                {r.rule} · progress {r.progress}
              </span>
              {r.notes && <span class="pl-muted">— {r.notes}</span>}
            </div>
          ))}
        </div>
      )}

      {suggestion.unplaced.length > 0 && (
        <div class="pl-error">
          Doesn't fit in your configured terms: {suggestion.unplaced.map((c) => c.code).join(', ')}
          {suggestion.cyclic.length > 0 &&
            ` (check prerequisites of ${suggestion.cyclic.join(', ')} — they may be circular)`}
          . Add more terms in options or raise credit caps.
        </div>
      )}

      {plan.electives.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <h3 style={{ fontSize: '15px' }}>Elective choices</h3>
          <p class="pl-muted">
            These groups let you pick from a list. The board scheduled the minimum needed
            (auto-picked, preferring courses that count toward multiple degrees). Swap in any option
            you prefer by adding it in the review editor or pinning it.
          </p>
          {plan.electives.map((e) => (
            <div class="pl-group">
              <div class="pl-group-title">
                <span>
                  {e.degreeName} · {e.groupTitle}
                </span>
                <span class="pl-muted">
                  need {e.needed} more {e.unit}
                </span>
              </div>
              <div>
                {e.picked.map((c) => {
                  const rc = plan.requirementCount.get(normalizeCode(c.code)) ?? 1;
                  return (
                    <span class="pl-chip planned" title="auto-picked to satisfy this group">
                      {rc > 1 ? '⭐ ' : ''}✓ {c.code}
                    </span>
                  );
                })}
                {[...e.options]
                  .sort(
                    (a, b) =>
                      (plan.requirementCount.get(normalizeCode(b.code)) ?? 1) -
                      (plan.requirementCount.get(normalizeCode(a.code)) ?? 1),
                  )
                  .map((c) => {
                    const rc = plan.requirementCount.get(normalizeCode(c.code)) ?? 1;
                    return (
                      <span
                        class="pl-chip none"
                        title={rc > 1 ? `Recommended — satisfies ${rc} requirements` : 'other option you could choose instead'}
                      >
                        {rc > 1 ? '⭐ ' : ''}
                        {c.code}
                      </span>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
