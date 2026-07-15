/**
 * Isolated-world content script bootstrap for *.myworkday.com.
 * Wires: intercept bridge -> parsers -> background storage, plus the DOM
 * observers that drive the calendar panel and RMP badges.
 */
import { onIntercepted, startBridge } from './interceptorBridge';
import { extractHistoryCourses, extractSections } from './scrapers/workdayJson';
import { scrapeSavedSchedule } from './scrapers/savedSchedule';
import { scrapeAcademicHistory } from './scrapers/academicHistory';
import { scrapeResultRows, clearProcessedMarks } from './scrapers/findCourseSections';
import { detectPage, type WorkdayPage } from './pageDetect';
import { setSelectorOverrides } from './scrapers/selectors';
import { getStored, onStoredChange } from '../shared/storage';
import { sendToBackground } from '../background/messages';
import { mergeSections } from '../shared/schedule';
import { effect } from '@preact/signals';
import {
  ensureCaptureWidget,
  ensurePanel,
  ensureRmpPanel,
  removeCaptureWidget,
  removePanel,
  removeRmpPanel,
} from './ui/mountPanel';
import { calendarPref, calendarShouldShow, currentPageSignal, rmpPanelSignal } from './ui/captureState';
import { decorateRows, redecorateAll } from './ui/decorateRows';
import type { Section, Settings } from '../shared/types';

let settings: Settings;
let currentPage: WorkdayPage = 'unknown';

function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ---- intercepted JSON -> background ----

function handleIntercepted(url: string, json: unknown): void {
  // Saved-schedule payloads: sections with meeting patterns
  const sections = extractSections(json);
  const page = currentPage;
  if (sections.length > 0 && (page === 'saved-schedule' || page === 'view-courses')) {
    void sendToBackground({
      kind: 'SCHEDULE_CAPTURED',
      snapshot: {
        termLabel: null,
        sections,
        capturedAt: Date.now(),
        source: 'intercept',
      },
    }).catch(() => {});
  }
  if (page === 'academic-history') {
    const courses = extractHistoryCourses(json);
    if (courses.length > 0) {
      void sendToBackground({
        kind: 'HISTORY_CAPTURED',
        history: { courses, capturedAt: Date.now(), source: 'intercept' },
      }).catch(() => {});
    }
  }
}

// ---- DOM fallback + auto captures ----

let lastAutoSections: Section[] = [];

/**
 * Auto-capture on schedule pages: re-scrape and MERGE into stored schedule so
 * the calendar refreshes automatically right after you add a course (no manual
 * capture needed). Only writes when the merged set actually changed.
 */
function autoCaptureSchedule(): void {
  const snapshot = scrapeSavedSchedule(document);
  if (!snapshot || snapshot.sections.length === 0) return;
  const merged = mergeSections(lastAutoSections, snapshot.sections);
  if (merged.length === lastAutoSections.length && lastAutoSections.length > 0) return;
  lastAutoSections = merged;
  void getStored('schedule').then((current) => {
    const combined = mergeSections(current?.sections ?? [], snapshot.sections);
    if (current && combined.length === current.sections.length) return;
    void sendToBackground({
      kind: 'SCHEDULE_SET',
      snapshot: { ...snapshot, sections: combined, source: 'dom' },
    }).catch(() => {});
  });
}

function domCapture(): void {
  if (currentPage === 'saved-schedule' || currentPage === 'view-courses') {
    autoCaptureSchedule();
  } else if (currentPage === 'academic-history') {
    const history = scrapeAcademicHistory(document);
    if (history) {
      void sendToBackground({ kind: 'HISTORY_CAPTURED', history }).catch(() => {});
    }
  }
}

// ---- page routing ----

async function onPageSettled(): Promise<void> {
  const detected = detectPage();
  if (detected !== currentPage) {
    currentPage = detected;
    currentPageSignal.value = detected;
    clearProcessedMarks(document);
  }

  // Capture widget persists across pages; it adapts to the current page signal.
  if (settings.captureWidgetEnabled) ensureCaptureWidget();
  else removeCaptureWidget();

  // Calendar visibility honors the user's explicit show/hide preference.
  if (calendarShouldShow(currentPage, settings.calendarEnabled)) await ensurePanel();
  else removePanel();

  if (currentPage === 'find-course-sections') {
    // A course added to the saved schedule while searching should show up live.
    autoCaptureSchedule();
    const rows = scrapeResultRows(document);
    if (rows.length > 0) await decorateRows(rows, settings);
  } else {
    domCapture();
  }
}

const settle = debounce(() => void onPageSettled(), 400);

async function main(): Promise<void> {
  settings = await getStored('settings');
  setSelectorOverrides(settings.selectorOverrides);
  onStoredChange('settings', (next) => {
    settings = next;
    setSelectorOverrides(next.selectorOverrides);
  });

  startBridge();
  onIntercepted(({ url, json }) => handleIntercepted(url, json));

  // Re-evaluate the panel when the user changes the calendar show/hide pref.
  let firstEffect = true;
  effect(() => {
    calendarPref.value; // subscribe
    if (firstEffect) {
      firstEffect = false;
      return;
    }
    void onPageSettled();
  });

  // Mount/unmount the "all professors" RMP panel on toggle.
  effect(() => {
    if (rmpPanelSignal.value) ensureRmpPanel();
    else removeRmpPanel();
  });

  // Schedule changes (e.g. user adds a course) -> re-evaluate conflict badges
  onStoredChange('schedule', () => {
    if (currentPage === 'find-course-sections') void redecorateAll(settings);
  });

  const observer = new MutationObserver(settle);
  const start = () => {
    observer.observe(document.body, { childList: true, subtree: true });
    settle();
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}

void main();
