/**
 * Floating capture widget, shown on Workday pages while the extension is on.
 * Makes data capture explicit and debuggable:
 *  - tells the user when the current page holds capturable data;
 *  - captures on demand, MERGING into what's already stored so a schedule that
 *    doesn't fit in one screen can be built up by scrolling + capturing again;
 *  - lists the actual courses detected (not just a count);
 *  - can force the calendar open on any page;
 *  - shows diagnostics explaining why the calendar / RMP might be unavailable.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AcademicHistory, HistoryCourse, ScheduleSnapshot, Settings } from '../../shared/types';
import { getStored, onStoredChange } from '../../shared/storage';
import { sendToBackground } from '../../background/messages';
import { mergeSections } from '../../shared/schedule';
import { addManualSection } from './scheduleEdit';
import { scrapeSavedSchedule } from '../scrapers/savedSchedule';
import { scrapeAcademicHistory } from '../scrapers/academicHistory';
import { countCandidateRows } from '../scrapers/findCourseSections';
import { queryAll } from '../scrapers/selectors';
import type { WorkdayPage } from '../pageDetect';
import {
  calendarPref,
  calendarShouldShow,
  captureToast,
  currentPageSignal,
  rmpPanelSignal,
  showCaptureToast,
} from './captureState';
import { useDraggable } from './useDraggable';
import { isPro } from '../../shared/plan';

type CaptureKind = 'schedule' | 'history' | null;

function captureKindFor(page: WorkdayPage): CaptureKind {
  if (page === 'saved-schedule' || page === 'view-courses' || page === 'find-course-sections')
    return 'schedule';
  if (page === 'academic-history') return 'history';
  return null;
}

function ago(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function CaptureWidget() {
  const [collapsed, setCollapsed] = useState(false);
  const [showDiag, setShowDiag] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [editHistory, setEditHistory] = useState<HistoryCourse[] | null>(null);
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [addCode, setAddCode] = useState('');
  const [addPattern, setAddPattern] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<ScheduleSnapshot | null>(null);
  const [history, setHistory] = useState<AcademicHistory | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const page = currentPageSignal.value;
  const toast = captureToast.value;
  const calendarVisible = calendarShouldShow(page, settings?.calendarEnabled ?? true);
  // Original/default location: lower-left, comfortably on-screen.
  const defaultPos = () => ({ x: 16, y: Math.max(8, window.innerHeight - 520) });
  const { pos, setPos, startDrag, wasDragged } = useDraggable(defaultPos());
  const posR = useRef(pos);
  posR.current = pos;

  // Keep the widget on-screen if the window is resized (never let it hide).
  useEffect(() => {
    const onResize = () => setPos(posR.current);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    void getStored('schedule').then(setSchedule);
    void getStored('academicHistory').then(setHistory);
    void getStored('settings').then(setSettings);
    const un1 = onStoredChange('schedule', setSchedule);
    const un2 = onStoredChange('academicHistory', setHistory);
    const un3 = onStoredChange('settings', setSettings);
    return () => {
      un1();
      un2();
      un3();
    };
  }, []);

  const kind = captureKindFor(page);

  const captureSchedule = () => {
    const snap = scrapeSavedSchedule(document);
    if (!snap || snap.sections.length === 0) {
      showCaptureToast('No course sections found on this page. Make sure your saved schedule is showing.');
      return;
    }
    // Merge into whatever is already stored so multi-scroll captures accumulate.
    const merged = mergeSections(schedule?.sections ?? [], snap.sections);
    const added = merged.length - (schedule?.sections.length ?? 0);
    void sendToBackground({
      kind: 'SCHEDULE_SET',
      snapshot: { ...snap, sections: merged, source: 'dom' },
    }).catch(() => {});
    showCaptureToast(
      added > 0
        ? `✓ Added ${added} new · ${merged.length} total. Scroll & capture again to add more.`
        : `✓ Up to date — ${merged.length} sections (no new ones on screen).`,
    );
  };

  const captureHistory = () => {
    const h = scrapeAcademicHistory(document);
    if (!h || h.courses.length === 0) {
      showCaptureToast('No courses found. Open your Academic History / transcript, or upload it in Options.');
      return;
    }
    void sendToBackground({ kind: 'HISTORY_SET', history: { ...h, source: 'dom' } }).catch(() => {});
    showCaptureToast(`✓ Captured ${h.courses.length} courses from your history.`);
  };

  const clearSchedule = () => {
    void sendToBackground({
      kind: 'SCHEDULE_SET',
      snapshot: { termLabel: null, sections: [], capturedAt: Date.now(), source: 'dom' },
    }).catch(() => {});
    showCaptureToast('Cleared captured schedule.');
  };

  const submitAddCourse = async () => {
    const err = await addManualSection(addCode, addPattern);
    if (err) {
      setAddError(err);
      return;
    }
    setAddError(null);
    setAddCode('');
    setAddPattern('');
    setShowAddCourse(false);
    showCaptureToast(`✓ Added ${addCode.trim()} to your calendar.`);
  };

  // ---- history editing ----
  const startEditHistory = () => setEditHistory((history?.courses ?? []).map((c) => ({ ...c })));
  const editHistoryField = (i: number, patch: Partial<HistoryCourse>) =>
    setEditHistory((rows) => rows!.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const saveHistory = () => {
    const courses = (editHistory ?? []).filter((c) => c.code.trim());
    void sendToBackground({
      kind: 'HISTORY_SET',
      history: { courses, capturedAt: Date.now(), source: 'upload' },
    }).catch(() => {});
    setEditHistory(null);
    showCaptureToast(`✓ Saved ${courses.length} history courses.`);
  };

  // Animations are a Pro perk — the wdc-pro class unlocks them in styles.css.
  const proCls = settings && isPro(settings) ? ' wdc-pro' : '';

  if (collapsed) {
    return (
      <div
        class={`wdc-capture-pill${proCls}`}
        // Explicit 40×40 overrides any inline size the resize handle left behind,
        // so minimizing a resized panel yields the small circle (not a giant one).
        style={{ left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto', bottom: 'auto', width: '40px', height: '40px' }}
        title="Show capture status (drag to move)"
        onPointerDown={startDrag}
        onClick={() => !wasDragged() && setCollapsed(false)}
      >
        📸
      </div>
    );
  }

  const scheduleSections = schedule?.sections ?? [];

  return (
    <div class={`wdc-capture${proCls}`} style={{ left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto', bottom: 'auto' }}>
      <div class="wdc-capture-head" onPointerDown={startDrag}>
        <span>📸 Data capture</span>
        <span style={{ display: 'flex', gap: '4px' }}>
          <button title="Reset to default position" onClick={() => setPos(defaultPos())}>
            ⌖
          </button>
          <button title="Minimize" onClick={() => setCollapsed(true)}>
            —
          </button>
        </span>
      </div>

      {kind === 'schedule' && (
        <>
          <div class="wdc-capture-ready">This page has course sections.</div>
          <button class="wdc-capture-btn" onClick={captureSchedule}>
            Capture schedule (merge)
          </button>
        </>
      )}
      {kind === 'history' && (
        <>
          <div class="wdc-capture-ready">This page has your academic history.</div>
          <button class="wdc-capture-btn" onClick={captureHistory}>
            Capture academic history
          </button>
        </>
      )}
      {kind === null && (
        <div class="wdc-capture-hint">
          Open your <b>saved schedule</b> or <b>academic history</b> in Workday to capture it here.
        </div>
      )}

      {toast && <div class="wdc-capture-toast">{toast}</div>}

      {/* Detected schedule courses, by name */}
      <div class="wdc-capture-status">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>📅 Schedule: {scheduleSections.length} sections</span>
          <span style={{ display: 'flex', gap: '8px' }}>
            <button class="wdc-capture-link" onClick={() => setShowAddCourse(!showAddCourse)}>
              {showAddCourse ? 'close' : '＋ add course'}
            </button>
            {scheduleSections.length > 0 && (
              <button class="wdc-capture-link" onClick={clearSchedule} title="Clear captured schedule">
                clear
              </button>
            )}
          </span>
        </div>
        {showAddCourse && (
          <div class="wdc-capture-addcourse">
            <input
              placeholder="Course code, e.g. CS 2110"
              value={addCode}
              onInput={(e) => setAddCode((e.target as HTMLInputElement).value)}
            />
            <input
              placeholder="MWF 10:00 AM - 10:50 AM"
              value={addPattern}
              onInput={(e) => setAddPattern((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === 'Enter' && void submitAddCourse()}
            />
            {addError && <div class="wdc-edit-error">{addError}</div>}
            <button class="wdc-capture-btn" style={{ margin: '2px 0 0' }} onClick={() => void submitAddCourse()}>
              Add to calendar
            </button>
          </div>
        )}
        {scheduleSections.length > 0 && (
          <div class="wdc-capture-chips">
            {scheduleSections.map((s) => (
              <span class="wdc-capture-chip" title={s.title}>
                {s.courseCode}
              </span>
            ))}
          </div>
        )}
        {schedule && <div class="wdc-capture-sub">captured {ago(schedule.capturedAt)}</div>}

        <div style={{ marginTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>
            🎓 History:{' '}
            {history ? `${history.courses.length} courses · ${ago(history.capturedAt)}` : 'not captured'}
            {history?.source === 'upload' ? ' (upload)' : ''}
          </span>
          <span style={{ display: 'flex', gap: '8px' }}>
            {editHistory === null ? (
              <>
                {history && history.courses.length > 0 && (
                  <button class="wdc-capture-link" onClick={() => setShowHistory(!showHistory)}>
                    {showHistory ? 'hide' : 'view all'}
                  </button>
                )}
                <button class="wdc-capture-link" onClick={startEditHistory}>
                  edit
                </button>
              </>
            ) : (
              <>
                <button class="wdc-capture-link" onClick={saveHistory}>
                  save
                </button>
                <button class="wdc-capture-link" onClick={() => setEditHistory(null)}>
                  cancel
                </button>
              </>
            )}
          </span>
        </div>

        {editHistory !== null ? (
          <div class="wdc-capture-history">
            {editHistory.map((c, i) => (
              <div class="wdc-hist-edit-row">
                <input
                  class="wdc-hist-code"
                  value={c.code}
                  placeholder="CODE"
                  onInput={(e) => editHistoryField(i, { code: (e.target as HTMLInputElement).value })}
                />
                <input
                  class="wdc-hist-grade"
                  value={c.grade ?? ''}
                  placeholder="grade"
                  onInput={(e) => editHistoryField(i, { grade: (e.target as HTMLInputElement).value || null })}
                />
                <select
                  class="wdc-hist-status"
                  value={c.status}
                  onChange={(e) => editHistoryField(i, { status: (e.target as HTMLSelectElement).value as HistoryCourse['status'] })}
                >
                  <option value="completed">done</option>
                  <option value="in-progress">in prog</option>
                  <option value="withdrawn">W</option>
                  <option value="unknown">?</option>
                </select>
                <button class="wdc-edit-del" onClick={() => setEditHistory((rows) => rows!.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            ))}
            <button
              class="wdc-capture-link"
              style={{ padding: '4px 8px' }}
              onClick={() =>
                setEditHistory((rows) => [
                  ...rows!,
                  { code: '', title: '', credits: null, grade: null, term: null, status: 'completed' },
                ])
              }
            >
              ＋ add course
            </button>
          </div>
        ) : (
          showHistory &&
          history && (
            <div class="wdc-capture-history">
              {history.courses.map((c) => (
                <div class="wdc-capture-history-row">
                  <b>{c.code}</b>
                  <span>
                    {c.grade ? c.grade : c.status === 'in-progress' ? 'in progress' : '—'}
                    {c.term ? ` · ${c.term}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      <div class="wdc-capture-actions">
        <button
          class="wdc-capture-link"
          onClick={() => (calendarPref.value = calendarVisible ? 'hidden' : 'shown')}
        >
          {calendarVisible ? 'Hide calendar' : '📅 Show calendar here'}
        </button>
        <button class="wdc-capture-link" onClick={() => setShowDiag(!showDiag)}>
          {showDiag ? 'Hide diagnostics' : 'Diagnostics'}
        </button>
      </div>
      <div class="wdc-capture-actions" style={{ borderTop: 'none', paddingTop: 0 }}>
        <button
          class="wdc-capture-link"
          onClick={() => void sendToBackground({ kind: 'OPEN_PLANNER' }).catch(() => {})}
        >
          🎓 Open degree planner
        </button>
        {settings?.rmpEnabled && (
          <button
            class="wdc-capture-link"
            onClick={() => (rmpPanelSignal.value = !rmpPanelSignal.value)}
          >
            ⭐ Rate professors
          </button>
        )}
      </div>

      {showDiag && (
        <div class="wdc-capture-diag">
          <div>Detected page: <b>{page}</b></div>
          <div>Result rows found here: <b>{countCandidateRows(document)}</b></div>
          <div>Schedule tables found: <b>{queryAll(document, 'savedScheduleTable').length}</b></div>
          <div>History tables found: <b>{queryAll(document, 'academicHistoryTable').length}</b></div>
          <div>
            RMP school set:{' '}
            <b>{settings?.rmpSchool ? settings.rmpSchool.name : 'no — set it in Options'}</b>
          </div>
          <div class="wdc-capture-sub" style={{ marginTop: '4px' }}>
            If page is “unknown” or counts are 0, this school's Workday layout isn't recognized — add
            selector overrides in Options → Advanced, or send this page's HTML to calibrate.
          </div>
        </div>
      )}
    </div>
  );
}
