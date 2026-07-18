/**
 * Whole-UI level theming for the injected panels (calendar, capture widget,
 * RMP). Computes the student's level from stored data — same engine as the
 * planner — and paints each shadow root with that rank's accent color via
 * --wdc-accent. Level 1 sets nothing, so each panel keeps its own identity
 * color until the student levels up. The owner's pinned theme (admin) wins.
 */
import { getAllStored, onStoredChange } from '../../shared/storage';
import {
  buildCourseStates,
  evaluateDegree,
  scopeReqOverrides,
} from '../../planner/engine/requirements';
import { computeLevel, effectiveThemeLevel, RANKS } from '../../planner/engine/levels';
import { isDark } from '../../shared/appearance';

const roots = new Set<HTMLElement>();
let accent: string | null = null;
let dark = false;
let started = false;
const mql = window.matchMedia('(prefers-color-scheme: dark)');

function paint(el: HTMLElement): void {
  if (accent) el.style.setProperty('--wdc-accent', accent);
  else el.style.removeProperty('--wdc-accent');
  el.classList.toggle('wdc-dark', dark);
}

async function recompute(): Promise<void> {
  const store = await getAllStored();
  const degrees = Object.values(store.degrees).filter((d) =>
    store.plannerState.includedDegreeIds.length === 0
      ? true
      : store.plannerState.includedDegreeIds.includes(d.id),
  );
  let level = 1;
  if (degrees.length > 0) {
    const states = buildCourseStates(
      store.academicHistory?.courses ?? [],
      store.schedule?.sections.map((s) => s.courseCode) ?? [],
      Object.keys(store.plannerState.assignments),
    );
    const evaluations = degrees.map((d) =>
      evaluateDegree(d, states, store.courseEquivalents, scopeReqOverrides(store.reqOverrides, d.id)),
    );
    level = computeLevel(evaluations, states).level;
  }
  level = effectiveThemeLevel(level, store.settings);
  accent = level > 1 ? RANKS[level - 1]!.accent : null;
  dark = isDark(store.settings.appearance, mql.matches);
  for (const el of roots) paint(el);
}

/** Register a shadow-root container to be painted with the level theme. */
export function themeRoot(el: HTMLElement): void {
  roots.add(el);
  paint(el);
  if (!started) {
    started = true;
    void recompute();
    mql.addEventListener('change', () => void recompute());
    for (const key of [
      'degrees',
      'academicHistory',
      'schedule',
      'plannerState',
      'settings',
      'reqOverrides',
      'courseEquivalents',
    ] as const) {
      onStoredChange(key, () => void recompute());
    }
  }
}
