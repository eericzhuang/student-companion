/**
 * Floating, draggable, collapsible calendar panel showing the saved schedule.
 * Position/collapse state persists via settings.panelState. Live-updates on
 * storage changes; hover ghosts are pushed in via the module-level signal.
 */
import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import type { PanelState, ScheduleSnapshot, Section } from '../../shared/types';
import { getStored, onStoredChange } from '../../shared/storage';
import { sendToBackground } from '../../background/messages';
import { computeFreeSlots, dayMaskToLabels, formatMinutes } from '../../shared/time';
import { addManualSection, removeSection, renameSection } from './scheduleEdit';
import { useDraggable, type Pos } from './useDraggable';
import { WeekGrid } from './WeekGrid';
import { isPro } from '../../shared/plan';

/** Search-result section currently hovered (set by decorateRows). */
export const ghostSection = signal<Section | null>(null);

type CalView = 'grid' | 'free' | 'edit';

export function CalendarPanel() {
  const [schedule, setSchedule] = useState<ScheduleSnapshot | null>(null);
  const [view, setView] = useState<CalView>('grid');
  const [collapsed, setCollapsed] = useState(false);
  const [pro, setPro] = useState(false);

  const defaultPos = { x: Math.max(8, window.innerWidth - 456), y: 80 };
  const { pos, setPos, startDrag, wasDragged } = useDraggable(defaultPos, (p) =>
    persist(p, collapsed),
  );

  useEffect(() => {
    void getStored('schedule').then(setSchedule);
    void getStored('settings').then((s) => {
      if (s.panelState.x >= 0 && s.panelState.y >= 0) setPos({ x: s.panelState.x, y: s.panelState.y });
      setCollapsed(s.panelState.collapsed);
      setPro(isPro(s)); // animations are a Pro perk
    });
    return onStoredChange('schedule', setSchedule);
  }, []);

  const persist = (p: Pos, isCollapsed: boolean) => {
    const next: PanelState = { x: p.x, y: p.y, collapsed: isCollapsed };
    void sendToBackground({ kind: 'PANEL_STATE_UPDATE', panelState: next }).catch(() => {});
  };

  const setCollapsedPersist = (value: boolean) => {
    setCollapsed(value);
    persist(pos, value);
  };

  if (collapsed) {
    return (
      <div
        class={`wdc-collapsed-pill${pro ? ' wdc-pro' : ''}`}
        // width/height auto overrides any inline size left from resizing.
        style={{ left: `${pos.x}px`, top: `${pos.y}px`, width: 'auto', height: 'auto' }}
        onPointerDown={startDrag}
        onClick={() => !wasDragged() && setCollapsedPersist(false)}
      >
        📅 Schedule ({schedule?.sections.length ?? 0})
      </div>
    );
  }

  const sections = schedule?.sections ?? [];

  return (
    <div class={`wdc-panel${pro ? ' wdc-pro' : ''}`} style={{ left: `${pos.x}px`, top: `${pos.y}px` }}>
      <div class="wdc-panel-header" onPointerDown={startDrag}>
        <span>📅 My Saved Schedule</span>
        <button onClick={() => setCollapsedPersist(true)}>—</button>
      </div>
      <div class="wdc-panel-sub" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>
          {sections.length} section{sections.length === 1 ? '' : 's'}
          {schedule?.termLabel ? ` · ${schedule.termLabel}` : ''}
        </span>
        <span class="wdc-view-toggle">
          <button class={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}>
            Calendar
          </button>
          <button class={view === 'free' ? 'active' : ''} onClick={() => setView('free')}>
            Free time
          </button>
          <button class={view === 'edit' ? 'active' : ''} onClick={() => setView('edit')}>
            Edit
          </button>
        </span>
      </div>
      {sections.length === 0 && view !== 'edit' ? (
        <div class="wdc-empty">
          No saved schedule captured yet.
          <br />
          Open your <b>saved schedule</b> page in Workday, or add courses in <b>Edit</b>.
        </div>
      ) : view === 'grid' ? (
        <WeekGrid sections={sections} ghost={ghostSection.value} />
      ) : view === 'free' ? (
        <FreeTimeList sections={sections} />
      ) : (
        <ScheduleEditList sections={sections} />
      )}
    </div>
  );
}

/** Add / remove / rename captured sections by hand. */
function ScheduleEditList({ sections }: { sections: Section[] }) {
  const [code, setCode] = useState('');
  const [pattern, setPattern] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const err = await addManualSection(code, pattern);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setCode('');
    setPattern('');
  };

  const summarize = (s: Section) =>
    s.meetings
      .map((m) => `${dayMaskToLabels(m.days).join('')} ${formatMinutes(m.startMin)}–${formatMinutes(m.endMin)}`)
      .join(', ') || 'no time';

  return (
    <div class="wdc-edit">
      <div class="wdc-edit-list">
        {sections.map((s) => (
          <div class="wdc-edit-row">
            <input
              class="wdc-edit-code"
              value={s.courseCode}
              title="Rename course"
              onChange={(e) => void renameSection(s.sectionId, (e.target as HTMLInputElement).value)}
            />
            <span class="wdc-edit-time" title={summarize(s)}>
              {summarize(s)}
            </span>
            <button class="wdc-edit-del" title="Remove" onClick={() => void removeSection(s.sectionId)}>
              ✕
            </button>
          </div>
        ))}
        {sections.length === 0 && <div class="wdc-freetime-none" style={{ padding: '8px 12px' }}>No courses yet — add one below.</div>}
      </div>
      <div class="wdc-edit-add">
        <div class="wdc-edit-add-title">Add a course</div>
        <input
          placeholder="Course code, e.g. CS 2110"
          value={code}
          onInput={(e) => setCode((e.target as HTMLInputElement).value)}
        />
        <input
          placeholder="MWF 10:00 AM - 10:50 AM"
          value={pattern}
          onInput={(e) => setPattern((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        {error && <div class="wdc-edit-error">{error}</div>}
        <button class="wdc-capture-btn" style={{ margin: '4px 0 0' }} onClick={() => void add()}>
          ＋ Add to calendar
        </button>
      </div>
    </div>
  );
}

/** Lists open time windows per weekday — where the student could fit a course. */
function FreeTimeList({ sections }: { sections: Section[] }) {
  const days = computeFreeSlots(sections);
  return (
    <div class="wdc-freetime">
      {days.map((d) => (
        <div class="wdc-freetime-day">
          <div class="wdc-freetime-label">{d.label}</div>
          <div class="wdc-freetime-slots">
            {d.slots.length === 0 ? (
              <span class="wdc-freetime-none">— booked —</span>
            ) : (
              d.slots.map((s) => (
                <span class="wdc-freetime-slot">
                  {formatMinutes(s.startMin)} – {formatMinutes(s.endMin)}
                </span>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
