/**
 * Degree Planner page: progress per degree, overlap analysis, term board,
 * and the import -> review flow.
 */
import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type {
  DegreeProgram,
  HistoryCourse,
  PlannerState,
  ReqOverrideValue,
  RequirementCourse,
  StorageShape,
} from '../shared/types';
import { getAllStored, onStoredChange } from '../shared/storage';
import { sendToBackground } from '../background/messages';
import {
  buildCourseStates,
  evaluateDegree,
  normalizeCode,
  reqOverrideKey,
  scopeReqOverrides,
  type GroupEvaluation,
} from './engine/requirements';
import { computeLevel, effectiveThemeLevel } from './engine/levels';
import { LevelChip, LevelHero } from './LevelHero';
import { GpaCard } from './GpaCard';
import { Guide } from './Guide';
import { DegreeImport } from './DegreeImport';
import { ReviewEditor } from './ReviewEditor';
import { OverlapView } from './OverlapView';
import { PlannerBoard } from './PlannerBoard';
import { WhatIf } from './WhatIf';
import { PrereqEditor } from './PrereqEditor';
import { AiAdvisor } from './AiAdvisor';
import { AiHistory } from './AiHistory';
import { isPro, isSupreme } from '../shared/plan';

type Tab = 'progress' | 'whatif' | 'advisor' | 'board' | 'overlap' | 'prereqs' | 'import' | 'history';

interface PendingReview {
  degree: DegreeProgram;
  sourceUrl: string | null;
  sourceText: string;
  existingId: string | null;
}

function GroupRow({
  g,
  degreeId,
  onToggleTaken,
}: {
  g: GroupEvaluation;
  degreeId: string | null;
  onToggleTaken: (course: RequirementCourse, taken: boolean) => void;
}) {
  // Manual override: the student can overrule the computed status with a full
  // verdict (met/unmet) or a completed count (e.g. "2 of these are done") —
  // for requirements met by courses the extension can't see.
  const setOverride = (value: ReqOverrideValue | null) => {
    if (!degreeId) return;
    void sendToBackground({ kind: 'REQ_OVERRIDE_SET', key: reqOverrideKey(degreeId, g.group.title), value });
  };
  const hasOverride = g.manual !== undefined || g.manualDone !== undefined;
  return (
    <div class="pl-group">
      <div class="pl-group-title">
        <span>
          {g.satisfied ? '✅' : g.progress > 0 ? '🕐' : '⭕'} {g.group.title}
          {g.manual && (
            <span class="pl-manual-tag" title="You marked this yourself — it overrides the computed status">
              ✍ marked {g.manual} by you
            </span>
          )}
          {g.manualDone !== undefined && (
            <span class="pl-manual-tag" title="You entered this count yourself — it overrides the computed tally when higher">
              ✍ you set {g.manualDone} done
            </span>
          )}
        </span>
        <span class="pl-group-actions">
          <span class="pl-muted">
            {g.progress}/{g.required} {g.unit}
            {g.satisfied && !g.satisfiedByCompletedOnly ? ' (incl. planned)' : ''}
          </span>
          {degreeId && !g.manual && (
            <label
              class="pl-done-edit"
              title={`Tally looks wrong? Type how many ${g.unit} you've already completed — clear it to go back to automatic`}
            >
              <input
                type="number"
                min={0}
                max={g.required}
                placeholder="auto"
                value={g.manualDone ?? ''}
                onChange={(e) => {
                  const raw = (e.target as HTMLInputElement).value.trim();
                  const n = Number(raw);
                  setOverride(raw === '' || Number.isNaN(n) ? null : { done: n });
                }}
              />
              done
            </label>
          )}
          {degreeId &&
            (hasOverride ? (
              <button class="pl-verdict-btn" title="Return to automatic tracking" onClick={() => setOverride(null)}>
                ↺ auto
              </button>
            ) : g.satisfied ? (
              <button class="pl-verdict-btn" title="Actually, I still need this" onClick={() => setOverride('unmet')}>
                mark not met
              </button>
            ) : (
              <button class="pl-verdict-btn" title="I already satisfied this (e.g. with courses not captured here)" onClick={() => setOverride('met')}>
                mark met
              </button>
            ))}
        </span>
      </div>
      <div class="pl-progressbar">
        <div style={{ width: `${g.required ? Math.min(100, (g.progress / g.required) * 100) : 0}%` }} />
      </div>
      <div>
        {g.courses.map((c) => {
          // Equivalent-satisfied chips aren't toggleable: the credit comes from
          // a different course code (often AP/transfer), so a click here would
          // silently edit the wrong history entry.
          const clickable = degreeId !== null && !(c.state === 'completed' && c.via);
          const taken = c.state === 'completed' && !c.via;
          return (
            <span
              class={`pl-chip ${c.state}${clickable ? ' pl-click' : ''}`}
              role={clickable ? 'button' : undefined}
              title={
                c.via
                  ? `${c.course.code} satisfied by equivalent ${c.via} (${c.state})`
                  : `${c.course.title ?? c.course.code} — ${c.state}. Click to mark as ${taken ? 'NOT taken' : 'taken'}.`
              }
              onClick={clickable ? () => onToggleTaken(c.course, !taken) : undefined}
            >
              {c.course.code}
              {c.via ? ` ⇐ ${c.via}` : ''}
            </span>
          );
        })}
      </div>
      {g.group.notes && <p class="pl-muted">📝 {g.group.notes}</p>}
    </div>
  );
}

function App() {
  const [store, setStore] = useState<StorageShape | null>(null);
  const [tab, setTab] = useState<Tab>('progress');
  const [review, setReview] = useState<PendingReview | null>(null);
  // Level-theme preview from the journey ladder (cosmetic only, never stored).
  const [previewLevel, setPreviewLevel] = useState<number | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideAutoChecked, setGuideAutoChecked] = useState(false);

  const reload = () => void getAllStored().then(setStore);

  useEffect(() => {
    reload();
    const un1 = onStoredChange('degrees', reload);
    const un2 = onStoredChange('academicHistory', reload);
    const un3 = onStoredChange('schedule', reload);
    // plannerState too: DEGREE_SAVE adds the new id to includedDegreeIds *after*
    // writing degrees — without this, a freshly added degree can miss Progress.
    const un4 = onStoredChange('plannerState', reload);
    const un5 = onStoredChange('reqOverrides', reload);
    // settings too, so the plan badge & Pro animations flip live on upgrade.
    const un6 = onStoredChange('settings', reload);
    return () => {
      un1();
      un2();
      un3();
      un4();
      un5();
      un6();
    };
  }, []);

  const derived = useMemo(() => {
    if (!store) return null;
    const degrees = Object.values(store.degrees).filter((d) =>
      store.plannerState.includedDegreeIds.length === 0
        ? true
        : store.plannerState.includedDegreeIds.includes(d.id),
    );
    // User-chosen display order; degrees not in the list keep insertion order at the end.
    const order = store.plannerState.degreeOrder ?? [];
    const rank = (id: string) => {
      const i = order.indexOf(id);
      return i === -1 ? order.length : i;
    };
    degrees.sort((a, b) => rank(a.id) - rank(b.id));
    const states = buildCourseStates(
      store.academicHistory?.courses ?? [],
      store.schedule?.sections.map((s) => s.courseCode) ?? [],
      Object.keys(store.plannerState.assignments),
    );
    const evaluations = degrees.map((d) =>
      evaluateDegree(d, states, store.courseEquivalents, scopeReqOverrides(store.reqOverrides, d.id)),
    );
    // What-if GPA candidates: in-progress history courses, scheduled courses,
    // and board-planned courses (credits from the schedule/catalog, else 3).
    const historyCourses = store.academicHistory?.courses ?? [];
    const catalogCredits = new Map<string, number>();
    for (const d of degrees)
      for (const g of d.groups)
        for (const c of g.courses) if (c.credits) catalogCredits.set(c.code, c.credits);
    const seen = new Set<string>();
    const gpaCandidates: Array<{ code: string; credits: number }> = [];
    const addCandidate = (code: string, credits: number | null | undefined) => {
      if (seen.has(code)) return;
      seen.add(code);
      gpaCandidates.push({ code, credits: credits || catalogCredits.get(code) || 3 });
    };
    const graded = new Set(
      historyCourses.filter((c) => c.status === 'completed' && c.grade).map((c) => c.code),
    );
    for (const c of historyCourses) if (c.status === 'in-progress') addCandidate(c.code, c.credits);
    for (const s of store.schedule?.sections ?? [])
      if (!graded.has(s.courseCode)) addCandidate(s.courseCode, s.credits);
    for (const code of Object.keys(store.plannerState.assignments))
      if (!graded.has(code)) addCandidate(code, null);
    return { degrees, states, evaluations, gpaCandidates };
  }, [store]);

  if (!store || !derived) return <div class="pl-shell">Loading…</div>;

  // First visit: auto-run the beginner guide once (replayable via ❓ Guide).
  if (!guideAutoChecked) {
    setGuideAutoChecked(true);
    if (!store.plannerState.guideSeen) setGuideOpen(true);
  }

  const finishGuide = () => {
    setGuideOpen(false);
    if (!store.plannerState.guideSeen) {
      void sendToBackground({
        kind: 'PLANNER_STATE_UPDATE',
        state: { ...store.plannerState, guideSeen: true },
      });
    }
  };

  const { degrees, states, evaluations } = derived;
  const levelInfo = degrees.length > 0 ? computeLevel(evaluations, states) : null;
  // Theme the UI wears: preview wins, then the owner-pinned theme, then the
  // real level. Level 1 keeps the standard look.
  const themeLv = levelInfo ? effectiveThemeLevel(levelInfo.level, store.settings) : 1;
  const uiLv = previewLevel ?? themeLv;

  const onPlannerStateChange = (next: PlannerState) =>
    setStore({ ...store, plannerState: next });

  // Swap a degree card with its neighbor and persist the full display order.
  const moveDegree = (id: string, dir: -1 | 1) => {
    const ids = degrees.map((d) => d.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    const state = { ...store.plannerState, degreeOrder: ids };
    // optimistic: reflect the swap immediately, storage echo confirms it
    setStore({ ...store, plannerState: state });
    void sendToBackground({ kind: 'PLANNER_STATE_UPDATE', state });
  };

  // Click-to-toggle from a requirement chip: mark a course taken (add it to
  // academic history as completed, or upgrade an in-progress entry) or not
  // taken (remove its history entry). Saved as source 'upload' so a later
  // Workday scrape can't silently undo the manual edit.
  const toggleTaken = (course: RequirementCourse, taken: boolean) => {
    const current = store.academicHistory?.courses ?? [];
    const norm = normalizeCode(course.code);
    let courses: HistoryCourse[];
    if (taken) {
      const idx = current.findIndex((c) => normalizeCode(c.code) === norm);
      courses =
        idx >= 0
          ? current.map((c, i) => (i === idx ? { ...c, status: 'completed' as const } : c))
          : [
              ...current,
              {
                code: norm,
                title: course.title ?? '',
                credits: course.credits,
                grade: null,
                term: null,
                status: 'completed' as const,
              },
            ];
    } else {
      courses = current.filter((c) => normalizeCode(c.code) !== norm);
    }
    void sendToBackground({
      kind: 'HISTORY_SET',
      history: { courses, capturedAt: Date.now(), source: 'upload' },
    });
  };

  const pro = isPro(store.settings);
  const supreme = isSupreme(store.settings);
  // Animations & flair are a Pro perk — the pl-pro class unlocks them in CSS.
  // Level themes color the whole planner from level 2 up (level 1 = standard).
  const shellClass = `pl-shell${pro ? ' pl-pro' : ''}${levelInfo && uiLv > 1 ? ` pl-themed pl-lv-${uiLv}` : ''}`;
  // Both badges click through to the subscription page (manage / upgrade).
  const openSubscribe = () => void sendToBackground({ kind: 'OPEN_SUBSCRIBE' });
  const planBadge = supreme ? (
    <span class="pl-pro-badge supreme pl-badge-click" title="View your plan" onClick={openSubscribe}>
      👑 SUPREME
    </span>
  ) : pro ? (
    <span class="pl-pro-badge pl-badge-click" title="View your plan" onClick={openSubscribe}>
      ✨ PRO
    </span>
  ) : null;

  if (review) {
    return (
      <div class={shellClass}>
        <div class="pl-header">
          <h1>🎓 Degree Planner {planBadge}</h1>
        </div>
        <ReviewEditor
          initial={review.degree}
          sourceUrl={review.sourceUrl}
          sourceText={review.sourceText}
          existingId={review.existingId}
          onDone={() => {
            setReview(null);
            setTab('progress');
          }}
          onCancel={() => setReview(null)}
        />
      </div>
    );
  }

  return (
    <div class={shellClass}>
      <div class="pl-header">
        <h1>
          🎓 Degree Planner {planBadge}
          {levelInfo && (
            <LevelChip
              info={levelInfo}
              previewLevel={previewLevel}
              themeLevel={themeLv}
              onClick={() => {
                setTab('progress');
                window.scrollTo({ top: 0 });
              }}
            />
          )}
        </h1>
        <div class="pl-row">
          <span class="pl-muted">
            {store.academicHistory
              ? `${store.academicHistory.courses.length} courses in history`
              : 'no academic history captured yet'}
            {' · '}
            {store.schedule ? `${store.schedule.sections.length} sections scheduled` : 'no saved schedule captured'}
          </span>
          <button class="pl-btn secondary" title="Replay the beginner tour" onClick={() => setGuideOpen(true)}>
            ❓ Guide
          </button>
          <button class="pl-btn secondary" onClick={() => chrome.runtime.openOptionsPage()}>
            ⚙ Options
          </button>
        </div>
      </div>

      {!store.academicHistory && (
        <div class="pl-error">
          To track what you've completed, open your <b>Academic History / unofficial transcript</b>{' '}
          page in Workday once — the extension captures it automatically.
        </div>
      )}

      {guideOpen && <Guide onNavigate={(t) => setTab(t as Tab)} onFinish={finishGuide} />}

      <div class="pl-tabs">
        {(['progress', 'whatif', 'advisor', 'board', 'overlap', 'prereqs', 'import', 'history'] as Tab[]).map((t) => (
          <button class={`pl-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t === 'progress' && `Progress (${degrees.length})`}
            {t === 'whatif' && '🔮 What-if'}
            {t === 'advisor' && '✨ AI Advisor'}
            {t === 'board' && 'Semester board'}
            {t === 'overlap' && 'Overlap'}
            {t === 'prereqs' && 'Prerequisites'}
            {t === 'import' && '+ Add degree'}
            {t === 'history' && '🕘 AI history'}
          </button>
        ))}
      </div>

      {tab === 'progress' && (
        <>
          {levelInfo && (
            <LevelHero
              info={levelInfo}
              plannerState={store.plannerState}
              previewLevel={previewLevel}
              onPreview={setPreviewLevel}
              themeLevel={themeLv}
              isAdmin={store.settings.admin}
              pinnedTheme={store.settings.admin ? store.settings.themeLevel ?? null : null}
              onPickTheme={(level) =>
                void sendToBackground({ kind: 'SETTINGS_UPDATE', patch: { themeLevel: level ?? undefined } })
              }
            />
          )}
          <GpaCard history={store.academicHistory?.courses ?? []} candidates={derived.gpaCandidates} />
          <div class="pl-legend">
            <span>✅ satisfied</span>
            <span>🕐 partially done</span>
            <span>⭕ not started</span>
            <span class="pl-chip completed">completed</span>
            <span class="pl-chip in-progress">in progress</span>
            <span class="pl-chip planned">planned</span>
            <span class="pl-chip none">not taken</span>
          </div>
          <p class="pl-muted pl-chip-hint">
            💡 Click any course to mark it taken / not taken, or type a number in a row's
            “done” box if the tally is off — clear it (or hit ↺ auto) to go back to automatic.
          </p>
          {degrees.length === 0 && (
            <div class="pl-card">
              <p class="pl-muted">No degrees yet — use “+ Add degree” to import your first program.</p>
            </div>
          )}
          {evaluations.map((ev, evIdx) => {
            const stored = degrees.find((d) => d.name === ev.degree.name);
            const kind =
              ev.degree.type === 'major' ? 'major' : ev.degree.type === 'minor' ? 'minor' : 'other';
            const icon = kind === 'major' ? '🎓' : kind === 'minor' ? '📘' : '📜';
            return (
              <div class={`pl-card pl-deg pl-deg-${kind}`}>
                <div class="pl-row">
                  <h2>
                    <span class={`pl-deg-icon ${kind}`}>{icon}</span> {ev.degree.name}{' '}
                    <span class={`pl-degree-tag pl-tag-${kind}`}>{ev.degree.type}</span>
                  </h2>
                  <span class="pl-muted">
                    {ev.satisfiedGroups}/{ev.totalGroups} groups satisfied
                  </span>
                  {stored && evaluations.length > 1 && (
                    <span class="pl-deg-move">
                      <button
                        class="pl-btn secondary"
                        title="Move this program up"
                        disabled={evIdx === 0}
                        onClick={() => moveDegree(stored.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        class="pl-btn secondary"
                        title="Move this program down"
                        disabled={evIdx === evaluations.length - 1}
                        onClick={() => moveDegree(stored.id, 1)}
                      >
                        ↓
                      </button>
                    </span>
                  )}
                  {stored && (
                    <button
                      class="pl-btn danger"
                      onClick={() => {
                        if (confirm(`Remove "${stored.name}" from the planner?`)) {
                          void sendToBackground({ kind: 'DEGREE_DELETE', id: stored.id });
                        }
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
                {ev.groups.map((g) => (
                  <GroupRow g={g} degreeId={stored?.id ?? null} onToggleTaken={toggleTaken} />
                ))}
              </div>
            );
          })}
        </>
      )}

      {tab === 'whatif' && (
        <WhatIf
          degrees={degrees}
          states={states}
          terms={store.settings.terms}
          plannerState={store.plannerState}
          courseEquivalents={store.courseEquivalents}
          reqOverrides={store.reqOverrides}
        />
      )}

      {tab === 'advisor' && (
        <AiAdvisor
          degrees={degrees}
          states={states}
          terms={store.settings.terms}
          prereqOverrides={store.prereqOverrides}
          courseEquivalents={store.courseEquivalents}
          reqOverrides={store.reqOverrides}
          plannerState={store.plannerState}
          isPro={pro}
          isSupreme={supreme}
        />
      )}

      {tab === 'board' && (
        <PlannerBoard
          degrees={degrees}
          states={states}
          terms={store.settings.terms}
          plannerState={store.plannerState}
          prereqOverrides={store.prereqOverrides}
          courseEquivalents={store.courseEquivalents}
          reqOverrides={store.reqOverrides}
          onStateChange={onPlannerStateChange}
        />
      )}

      {tab === 'overlap' && <OverlapView degrees={degrees} states={states} />}

      {tab === 'prereqs' && (
        <PrereqEditor
          degrees={degrees}
          prereqOverrides={store.prereqOverrides}
          courseEquivalents={store.courseEquivalents}
          states={states}
        />
      )}

      {tab === 'import' && (
        <DegreeImport
          onParsed={(degree, sourceUrl, sourceText) =>
            setReview({ degree, sourceUrl, sourceText, existingId: null })
          }
        />
      )}

      {tab === 'history' && <AiHistory />}

      <p class="pl-muted" style={{ textAlign: 'center', marginTop: '24px' }}>
        🐛 Found a problem, or have a suggestion?{' '}
        <button class="pl-link-inline" onClick={() => chrome.runtime.openOptionsPage()}>
          Send feedback
        </button>{' '}
        — the 💬 Feedback section in Options goes straight to the developer.
      </p>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
