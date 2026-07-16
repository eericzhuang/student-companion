/**
 * Floating, draggable, collapsible calendar panel showing the saved schedule.
 * Position/collapse state persists via settings.panelState. Live-updates on
 * storage changes; hover ghosts are pushed in via the module-level signal.
 *
 * Beyond the week grid: clicking an event opens its details (professor + live
 * RMP rating, room, times); the Route view maps the day's buildings and warns
 * when the break between classes is shorter than the estimated walk.
 */
import { signal } from '@preact/signals';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type {
  CampusMap,
  DayMask,
  Meeting,
  PanelState,
  ScheduleSnapshot,
  Section,
  Settings,
} from '../../shared/types';
import { getStored, onStoredChange } from '../../shared/storage';
import { sendToBackground, type MapLookupResult, type RmpLookupResult } from '../../background/messages';
import { computeFreeSlots, dayMaskToLabels, formatMinutes } from '../../shared/time';
import {
  buildingOf,
  DAY_LABELS,
  dayTransitions,
  DEFAULT_WALK_KMH,
  type Transition,
} from '../../shared/route';
import { rmpProfessorUrl } from '../../shared/rmpUrl';
import { addManualSection, removeSection, renameSection } from './scheduleEdit';
import { useDraggable, type Pos } from './useDraggable';
import { WeekGrid } from './WeekGrid';
import { isPro } from '../../shared/plan';

/** Search-result section currently hovered (set by decorateRows). */
export const ghostSection = signal<Section | null>(null);

type CalView = 'grid' | 'free' | 'map' | 'edit';

export function CalendarPanel() {
  const [schedule, setSchedule] = useState<ScheduleSnapshot | null>(null);
  const [view, setView] = useState<CalView>('grid');
  const [collapsed, setCollapsed] = useState(false);
  const [pro, setPro] = useState(false);
  const [campusMap, setCampusMapState] = useState<CampusMap | null>(null);
  const [walkSpeed, setWalkSpeed] = useState(DEFAULT_WALK_KMH);
  const [selEvent, setSelEvent] = useState<{ section: Section; meeting: Meeting } | null>(null);

  const defaultPos = { x: Math.max(8, window.innerWidth - 456), y: 80 };
  const { pos, setPos, startDrag, wasDragged } = useDraggable(defaultPos, (p) =>
    persist(p, collapsed),
  );

  useEffect(() => {
    void getStored('schedule').then(setSchedule);
    void getStored('campusMap').then(setCampusMapState);
    const applySettings = (s: Settings) => {
      setPro(isPro(s)); // animations are a Pro perk
      setWalkSpeed(s.walkSpeedKmh ?? DEFAULT_WALK_KMH);
    };
    void getStored('settings').then((s) => {
      if (s.panelState.x >= 0 && s.panelState.y >= 0) setPos({ x: s.panelState.x, y: s.panelState.y });
      setCollapsed(s.panelState.collapsed);
      applySettings(s);
    });
    const un1 = onStoredChange('schedule', setSchedule);
    const un2 = onStoredChange('campusMap', setCampusMapState);
    const un3 = onStoredChange('settings', applySettings);
    return () => {
      un1();
      un2();
      un3();
    };
  }, []);

  const persist = (p: Pos, isCollapsed: boolean) => {
    const next: PanelState = { x: p.x, y: p.y, collapsed: isCollapsed };
    void sendToBackground({ kind: 'PANEL_STATE_UPDATE', panelState: next }).catch(() => {});
  };

  const setCollapsedPersist = (value: boolean) => {
    setCollapsed(value);
    persist(pos, value);
  };

  const sections = schedule?.sections ?? [];

  // Between-class walk analysis (recomputed whenever schedule/map/speed change).
  const transitions = useMemo(
    () => dayTransitions(sections, campusMap?.buildings ?? {}, walkSpeed),
    [sections, campusMap, walkSpeed],
  );
  const gridWarnings = useMemo(() => {
    const map = new Map<string, { text: string; miss: boolean }>();
    for (const t of transitions) {
      if (t.risk !== 'miss' && t.risk !== 'tight') continue;
      map.set(t.toKey, {
        miss: t.risk === 'miss',
        text: `${t.dayLabel}: ${t.breakMin} min break after ${t.fromCode}, but ~${Math.round(
          t.walkMin ?? 0,
        )} min walk from ${t.fromBuilding}${t.risk === 'miss' ? ' — you may miss the start' : ' — it will be tight'}`,
      });
    }
    return map;
  }, [transitions]);

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
          <button class={view === 'map' ? 'active' : ''} onClick={() => setView('map')}>
            🗺 Route
          </button>
          <button class={view === 'edit' ? 'active' : ''} onClick={() => setView('edit')}>
            Edit
          </button>
        </span>
      </div>
      {selEvent && view === 'grid' && (
        <EventDetails section={selEvent.section} meeting={selEvent.meeting} onClose={() => setSelEvent(null)} />
      )}
      {sections.length === 0 && view !== 'edit' ? (
        <div class="wdc-empty">
          No saved schedule captured yet.
          <br />
          Open your <b>saved schedule</b> page in Workday, or add courses in <b>Edit</b>.
        </div>
      ) : view === 'grid' ? (
        <WeekGrid
          sections={sections}
          ghost={ghostSection.value}
          warnings={gridWarnings}
          onEventClick={(section, meeting) => setSelEvent({ section, meeting })}
        />
      ) : view === 'free' ? (
        <FreeTimeList sections={sections} />
      ) : view === 'map' ? (
        <RouteMap sections={sections} campusMap={campusMap} transitions={transitions} pro={pro} />
      ) : (
        <ScheduleEditList sections={sections} />
      )}
    </div>
  );
}

/** Event details: professor + live RMP rating, room, and meeting times. */
function EventDetails({
  section,
  meeting,
  onClose,
}: {
  section: Section;
  meeting: Meeting;
  onClose: () => void;
}) {
  const [rmp, setRmp] = useState<RmpLookupResult | null>(null);

  useEffect(() => {
    setRmp(null);
    if (section.instructor) {
      void sendToBackground<RmpLookupResult>({ kind: 'RMP_LOOKUP', instructorName: section.instructor })
        .then(setRmp)
        .catch(() => setRmp(null));
    }
  }, [section.sectionId, section.instructor]);

  const t = rmp?.entry?.teacher ?? null;
  const url = t ? rmpProfessorUrl(t.teacherId) : null;

  return (
    <div class="wdc-event-pop">
      <div class="wdc-event-pop-head">
        <b>
          {section.courseCode}
          {section.title && section.title !== section.courseCode ? ` · ${section.title}` : ''}
        </b>
        <button title="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div class="wdc-event-pop-row">
        🕐 {dayMaskToLabels(meeting.days).join('')} {formatMinutes(meeting.startMin)}–{formatMinutes(meeting.endMin)}
      </div>
      {meeting.location && <div class="wdc-event-pop-row">📍 {meeting.location}</div>}
      <div class="wdc-event-pop-row">
        👤 {section.instructor ?? <i>instructor not captured</i>}
        {section.instructor && !rmp && <span class="wdc-event-rmp"> · looking up rating…</span>}
        {t && (
          <span class="wdc-event-rmp">
            {' '}
            · ★ {t.avgRating?.toFixed(1) ?? '–'}
            {t.avgDifficulty != null && <> · difficulty {t.avgDifficulty.toFixed(1)}</>}
            {t.wouldTakeAgainPercent != null && <> · {Math.round(t.wouldTakeAgainPercent)}% would take again</>}{' '}
            ({t.numRatings}){' '}
            {url && (
              <a href={url} target="_blank" rel="noreferrer">
                RMP ↗
              </a>
            )}
          </span>
        )}
        {rmp && rmp.entry && !t && <span class="wdc-event-rmp"> · no RMP match</span>}
        {rmp?.needsSetup && <span class="wdc-event-rmp"> · pick your school in ⚙ Options for ratings</span>}
      </div>
    </div>
  );
}

/**
 * Route view: the day's buildings as pins on a simple scatter map (no external
 * tiles), the walking order, and every between-class transition with its
 * break-vs-walk verdict.
 */
function RouteMap({
  sections,
  campusMap,
  transitions,
  pro,
}: {
  sections: Section[];
  campusMap: CampusMap | null;
  transitions: Transition[];
  pro: boolean;
}) {
  const daysPresent = DAY_LABELS.filter((d) => sections.some((s) => s.meetings.some((m) => m.days & d.mask)));
  const [dayMask, setDayMask] = useState<DayMask | null>(daysPresent[0]?.mask ?? null);
  const [busy, setBusy] = useState<null | 'osm' | 'ai'>(null);
  const [note, setNote] = useState<string | null>(null);

  const buildings = campusMap?.buildings ?? {};
  const allBuildings = useMemo(
    () => [
      ...new Set(
        sections.flatMap((s) => s.meetings.filter((m) => m.location).map((m) => buildingOf(m.location!))),
      ),
    ],
    [sections],
  );
  const missing = allBuildings.filter((b) => !buildings[b]);

  const locate = async (kind: 'osm' | 'ai') => {
    setBusy(kind);
    setNote(null);
    try {
      const res = await sendToBackground<MapLookupResult>(
        kind === 'osm' ? { kind: 'MAP_GEOCODE', buildings: allBuildings } : { kind: 'MAP_RESEARCH', buildings: missing },
      );
      setNote(
        res.missing.length === 0
          ? 'All buildings located ✓'
          : `Still missing: ${res.missing.join(', ')} — ${
              kind === 'osm' ? 'try 🤖 AI locate, or ' : ''
            }add coordinates in ⚙ Options → Campus map.`,
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  // The selected day's stops, in class order (deduped consecutive repeats).
  const dayStops = useMemo(() => {
    if (!dayMask) return [];
    const events = sections
      .flatMap((s) => s.meetings.filter((m) => (m.days & dayMask) && m.location).map((m) => ({ s, m })))
      .sort((a, b) => a.m.startMin - b.m.startMin);
    const stops: Array<{ building: string; code: string; startMin: number }> = [];
    for (const { s, m } of events) {
      const b = buildingOf(m.location!);
      if (stops.length === 0 || stops[stops.length - 1]!.building !== b) {
        stops.push({ building: b, code: s.courseCode, startMin: m.startMin });
      }
    }
    return stops;
  }, [sections, dayMask]);

  const located = dayStops.filter((s) => buildings[s.building]);
  const dayTrans = transitions.filter((t) => t.dayMask === dayMask);

  // Normalize coordinates into an SVG viewport.
  const W = 400;
  const H = 230;
  const PAD = 26;
  const pts = located.map((s) => ({ ...s, ...buildings[s.building]! }));
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const span = (min: number, max: number) => (max - min < 1e-6 ? 1e-6 : max - min);
  const x = (lng: number) =>
    PAD + ((lng - Math.min(...lngs)) / span(Math.min(...lngs), Math.max(...lngs))) * (W - 2 * PAD);
  const y = (lat: number) =>
    H - PAD - ((lat - Math.min(...lats)) / span(Math.min(...lats), Math.max(...lats))) * (H - 2 * PAD);

  const riskIcon = (r: Transition['risk']) =>
    r === 'miss' ? '🚨' : r === 'tight' ? '⚠️' : r === 'ok' ? '✅' : '❓';

  if (allBuildings.length === 0) {
    return (
      <div class="wdc-map">
        <div class="wdc-empty">
          No room locations captured yet — they appear when Workday shows meeting locations (or add
          them to the pattern in <b>Edit</b>, e.g. "MWF 10:00 AM - 10:50 AM | Baker Hall 200").
        </div>
      </div>
    );
  }

  return (
    <div class="wdc-map">
      <div class="wdc-map-controls">
        <span class="wdc-map-days">
          {daysPresent.map((d) => (
            <button class={dayMask === d.mask ? 'active' : ''} onClick={() => setDayMask(d.mask)}>
              {d.label}
            </button>
          ))}
        </span>
        <span>
          <button class="wdc-capture-btn wdc-map-btn" disabled={busy !== null} onClick={() => void locate('osm')}>
            {busy === 'osm' ? 'Locating…' : '📍 Locate buildings (free)'}
          </button>
          {missing.length > 0 && pro && (
            <button class="wdc-capture-btn wdc-map-btn" disabled={busy !== null} onClick={() => void locate('ai')}>
              {busy === 'ai' ? 'Researching…' : `🤖 AI locate ${missing.length} missing`}
            </button>
          )}
        </span>
      </div>
      {note && <div class="wdc-map-note">{note}</div>}

      {pts.length > 0 ? (
        <svg class="wdc-map-svg" viewBox={`0 0 ${W} ${H}`}>
          {pts.length > 1 && (
            <polyline
              points={pts.map((p) => `${x(p.lng)},${y(p.lat)}`).join(' ')}
              fill="none"
              stroke="var(--wdc-accent, #0f4c81)"
              stroke-width="2"
              stroke-dasharray="6 4"
            />
          )}
          {pts.map((p, i) => (
            <g>
              <circle cx={x(p.lng)} cy={y(p.lat)} r="11" fill="var(--wdc-accent, #0f4c81)" />
              <text x={x(p.lng)} y={y(p.lat) + 4} text-anchor="middle" fill="#fff" font-size="11" font-weight="700">
                {i + 1}
              </text>
              <text x={x(p.lng)} y={y(p.lat) - 15} text-anchor="middle" font-size="10" fill="#334155">
                {p.building}
              </text>
            </g>
          ))}
        </svg>
      ) : (
        <div class="wdc-map-note">
          No located buildings for this day yet — hit <b>📍 Locate buildings</b> above.
        </div>
      )}

      <div class="wdc-map-list">
        {dayTrans.length === 0 && <div class="wdc-map-note">No back-to-back classes this day.</div>}
        {dayTrans.map((t) => (
          <div class={`wdc-map-row wdc-risk-${t.risk}`}>
            {riskIcon(t.risk)} <b>{t.fromCode}</b> → <b>{t.toCode}</b>: {t.breakMin} min break
            {t.walkMin != null ? (
              <>
                , ~{Math.round(t.walkMin)} min walk
                {t.fromBuilding && t.toBuilding && t.fromBuilding !== t.toBuilding && (
                  <> ({t.fromBuilding} → {t.toBuilding})</>
                )}
                {t.risk === 'miss' && <b> — you may miss the start!</b>}
                {t.risk === 'tight' && <b> — tight, no dawdling</b>}
              </>
            ) : (
              <> — walk unknown (locate the buildings above)</>
            )}
          </div>
        ))}
      </div>
      <div class="wdc-map-note wdc-map-fine">
        Walk times are straight-line estimates × 1.3 — adjust your walking speed in ⚙ Options.
      </div>
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
          placeholder="MWF 10:00 AM - 10:50 AM | Baker Hall 200"
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
