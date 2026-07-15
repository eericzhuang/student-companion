/** Shared reactive state between the content bootstrap and the capture widget. */
import { signal } from '@preact/signals';
import type { WorkdayPage } from '../pageDetect';

/** Which Workday page the content script currently thinks we're on. */
export const currentPageSignal = signal<WorkdayPage>('unknown');

/**
 * Calendar visibility preference:
 *  - 'auto'   : show on schedule-related pages only (default)
 *  - 'shown'  : force-show on any page
 *  - 'hidden' : force-hide even on pages that would otherwise show it
 */
export type CalendarPref = 'auto' | 'shown' | 'hidden';
export const calendarPref = signal<CalendarPref>('auto');

/** Pages where the calendar shows automatically under 'auto'. */
export function isSchedulePage(page: WorkdayPage): boolean {
  return page === 'find-course-sections' || page === 'saved-schedule' || page === 'view-courses';
}

/** Effective visibility given the pref, page, and the master enable flag. */
export function calendarShouldShow(page: WorkdayPage, calendarEnabled: boolean): boolean {
  if (!calendarEnabled) return false;
  const pref = calendarPref.value;
  if (pref === 'hidden') return false;
  return pref === 'shown' || isSchedulePage(page);
}

/** When true, show the "all professors on this page" RMP panel. */
export const rmpPanelSignal = signal(false);

/** Transient toast message shown by the capture widget after an action. */
export const captureToast = signal<string | null>(null);

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showCaptureToast(message: string): void {
  captureToast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (captureToast.value = null), 4000);
}
