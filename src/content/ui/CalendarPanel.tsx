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
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type {
  BuilderPrefs,
  CampusMap,
  DayMask,
  FinalExam,
  Meeting,
  PanelState,
  Scenario,
  ScheduleSnapshot,
  Section,
  Settings,
  TermConfig,
} from '../../shared/types';
import { scenarioMetrics } from '../../shared/scenario';
import { getStored, onStoredChange } from '../../shared/storage';
import { sendToBackground, type MapLookupResult, type RmpLookupResult } from '../../background/messages';
import { computeFreeSlots, dayMaskToLabels, formatMinutes, parseMeetingPatterns } from '../../shared/time';
import { DEFAULT_PREFS, generateSchedules, type BuildResult } from '../../shared/builder';
import {
  buildingOf,
  DAY_LABELS,
  dayTransitions,
  DEFAULT_WALK_KMH,
  type Transition,
} from '../../shared/route';
import { ratingClass, rmpProfessorUrl } from '../../shared/rmpUrl';
import { cleanInstructorName, displayInstructorName } from '../../shared/fuzzy';
import { cleanSectionTitle } from '../../shared/schedule';
import { addFinal, addManualSection, removeFinal, removeSection, renameSection, updateSectionDetails } from './scheduleEdit';
import { finalConflictIds, formatFinalDate, sortFinals, timeInputToMinutes } from '../../shared/finals';
import { exportScheduleImage } from './exportImage';
import { buildIcs, defaultTermStart } from '../../shared/ics';
import { useDraggable, type Pos } from './useDraggable';
import { WeekGrid } from './WeekGrid';
import { isPro } from '../../shared/plan';

/** Search-result section currently hovered (set by decorateRows). */
export const ghostSection = signal<Section | null>(null);

type CalView = 'grid' | 'free' | 'map' | 'build' | 'plans' | 'edit';

export function CalendarPanel() {
  const [schedule, setSchedule] = useState<ScheduleSnapshot | null>(null);
  const [view, setView] = useState<CalView>('grid');
  const [collapsed, setCollapsed] = useState(false);
  const [pro, setPro] = useState(false);
  const [campusMap, setCampusMapState] = useState<CampusMap | null>(null);
  const [walkSpeed, setWalkSpeed] = useState(DEFAULT_WALK_KMH);
  const [selEvent, setSelEvent] = useState<{ section: Section; meeting: Meeting } | null>(null);
  // Stretch the grid with the panel: a taller panel zooms the blocks so they
  // can show room, professor, and rating inline.
  const panelRef = useRef<HTMLDivElement>(null);
  const [gridScale, setGridScale] = useState(1);
  const [ratings, setRatings] = useState<Map<string, number | null>>(new Map());
  const [terms, setTerms] = useState<TermConfig[]>([]);
  const [icsForm, setIcsForm] = useState<{ start: string; end: string } | null>(null);
  // Build-tab result being previewed in the grid instead of the real schedule
  const [preview, setPreview] = useState<{ label: string; sections: Section[] } | null>(null);

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
      setTerms(s.terms);
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

  // Track panel resizes → grid zoom (default panel height ≈ 460px). The CSS
  // resize handle changes the element size behind the framework's back, so
  // poll cheaply instead of trusting ResizeObserver (unavailable in some
  // embedded contexts); setState with an unchanged value re-renders nothing.
  useEffect(() => {
    const compute = () => {
      const el = panelRef.current;
      if (el) setGridScale(Math.round(Math.min(3, Math.max(1, (el.clientHeight - 90) / 370)) * 20) / 20);
    };
    compute();
    const id = setInterval(compute, 400);
    return () => clearInterval(id);
  }, [collapsed]);

  // Ratings for inline display on zoomed blocks (background caches lookups).
  const sectionsForRatings = schedule?.sections ?? [];
  useEffect(() => {
    const names = [...new Set(sectionsForRatings.map((s) => s.instructor).filter((n): n is string => !!n))];
    let cancelled = false;
    void (async () => {
      const next = new Map<string, number | null>();
      for (const name of names) {
        try {
          const res = await sendToBackground<RmpLookupResult>({ kind: 'RMP_LOOKUP', instructorName: name });
          next.set(name, res.entry?.teacher?.avgRating ?? null);
        } catch {
          next.set(name, null);
        }
      }
      if (!cancelled) setRatings(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [sectionsForRatings.map((s) => s.instructor).join('|')]);

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

  // .ics export: use the configured term's dates when known, otherwise ask once
  // (and remember the answer on the matching term).
  const icsTerm = (): TermConfig | null =>
    terms.find((t) => schedule?.termLabel && t.label === schedule.termLabel) ?? terms[0] ?? null;

  const downloadIcs = (termStart?: string, termEnd?: string) => {
    const ics = buildIcs(sections, {
      termStart,
      termEnd,
      termLabel: schedule?.termLabel ?? null,
      finals: schedule?.finals ?? [],
    });
    const blob = new Blob([ics], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule${schedule?.termLabel ? `-${schedule.termLabel.replace(/\s+/g, '-').toLowerCase()}` : ''}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const onIcsClick = () => {
    const t = icsTerm();
    if (t?.startDate) {
      downloadIcs(t.startDate, t.endDate);
      return;
    }
    const start = defaultTermStart(new Date());
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 16 * 7);
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    setIcsForm({ start: iso(start), end: iso(end) });
  };

  const submitIcs = () => {
    if (!icsForm) return;
    downloadIcs(icsForm.start, icsForm.end);
    const t = icsTerm();
    if (t) {
      void sendToBackground({
        kind: 'SETTINGS_UPDATE',
        patch: {
          terms: terms.map((x) => (x.id === t.id ? { ...x, startDate: icsForm.start, endDate: icsForm.end } : x)),
        },
      }).catch(() => {});
    }
    setIcsForm(null);
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

  return (
    <div ref={panelRef} class={`wdc-panel${pro ? ' wdc-pro' : ''}`} style={{ left: `${pos.x}px`, top: `${pos.y}px` }}>
      <div class="wdc-panel-header" onPointerDown={startDrag}>
        <span>📅 My Saved Schedule</span>
        <span>
          <button
            title="Save the calendar as an image (with rooms, professors, ratings, and warnings)"
            disabled={sections.length === 0}
            onClick={() =>
              exportScheduleImage({
                sections,
                termLabel: schedule?.termLabel ?? null,
                ratings,
                warningTexts: [...gridWarnings.values()].map((w) => w.text),
              })
            }
          >
            📷
          </button>{' '}
          <button
            title="Export to your calendar app (.ics for Google/Apple/Outlook)"
            disabled={sections.length === 0}
            onClick={onIcsClick}
          >
            📆
          </button>{' '}
          <button onClick={() => setCollapsedPersist(true)}>—</button>
        </span>
      </div>
      {icsForm && (
        <div class="wdc-ics-form">
          <div class="wdc-ics-title">When does {schedule?.termLabel ?? 'the term'} run?</div>
          <label>
            First day
            <input
              type="date"
              value={icsForm.start}
              onInput={(e) => setIcsForm({ ...icsForm, start: (e.target as HTMLInputElement).value })}
            />
          </label>
          <label>
            Last day
            <input
              type="date"
              value={icsForm.end}
              onInput={(e) => setIcsForm({ ...icsForm, end: (e.target as HTMLInputElement).value })}
            />
          </label>
          <span>
            <button class="wdc-capture-btn wdc-map-btn" onClick={submitIcs}>
              ⬇ Download .ics
            </button>{' '}
            <button class="wdc-link-btn" onClick={() => setIcsForm(null)}>
              cancel
            </button>
          </span>
        </div>
      )}
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
          <button class={view === 'build' ? 'active' : ''} onClick={() => setView('build')}>
            🧩 Build
          </button>
          <button class={view === 'plans' ? 'active' : ''} onClick={() => setView('plans')}>
            Plans
          </button>
          <button class={view === 'edit' ? 'active' : ''} onClick={() => setView('edit')}>
            Edit
          </button>
        </span>
      </div>
      {selEvent && view === 'grid' && (
        <EventDetails section={selEvent.section} meeting={selEvent.meeting} onClose={() => setSelEvent(null)} />
      )}
      {preview && view === 'grid' && (
        <div class="wdc-preview-banner">
          👁 Previewing <b>{preview.label}</b> — your real schedule is untouched.{' '}
          <button class="wdc-link-btn" onClick={() => setPreview(null)}>
            close preview
          </button>
        </div>
      )}
      {sections.length === 0 && view !== 'edit' && view !== 'plans' && view !== 'build' && !preview ? (
        <div class="wdc-empty">
          No saved schedule captured yet.
          <br />
          Open your <b>saved schedule</b> page in Workday, or add courses in <b>Edit</b>.
        </div>
      ) : view === 'grid' ? (
        <>
          <WeekGrid
            sections={preview ? preview.sections : sections}
            ghost={preview ? null : ghostSection.value}
            warnings={preview ? undefined : gridWarnings}
            scale={gridScale}
            ratings={ratings}
            onEventClick={(section, meeting) => setSelEvent({ section, meeting })}
          />
          {!preview && (schedule?.finals?.length ?? 0) > 0 && <FinalsStrip finals={schedule!.finals!} />}
        </>
      ) : view === 'free' ? (
        <FreeTimeList sections={sections} />
      ) : view === 'map' ? (
        <RouteMap sections={sections} campusMap={campusMap} transitions={transitions} />
      ) : view === 'build' ? (
        <BuilderView
          schedule={schedule}
          ratings={ratings}
          campusMap={campusMap}
          walkSpeed={walkSpeed}
          onPreview={(label, secs) => {
            setPreview({ label, sections: secs });
            setView('grid');
          }}
        />
      ) : view === 'plans' ? (
        <ScenarioList
          schedule={schedule}
          ratings={ratings}
          campusMap={campusMap}
          walkSpeed={walkSpeed}
        />
      ) : (
        <ScheduleEditList sections={sections} finals={schedule?.finals ?? []} />
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
  const title = cleanSectionTitle(section.courseCode, section.title);

  return (
    <div class="wdc-event-pop">
      <div class="wdc-event-pop-head">
        <b>
          {section.courseCode}
          {title && title !== section.courseCode ? ` · ${title}` : ''}
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
        👤 {section.instructor ? displayInstructorName(section.instructor) : <i>instructor not captured</i>}
        {section.instructor && !rmp && <span class="wdc-event-rmp"> · looking up rating…</span>}
        {t && (
          <span class="wdc-event-rmp">
            {' '}
            · <b class={`wdc-rate-${ratingClass(t.avgRating)}`}>★ {t.avgRating?.toFixed(1) ?? '–'}</b>
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
 * Route view: the selected day's itinerary — every class in order with the
 * walk between buildings shown as distance + estimated time and a verdict
 * (comfortable / tight / you may miss it). Each leg links to real walking
 * directions on Google Maps. No tiles are embedded; coordinates come from
 * free OSM geocoding (or manual entry in Options).
 */
function RouteMap({
  sections,
  campusMap,
  transitions,
}: {
  sections: Section[];
  campusMap: CampusMap | null;
  transitions: Transition[];
}) {
  const daysPresent = DAY_LABELS.filter((d) => sections.some((s) => s.meetings.some((m) => m.days & d.mask)));
  const [dayMask, setDayMask] = useState<DayMask | null>(daysPresent[0]?.mask ?? null);
  const [busy, setBusy] = useState(false);
  const [openPath, setOpenPath] = useState<string | null>(null);
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

  const locate = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await sendToBackground<MapLookupResult>({ kind: 'MAP_GEOCODE', buildings: allBuildings });
      setNote(
        res.missing.length === 0
          ? 'All buildings located ✓'
          : `Couldn't locate: ${res.missing.join(', ')} — add their coordinates in ⚙ Options → Campus map.`,
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // The selected day's classes in order; legs between them come from the
  // precomputed transitions (same sort order, so they pair up by index).
  const dayEvents = useMemo(() => {
    if (!dayMask) return [];
    return sections
      .flatMap((s) => s.meetings.filter((m) => m.days & dayMask).map((m) => ({ s, m })))
      .sort((a, b) => a.m.startMin - b.m.startMin);
  }, [sections, dayMask]);
  const dayTrans = transitions.filter((t) => t.dayMask === dayMask);

  const fmtDist = (m: number) =>
    m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km · ${(m / 1609.34).toFixed(1)} mi`;
  const gmaps = (t: Transition): string | null => {
    const a = t.fromBuilding ? buildings[t.fromBuilding] : null;
    const b = t.toBuilding ? buildings[t.toBuilding] : null;
    if (!a || !b) return null;
    return `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&travelmode=walking`;
  };
  const riskIcon = (r: Transition['risk']) =>
    r === 'miss' ? '🚨' : r === 'tight' ? '⚠️' : r === 'ok' ? '✅' : '❓';

  const walked = dayTrans.filter((t) => (t.distanceM ?? 0) > 0);
  const totalM = walked.reduce((sum, t) => sum + (t.distanceM ?? 0), 0);
  const totalMin = walked.reduce((sum, t) => sum + (t.walkMin ?? 0), 0);

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
          {missing.length === 0 ? (
            <span class="wdc-map-located">✓ {allBuildings.length === 1 ? 'building' : `all ${allBuildings.length} buildings`} located</span>
          ) : (
            <button class="wdc-capture-btn wdc-map-btn" disabled={busy} onClick={() => void locate()}>
              {busy ? 'Locating…' : `📍 Locate ${missing.length} building${missing.length === 1 ? '' : 's'} (free)`}
            </button>
          )}
        </span>
      </div>
      {note && <div class="wdc-map-note">{note}</div>}
      {!note && missing.length > 0 && (
        <div class="wdc-map-note">
          <b>Locate</b> looks up each building's coordinates on OpenStreetMap so the walks below get
          real distances and times. Still needed: {missing.join(', ')}.
        </div>
      )}

      <div class="wdc-itin">
        {dayEvents.map(({ s, m }, i) => {
          const leg = i > 0 ? dayTrans[i - 1] : null;
          return (
            <>
              {leg && (
                <div class={`wdc-itin-leg wdc-risk-${leg.risk}`}>
                  <span class="wdc-itin-legline" />
                  <span>
                    {riskIcon(leg.risk)} {leg.breakMin} min break
                    {leg.walkMin != null && leg.distanceM != null ? (
                      leg.distanceM === 0 ? (
                        <> · same building</>
                      ) : (
                        <>
                          {' '}
                          · <b>~{Math.round(leg.walkMin)} min walk</b> · {fmtDist(leg.distanceM)}
                          {leg.risk === 'miss' && <b> — you may miss the start!</b>}
                          {leg.risk === 'tight' && <b> — tight</b>}
                          {gmaps(leg) && (
                            <>
                              {' '}
                              <a href={gmaps(leg)!} target="_blank" rel="noreferrer">
                                directions ↗
                              </a>{' '}
                              <button
                                class="wdc-link-btn"
                                onClick={() => setOpenPath(openPath === leg.toKey ? null : leg.toKey)}
                              >
                                {openPath === leg.toKey ? 'hide path' : '🗺 show path'}
                              </button>
                            </>
                          )}
                        </>
                      )
                    ) : (
                      <> · walk unknown — locate the buildings above</>
                    )}
                  </span>
                </div>
              )}
              {leg && openPath === leg.toKey && leg.fromBuilding && leg.toBuilding && buildings[leg.fromBuilding] && buildings[leg.toBuilding] && (
                <LegPath from={buildings[leg.fromBuilding]!} to={buildings[leg.toBuilding]!} fmtDist={fmtDist} />
              )}
              <div class="wdc-itin-stop">
                <span class="wdc-itin-num">{i + 1}</span>
                <span class="wdc-itin-time">{formatMinutes(m.startMin)}</span>
                <b>{s.courseCode}</b>
                <span class="wdc-itin-bld">
                  {m.location ? buildingOf(m.location) : <i>no location</i>}
                  {m.location && !buildings[buildingOf(m.location)] && ' ❓'}
                </span>
              </div>
            </>
          );
        })}
      </div>

      {walked.length > 0 && (
        <div class="wdc-map-note">
          <b>Day total:</b> ~{Math.round(totalMin)} min walking · {fmtDist(totalM)}
        </div>
      )}
      <div class="wdc-map-note wdc-map-fine">
        Estimates: straight-line distance × 1.3 at your walking speed (⚙ Options). ❓ = building not
        located yet.
      </div>
    </div>
  );
}

/**
 * Real walking path for one leg, fetched from the free OSRM demo server and
 * drawn as a small aspect-correct polyline (start = green, end = red).
 */
function LegPath({
  from,
  to,
  fmtDist,
}: {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  fmtDist: (m: number) => string;
}) {
  interface WalkRouteView {
    distanceM: number;
    durationMin: number;
    coords: Array<[number, number]>;
  }
  const [route, setRoute] = useState<WalkRouteView | null | 'loading'>('loading');

  useEffect(() => {
    let dead = false;
    setRoute('loading');
    void sendToBackground<WalkRouteView | null>({
      kind: 'MAP_ROUTE',
      from: { lat: from.lat, lng: from.lng },
      to: { lat: to.lat, lng: to.lng },
    })
      .then((r) => !dead && setRoute(r))
      .catch(() => !dead && setRoute(null));
    return () => {
      dead = true;
    };
  }, [from.lat, from.lng, to.lat, to.lng]);

  if (route === 'loading') return <div class="wdc-map-note">loading path…</div>;
  if (!route || route.coords.length < 2) {
    return <div class="wdc-map-note">Path unavailable right now — the directions link still works.</div>;
  }

  // Project to meters so the shape keeps its real aspect ratio.
  const midLat = (from.lat + to.lat) / 2;
  const mx = (lng: number) => lng * 111320 * Math.cos((midLat * Math.PI) / 180);
  const my = (lat: number) => lat * 110540;
  const xs = route.coords.map(([lng]) => mx(lng));
  const ys = route.coords.map(([, lat]) => my(lat));
  const W = 360;
  const H = 140;
  const PAD = 10;
  const spanX = Math.max(1, Math.max(...xs) - Math.min(...xs));
  const spanY = Math.max(1, Math.max(...ys) - Math.min(...ys));
  const k = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
  const ox = (W - spanX * k) / 2;
  const oy = (H - spanY * k) / 2;
  const px = (i: number) => ox + (xs[i]! - Math.min(...xs)) * k;
  const py = (i: number) => H - oy - (ys[i]! - Math.min(...ys)) * k;
  const pts = route.coords.map((_, i) => `${px(i).toFixed(1)},${py(i).toFixed(1)}`).join(' ');

  return (
    <div class="wdc-leg-path">
      <svg viewBox={`0 0 ${W} ${H}`}>
        <polyline points={pts} fill="none" stroke="var(--wdc-accent, #0f4c81)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx={px(0)} cy={py(0)} r="5" fill="#16a34a" />
        <circle cx={px(route.coords.length - 1)} cy={py(route.coords.length - 1)} r="5" fill="#dc2626" />
      </svg>
      <div class="wdc-map-note">
        Real path: <b>{fmtDist(route.distanceM)}</b> · ~{Math.round(route.durationMin)} min walk (OpenStreetMap)
      </div>
    </div>
  );
}

/** Add / remove / rename captured sections by hand. */
function ScheduleEditList({ sections, finals }: { sections: Section[]; finals: FinalExam[] }) {
  const [code, setCode] = useState('');
  const [pattern, setPattern] = useState('');
  const [location, setLocation] = useState('');
  const [instructor, setInstructor] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const loc = location.trim();
    const err = await addManualSection(code, loc ? `${pattern} | ${loc}` : pattern, instructor);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setCode('');
    setPattern('');
    setLocation('');
    setInstructor('');
  };

  const summarize = (s: Section) =>
    s.meetings
      .map((m) => `${dayMaskToLabels(m.days).join(' ')} ${formatMinutes(m.startMin)}–${formatMinutes(m.endMin)}`)
      .join(', ') || 'no time';

  return (
    <div class="wdc-edit">
      <div class="wdc-edit-list">
        {sections.map((s) => (
          <div class="wdc-edit-item">
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
            <div class="wdc-edit-row wdc-edit-details">
              <input
                placeholder="👤 Professor"
                title="Professor (used for the RMP rating)"
                value={s.instructor ? cleanInstructorName(s.instructor) : ''}
                onChange={(e) =>
                  void updateSectionDetails(s.sectionId, { instructor: (e.target as HTMLInputElement).value })
                }
              />
              <input
                placeholder="📍 Building + room"
                title="Location (used for walk-time warnings)"
                value={s.meetings[0]?.location ?? ''}
                onChange={(e) =>
                  void updateSectionDetails(s.sectionId, { location: (e.target as HTMLInputElement).value })
                }
              />
            </div>
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
          placeholder="Time, e.g. MWF 10:00 AM - 10:50 AM"
          value={pattern}
          onInput={(e) => setPattern((e.target as HTMLInputElement).value)}
        />
        <input
          placeholder="📍 Building + room (optional)"
          value={location}
          onInput={(e) => setLocation((e.target as HTMLInputElement).value)}
        />
        <input
          placeholder="👤 Professor (optional)"
          value={instructor}
          onInput={(e) => setInstructor((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        {error && <div class="wdc-edit-error">{error}</div>}
        <button class="wdc-capture-btn" style={{ margin: '4px 0 0' }} onClick={() => void add()}>
          ＋ Add to calendar
        </button>
      </div>
      <FinalsEditor sections={sections} finals={finals} />
    </div>
  );
}

/**
 * Final exams: date-specific sittings with their own clash detection —
 * finals rarely follow the weekly pattern, so they're entered separately.
 */
function FinalsEditor({ sections, finals }: { sections: Section[]; finals: FinalExam[] }) {
  const [code, setCode] = useState('');
  const [date, setDate] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('11:30');
  const [location, setLocation] = useState('');
  const [error, setError] = useState<string | null>(null);

  const conflicts = finalConflictIds(finals);
  const sorted = sortFinals(finals);

  const add = async () => {
    const s = timeInputToMinutes(start);
    const e = timeInputToMinutes(end);
    if (s === null || e === null) {
      setError('Pick the start and end times.');
      return;
    }
    const err = await addFinal(code, date, s, e, location);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setCode('');
    setDate('');
    setLocation('');
  };

  return (
    <div class="wdc-finals">
      <div class="wdc-edit-add-title">🎓 Final exams</div>
      {sorted.map((f) => (
        <div class={`wdc-finals-row${conflicts.has(f.id) ? ' clash' : ''}`}>
          <span class="wdc-finals-when">
            {formatFinalDate(f.date)} · {formatMinutes(f.startMin)}–{formatMinutes(f.endMin)}
          </span>
          <b>{f.code}</b>
          <span class="wdc-finals-loc">{f.location ?? ''}</span>
          {conflicts.has(f.id) && (
            <span title="Overlaps another final on the same day">⚠</span>
          )}
          <button class="wdc-edit-del" title="Remove" onClick={() => void removeFinal(f.id)}>
            ✕
          </button>
        </div>
      ))}
      {finals.length === 0 && (
        <div class="wdc-freetime-none">No finals entered yet — add them when the exam schedule is out.</div>
      )}
      <div class="wdc-finals-add">
        <input
          class="wdc-finals-code"
          placeholder="Course"
          list="wdc-finals-codes"
          value={code}
          onInput={(e) => setCode((e.target as HTMLInputElement).value)}
        />
        <datalist id="wdc-finals-codes">
          {sections.map((s) => (
            <option value={s.courseCode} />
          ))}
        </datalist>
        <input type="date" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
        <input type="time" value={start} onInput={(e) => setStart((e.target as HTMLInputElement).value)} />
        <input type="time" value={end} onInput={(e) => setEnd((e.target as HTMLInputElement).value)} />
        <input
          class="wdc-finals-locin"
          placeholder="📍 (optional)"
          value={location}
          onInput={(e) => setLocation((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <button class="wdc-capture-btn wdc-map-btn" onClick={() => void add()}>
          ＋
        </button>
      </div>
      {error && <div class="wdc-edit-error">{error}</div>}
    </div>
  );
}

/** Compact chronological finals list under the week grid (grid view). */
function FinalsStrip({ finals }: { finals: FinalExam[] }) {
  const conflicts = finalConflictIds(finals);
  return (
    <div class="wdc-finals-strip">
      <b>🎓 Finals:</b>{' '}
      {sortFinals(finals).map((f, i) => (
        <span class={conflicts.has(f.id) ? 'wdc-finals-clash' : ''}>
          {i > 0 && ' · '}
          {formatFinalDate(f.date)} {formatMinutes(f.startMin)} {f.code}
          {conflicts.has(f.id) && ' ⚠'}
        </span>
      ))}
      {conflicts.size > 0 && <span class="wdc-finals-clash"> — two finals overlap!</span>}
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

/**
 * Plans tab: save the current schedule as a named scenario (Plan A / Plan B),
 * compare saved plans side by side, and load one back into the calendar.
 * Loading auto-stashes unsaved work as its own scenario first.
 */
function ScenarioList({
  schedule,
  ratings,
  campusMap,
  walkSpeed,
}: {
  schedule: ScheduleSnapshot | null;
  ratings: Map<string, number | null>;
  campusMap: CampusMap | null;
  walkSpeed: number;
}) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [name, setName] = useState('');
  const [extraRatings, setExtraRatings] = useState<Map<string, number | null>>(new Map());

  useEffect(() => {
    void getStored('scenarios').then(setScenarios);
    return onStoredChange('scenarios', setScenarios);
  }, []);

  // Scenario sections may name professors the current schedule doesn't —
  // fetch their (cached) ratings so the compare table stays honest.
  useEffect(() => {
    const names = [
      ...new Set(
        scenarios
          .flatMap((sc) => sc.snapshot.sections.map((s) => s.instructor))
          .filter((n): n is string => !!n && !ratings.has(n)),
      ),
    ];
    if (names.length === 0) return;
    let cancelled = false;
    void (async () => {
      const next = new Map<string, number | null>();
      for (const n of names) {
        try {
          const res = await sendToBackground<RmpLookupResult>({ kind: 'RMP_LOOKUP', instructorName: n });
          next.set(n, res.entry?.teacher?.avgRating ?? null);
        } catch {
          next.set(n, null);
        }
      }
      if (!cancelled) setExtraRatings(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [scenarios.map((s) => s.id).join('|')]);

  const allRatings = useMemo(() => {
    const merged = new Map(ratings);
    for (const [k, v] of extraRatings) if (!merged.has(k)) merged.set(k, v);
    return merged;
  }, [ratings, extraRatings]);

  const buildings = campusMap?.buildings ?? {};
  const rows = useMemo(() => {
    const list: Array<{ id: string | null; name: string; sections: Section[]; createdAt: number | null }> = [];
    if (schedule && schedule.sections.length > 0)
      list.push({ id: null, name: 'Current', sections: schedule.sections, createdAt: null });
    for (const sc of scenarios)
      list.push({ id: sc.id, name: sc.name, sections: sc.snapshot.sections, createdAt: sc.createdAt });
    return list.map((r) => ({ ...r, m: scenarioMetrics(r.sections, allRatings, buildings, walkSpeed) }));
  }, [schedule, scenarios, allRatings, buildings, walkSpeed]);

  const save = () => {
    if (!schedule || schedule.sections.length === 0) return;
    void sendToBackground({ kind: 'SCENARIO_SAVE', name: name.trim() || `Plan ${scenarios.length + 1}`, snapshot: schedule })
      .then(() => setName(''))
      .catch(() => {});
  };

  return (
    <div class="wdc-plans">
      <div class="wdc-plans-save">
        <input
          placeholder={`Name this plan, e.g. "Plan A"`}
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <button
          class="wdc-capture-btn wdc-map-btn"
          disabled={!schedule || schedule.sections.length === 0}
          onClick={save}
          title="Save the current schedule as a plan you can come back to"
        >
          💾 Save current
        </button>
      </div>
      {rows.length === 0 ? (
        <div class="wdc-empty">Nothing to compare yet — build a schedule, then save it here.</div>
      ) : (
        <table class="wdc-plans-table">
          <thead>
            <tr>
              <th>Plan</th>
              <th title="Sections">#</th>
              <th title="Total credits (unknown credits count 0)">Cr</th>
              <th title="Average professor rating">★</th>
              <th title="Earliest class start">Earliest</th>
              <th title="Total walking per week (needs located buildings)">Walk/wk</th>
              <th title="Legs at risk of being late">⚠</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr class={r.id === null ? 'wdc-plans-current' : ''}>
                <td class="wdc-plans-name" title={r.createdAt ? new Date(r.createdAt).toLocaleString() : 'live schedule'}>
                  {r.name}
                </td>
                <td>{r.m.sections}</td>
                <td>{r.m.credits || '—'}</td>
                <td>
                  {r.m.avgRating != null ? (
                    <b class={`wdc-rate-${ratingClass(r.m.avgRating)}`}>{r.m.avgRating.toFixed(1)}</b>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{r.m.earliest ?? '—'}</td>
                <td>{r.m.walkMinPerWeek != null ? `~${Math.round(r.m.walkMinPerWeek)} min` : '—'}</td>
                <td>{r.m.riskyLegs > 0 ? `⚠${r.m.riskyLegs}` : '·'}</td>
                <td class="wdc-plans-actions">
                  {r.id !== null && (
                    <>
                      <button
                        class="wdc-link-btn"
                        title="Load this plan into the calendar (current unsaved work is auto-stashed)"
                        onClick={() => void sendToBackground({ kind: 'SCENARIO_LOAD', id: r.id! }).catch(() => {})}
                      >
                        load
                      </button>{' '}
                      <button
                        class="wdc-edit-del"
                        title="Delete this plan"
                        onClick={() => void sendToBackground({ kind: 'SCENARIO_DELETE', id: r.id! }).catch(() => {})}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div class="wdc-map-note wdc-map-fine">
        Ratings/walk columns use the same data as the calendar — locate buildings in 🗺 Route for
        walk numbers. Loading a plan replaces the calendar; unsaved work is stashed automatically.
      </div>
    </div>
  );
}

/**
 * Build tab: generate conflict-free schedules from ⭐ candidate sections
 * (one per course, on top of the current schedule), ranked by preference
 * weights — mornings, compactness, professor ratings, walking. All local
 * math, no AI.
 */
function BuilderView({
  schedule,
  ratings,
  campusMap,
  walkSpeed,
  onPreview,
}: {
  schedule: ScheduleSnapshot | null;
  ratings: Map<string, number | null>;
  campusMap: CampusMap | null;
  walkSpeed: number;
  onPreview: (label: string, sections: Section[]) => void;
}) {
  const [candidates, setCandidates] = useState<Section[]>([]);
  const [prefs, setPrefs] = useState<BuilderPrefs>(DEFAULT_PREFS);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [extraRatings, setExtraRatings] = useState<Map<string, number | null>>(new Map());
  const [addCode, setAddCode] = useState('');
  const [addTime, setAddTime] = useState('');
  const [addErr, setAddErr] = useState<string | null>(null);

  useEffect(() => {
    void getStored('builderCandidates').then(setCandidates);
    void getStored('settings').then((s) => s.builderPrefs && setPrefs({ ...DEFAULT_PREFS, ...s.builderPrefs }));
    return onStoredChange('builderCandidates', setCandidates);
  }, []);

  // Ratings for candidate professors the current schedule doesn't cover.
  useEffect(() => {
    const names = [
      ...new Set(candidates.map((c) => c.instructor).filter((n): n is string => !!n && !ratings.has(n))),
    ];
    if (names.length === 0) return;
    let cancelled = false;
    void (async () => {
      const next = new Map<string, number | null>();
      for (const n of names) {
        try {
          const res = await sendToBackground<RmpLookupResult>({ kind: 'RMP_LOOKUP', instructorName: n });
          next.set(n, res.entry?.teacher?.avgRating ?? null);
        } catch {
          next.set(n, null);
        }
      }
      if (!cancelled) setExtraRatings(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [candidates.map((c) => c.instructor).join('|')]);

  const allRatings = useMemo(() => {
    const merged = new Map(ratings);
    for (const [k, v] of extraRatings) if (!merged.has(k)) merged.set(k, v);
    return merged;
  }, [ratings, extraRatings]);

  const groups = useMemo(() => {
    const m = new Map<string, Section[]>();
    for (const c of candidates) {
      const g = m.get(c.courseCode);
      if (g) g.push(c);
      else m.set(c.courseCode, [c]);
    }
    return [...m.entries()];
  }, [candidates]);

  const setPref = (key: keyof BuilderPrefs, value: number) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    void sendToBackground({ kind: 'SETTINGS_UPDATE', patch: { builderPrefs: next } }).catch(() => {});
  };

  const generate = () => {
    setResult(
      generateSchedules(schedule?.sections ?? [], candidates, prefs, {
        ratings: allRatings,
        buildings: campusMap?.buildings ?? {},
        walkSpeedKmh: walkSpeed,
      }),
    );
  };

  const addManual = () => {
    const code = addCode.trim().replace(/\s+/g, ' ');
    if (!code) {
      setAddErr('Enter a course code.');
      return;
    }
    const meetings = parseMeetingPatterns(addTime);
    if (meetings.length === 0) {
      setAddErr('Couldn\'t read the time. Try like "TTh 1:00 PM - 2:15 PM".');
      return;
    }
    setAddErr(null);
    void sendToBackground({
      kind: 'CANDIDATE_ADD',
      section: {
        sectionId: `cand:${code}:${Date.now()}`,
        courseCode: code,
        title: code,
        credits: null,
        instructor: null,
        meetings,
      },
    }).catch(() => {});
    setAddCode('');
    setAddTime('');
  };

  const meetingSummary = (s: Section) =>
    s.meetings
      .map((m) => `${dayMaskToLabels(m.days).join(' ')} ${formatMinutes(m.startMin)}`)
      .join(', ');

  const saveScenario = (label: string, secs: Section[]) => {
    void sendToBackground({
      kind: 'SCENARIO_SAVE',
      name: label,
      snapshot: {
        termLabel: schedule?.termLabel ?? null,
        sections: secs,
        capturedAt: Date.now(),
        source: 'dom',
      },
    }).catch(() => {});
  };

  const useAsSchedule = (secs: Section[]) => {
    void sendToBackground({
      kind: 'SCHEDULE_SET',
      snapshot: {
        termLabel: schedule?.termLabel ?? null,
        sections: secs,
        capturedAt: Date.now(),
        source: 'dom',
      },
    }).catch(() => {});
  };

  const PREF_ROWS: Array<{ key: keyof BuilderPrefs; label: string }> = [
    { key: 'morning', label: '🌅 Avoid early mornings' },
    { key: 'compact', label: '⏳ Compact days' },
    { key: 'ratings', label: '★ Professor ratings' },
    { key: 'walking', label: '🚶 Less walking' },
  ];

  return (
    <div class="wdc-build">
      {groups.length === 0 ? (
        <div class="wdc-empty">
          No candidate sections yet. On <b>Find Course Sections</b>, click <b>☆ candidate</b> on
          each section you're considering (several per course is the point) — or add one below.
        </div>
      ) : (
        <div class="wdc-build-cands">
          {groups.map(([code, secs]) => (
            <div class="wdc-build-course">
              <b>{code}</b> <span class="wdc-build-pick">pick 1 of {secs.length}</span>
              {secs.map((s) => (
                <div class="wdc-build-sec">
                  <span>
                    {meetingSummary(s)}
                    {s.instructor && (
                      <>
                        {' '}
                        · {displayInstructorName(s.instructor)}
                        {allRatings.get(s.instructor) != null && (
                          <b class={`wdc-rate-${ratingClass(allRatings.get(s.instructor))}`}>
                            {' '}★{allRatings.get(s.instructor)!.toFixed(1)}
                          </b>
                        )}
                      </>
                    )}
                  </span>
                  <button
                    class="wdc-edit-del"
                    title="Remove candidate"
                    onClick={() => void sendToBackground({ kind: 'CANDIDATE_REMOVE', sectionId: s.sectionId }).catch(() => {})}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div class="wdc-build-add">
        <input
          placeholder="Course code"
          value={addCode}
          onInput={(e) => setAddCode((e.target as HTMLInputElement).value)}
        />
        <input
          placeholder="Time, e.g. TTh 1:00 PM - 2:15 PM"
          value={addTime}
          onInput={(e) => setAddTime((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && addManual()}
        />
        <button class="wdc-capture-btn wdc-map-btn" onClick={addManual}>
          ＋ candidate
        </button>
      </div>
      {addErr && <div class="wdc-edit-error">{addErr}</div>}

      <div class="wdc-build-prefs">
        {PREF_ROWS.map((p) => (
          <label>
            <span>{p.label}</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.5}
              value={(prefs[p.key] as number | undefined) ?? 1}
              onChange={(e) => setPref(p.key, Number((e.target as HTMLInputElement).value))}
            />
          </label>
        ))}
        <label>
          <span>🌅 OK from</span>
          <select
            value={prefs.earliestOk ?? 540}
            onChange={(e) => setPref('earliestOk', Number((e.target as HTMLSelectElement).value))}
          >
            <option value={480}>8 AM</option>
            <option value={540}>9 AM</option>
            <option value={600}>10 AM</option>
            <option value={660}>11 AM</option>
          </select>
        </label>
      </div>

      <button class="wdc-capture-btn" disabled={groups.length === 0} onClick={generate}>
        🧩 Generate schedules
      </button>

      {result && (
        <div class="wdc-build-results">
          {result.skippedLocked.length > 0 && (
            <div class="wdc-map-note">
              Already on your schedule (skipped): {result.skippedLocked.join(', ')}
            </div>
          )}
          {result.results.length === 0 ? (
            <div class="wdc-empty">
              No conflict-free combination found — every mix of these sections clashes (or clashes
              with your current schedule). Try adding more section options per course.
            </div>
          ) : (
            result.results.map((r, i) => (
              <div class="wdc-build-card">
                <div class="wdc-build-card-head">
                  <b>#{i + 1}</b>
                  <span class="wdc-build-chosen">
                    {r.chosen.map((s) => `${s.courseCode} (${meetingSummary(s)})`).join(' · ')}
                  </span>
                </div>
                <div class="wdc-build-parts">
                  {r.parts.earlyMin > 0 ? `🌅 ${r.parts.earlyMin} early min` : '🌅 none'} · ⏳{' '}
                  {r.parts.gapMin} gap min
                  {r.parts.avgRating != null && <> · ★{r.parts.avgRating.toFixed(1)} avg</>}
                  {r.parts.walkMin != null && <> · 🚶 ~{Math.round(r.parts.walkMin)} min/wk</>}
                </div>
                <div class="wdc-build-actions">
                  <button class="wdc-link-btn" onClick={() => onPreview(`build #${i + 1}`, r.sections)}>
                    👁 preview
                  </button>
                  <button class="wdc-link-btn" onClick={() => saveScenario(`Build #${i + 1}`, r.sections)}>
                    💾 save as plan
                  </button>
                  <button class="wdc-link-btn" onClick={() => useAsSchedule(r.sections)}>
                    ✅ use as schedule
                  </button>
                </div>
              </div>
            ))
          )}
          {result.truncated && (
            <div class="wdc-map-note">
              Too many combinations to try them all — showing the best of the first 5,000.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
