import './chromeStub'; // must run before anything touches chrome.*
import { render } from 'preact';
import { useState } from 'preact/hooks';
import stylesCss from '../src/content/ui/styles.css?inline';
import badgesCss from '../src/content/ui/badges.css?inline';
import plannerCss from '../src/planner/planner.css?inline';

import { WeekGrid } from '../src/content/ui/WeekGrid';
import { openRmpPopover } from '../src/content/ui/RmpPopover';
import { CaptureWidget } from '../src/content/ui/CaptureWidget';
import { RmpAllPanel } from '../src/content/ui/RmpAllPanel';
import { currentPageSignal, rmpPanelSignal } from '../src/content/ui/captureState';
import { DegreeImport } from '../src/planner/DegreeImport';
import { findConflicts } from '../src/shared/time';
import {
  buildCourseStates,
  evaluateDegree,
  type GroupEvaluation,
} from '../src/planner/engine/requirements';
import { findOverlaps } from '../src/planner/engine/overlap';
import { suggestSchedule } from '../src/planner/engine/scheduleSuggest';
import { buildSchedulingPlan } from '../src/planner/engine/plan';
import type { RmpCacheEntry } from '../src/shared/types';
import {
  mockSchedule,
  mockGhostConflict,
  mockDegrees,
  mockHistory,
  mockStore,
} from './mockData';

// Inject the components' own CSS into the page (normally scoped to shadow roots).
const style = document.createElement('style');
style.textContent = stylesCss + badgesCss + plannerCss;
document.head.appendChild(style);

// Pretend we're on the saved-schedule page so the capture widget is actionable.
currentPageSignal.value = 'saved-schedule';

// ---------- Feature 1: calendar ----------

function CalendarDemo() {
  const [ghost, setGhost] = useState(false);
  const conflicts = ghost ? findConflicts(mockGhostConflict, mockSchedule) : [];
  return (
    <section class="demo-card">
      <h2>1 · Live schedule calendar + conflict detection</h2>
      <p class="demo-muted">
        The real <code>WeekGrid</code> component (shown floating over Find Course Sections in the
        extension) rendering the saved schedule. Toggle a candidate section to see conflict
        highlighting.
      </p>
      <label class="demo-toggle">
        <input type="checkbox" checked={ghost} onChange={(e) => setGhost((e.target as HTMLInputElement).checked)} />
        Hovering search result <b>CS 3410</b> (MWF 10:00–10:50)
      </label>
      {ghost && (
        <div class="demo-conflict-note">
          ⛔ Conflicts with {conflicts.map((c) => c.courseCode).join(', ')} — the block shows dashed
          with a red outline on the overlapping course.
        </div>
      )}
      <div style={{ maxWidth: '460px', border: '1px solid #d5d9de', borderRadius: '10px', overflow: 'hidden' }}>
        <WeekGrid sections={mockSchedule} ghost={ghost ? mockGhostConflict : null} />
      </div>
    </section>
  );
}

// ---------- Feature 2: RMP badges ----------

const bracyEntry: RmpCacheEntry = {
  teacher: {
    teacherId: 't-bracy',
    firstName: 'Anne',
    lastName: 'Bracy',
    department: 'Computer Science',
    avgRating: 3.4,
    avgDifficulty: 3.9,
    wouldTakeAgainPercent: 61.6,
    numRatings: 75,
    topComments: [
      { quality: 5, difficulty: 3, courseName: 'CS 2110', text: 'Great professor, very clearly knowledgeable. Her explanations clarify how the code functions in memory. Grading is fair. Pay attention in lecture — filled notes are not posted.', date: '2026-05-05', thumbsUp: 4 },
      { quality: 5, difficulty: 3, courseName: 'CS 2110', text: 'Amazing professor, very caring. Her lectures make difficult concepts much more intuitive.', date: '2026-03-05', thumbsUp: 2 },
    ],
  },
  candidates: [],
  uncertain: false,
  fetchedAt: Date.now(),
};

function ratingClass(r: number) {
  return r >= 3.8 ? 'good' : r >= 2.8 ? 'mid' : 'bad';
}

function RmpDemo() {
  const rows = [
    { code: 'CS 2110', title: 'OOP & Data Structures', instructor: 'Anne Bracy', rating: 3.4 },
    { code: 'PHYS 1112', title: 'Physics I: Mechanics', instructor: 'Natasha Holmes', rating: 4.6 },
    { code: 'MATH 2940', title: 'Linear Algebra', instructor: 'Robert Connelly', rating: 2.5 },
  ];
  return (
    <section class="demo-card">
      <h2>2 · RateMyProfessors inline</h2>
      <p class="demo-muted">
        Mock Find Course Sections rows with the real badge styling. Click Anne Bracy's badge to open
        the real popover (live comments + “not this professor?” correction).
      </p>
      <div class="demo-results">
        {rows.map((r) => (
          <div class="demo-result-row">
            <div>
              <b>{r.code}</b> — {r.title}
              <div class="demo-muted">{r.instructor}</div>
            </div>
            <button
              class={`wdc-rmp-badge ${ratingClass(r.rating)}`}
              onClick={(e) =>
                r.code === 'CS 2110'
                  ? openRmpPopover('Anne Bracy', bracyEntry, e.clientX, e.clientY)
                  : undefined
              }
            >
              ★ {r.rating.toFixed(1)}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- Feature 3: planner ----------

function GroupRow({ g }: { g: GroupEvaluation }) {
  const chip = (state: string) => `demo-chip ${state}`;
  return (
    <div class="demo-group">
      <div class="demo-group-title">
        <span>{g.satisfied ? '✅' : g.progress > 0 ? '🕐' : '⭕'} {g.group.title}</span>
        <span class="demo-muted">{g.progress}/{g.required} {g.unit}{g.satisfied && !g.satisfiedByCompletedOnly ? ' (incl. planned)' : ''}</span>
      </div>
      <div class="demo-bar"><div style={{ width: `${g.required ? Math.min(100, (g.progress / g.required) * 100) : 0}%` }} /></div>
      <div>
        {g.courses.map((c) => (
          <span class={chip(c.state)} title={`${c.course.title ?? c.course.code} — ${c.state}`}>{c.course.code}</span>
        ))}
      </div>
    </div>
  );
}

function PlannerDemo() {
  const states = buildCourseStates(
    mockHistory.courses,
    mockSchedule.map((s) => s.courseCode),
    [],
  );
  const evaluations = mockDegrees.map((d) => evaluateDegree(d, states));
  const overlaps = findOverlaps(mockDegrees);

  // Only schedule the courses actually needed (choose-N groups pick the shortfall).
  const plan = buildSchedulingPlan(mockDegrees, states, {});
  const remaining = plan.required;
  const overlapCount = new Map(findOverlaps(mockDegrees).map((o) => [o.code, o.appearsIn.size]));
  const suggestion = suggestSchedule(
    remaining,
    new Set([...states.completed, ...states.inProgress]),
    mockStore.settings.terms,
    (code) => overlapCount.get(code) ?? 1,
  );

  return (
    <section class="demo-card">
      <h2>3 · Multi-degree planner (real engine)</h2>
      <p class="demo-muted">
        Progress, overlap, and the suggested term layout below are all computed by the real planner
        engine from the mock transcript + saved schedule.
      </p>

      <div class="demo-legend">
        <span class="demo-chip completed">completed</span>
        <span class="demo-chip in-progress">in progress</span>
        <span class="demo-chip planned">planned</span>
        <span class="demo-chip none">not taken</span>
      </div>

      <div class="demo-two-col">
        {evaluations.map((ev) => (
          <div class="demo-degree">
            <h3>{ev.degree.name} <span class="demo-tag">{ev.degree.type}</span></h3>
            <div class="demo-muted" style={{ marginBottom: '6px' }}>{ev.satisfiedGroups}/{ev.totalGroups} groups satisfied</div>
            {ev.groups.map((g) => <GroupRow g={g} />)}
          </div>
        ))}
      </div>

      <h3>Course overlap across degrees</h3>
      <table class="demo-table">
        <thead><tr><th>Course</th><th>Counts toward</th></tr></thead>
        <tbody>
          {overlaps.map((o) => (
            <tr>
              <td><b>{o.code}</b>{o.title ? ` — ${o.title}` : ''}</td>
              <td>{[...o.appearsIn.keys()].map((id) => <span class="demo-tag">{mockDegrees.find((d) => d.id === id)?.name}</span>)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Suggested layout — {remaining.length} courses remaining</h3>
      <div class="demo-board">
        {suggestion.terms.map((t) => (
          <div class="demo-term">
            <h4>{t.term.label}</h4>
            <div class="demo-muted">{t.credits} / {t.term.creditCap} credits</div>
            {t.courses.map((c) => {
              const rc = plan.requirementCount.get(c.code) ?? 1;
              const multi = rc > 1 || (overlapCount.get(c.code) ?? 1) > 1;
              return (
                <div class={`demo-course${multi ? ' multi' : ''}`}>
                  {rc > 1 ? '⭐ ' : ''}<b>{c.code}</b> · {c.credits}cr
                  {c.prereqCodes.length > 0 && <div class="demo-muted">req: {c.prereqCodes.join(', ')}</div>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {suggestion.unplaced.length > 0 && (
        <div class="demo-conflict-note">Didn't fit in configured terms: {suggestion.unplaced.map((c) => c.code).join(', ')}</div>
      )}

      {plan.electives.length > 0 && (
        <>
          <h3>Elective choices (only the shortfall is scheduled)</h3>
          {plan.electives.map((e) => (
            <div class="demo-group">
              <div class="demo-group-title">
                <span>{e.degreeName} · {e.groupTitle}</span>
                <span class="demo-muted">need {e.needed} more {e.unit}</span>
              </div>
              <div>
                {e.picked.map((c) => (
                  <span class="demo-chip planned">✓ {c.code}</span>
                ))}
                {e.options.map((c) => (
                  <span class="demo-chip none">{c.code}</span>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function ImportDemo() {
  return (
    <section class="demo-card">
      <h2>4 · Add a degree — Claude API key is optional</h2>
      <p class="demo-muted">
        The real import panel. With no key set (as here) it shows the fallback notice and a “build
        manually” option; imports use rule-based extraction you clean up in the review editor.
      </p>
      <DegreeImport onParsed={() => alert('In the planner this opens the review/edit screen.')} />
    </section>
  );
}

function Demo() {
  return (
    <div class="demo-shell">
      <header class="demo-header">
        <h1>🎓 Student Companion for Workday — live demo</h1>
        <p class="demo-muted">Real components &amp; planner engine running on mock data (a CS major + Math minor, mid-degree). No Workday login or extension install needed.</p>
      </header>
      <CalendarDemo />
      <RmpDemo />
      <PlannerDemo />
      <ImportDemo />
      {/* Floating capture button — the new "notify me when to capture" control. */}
      <CaptureWidget />
      {/* "Rate all professors on this page" panel (toggled from the capture widget). */}
      {rmpPanelSignal.value && <RmpAllPanel />}
    </div>
  );
}

render(<Demo />, document.getElementById('app')!);
