/**
 * Detect which Workday student page the SPA is currently showing.
 * Combines URL heuristics with page-title probes, since Workday's SPA routes
 * are tenant-specific and titles are localized per school deployment.
 */
import { queryFirst, textOf } from './scrapers/selectors';

export type WorkdayPage =
  | 'find-course-sections'
  | 'saved-schedule'
  | 'academic-history'
  | 'view-courses'
  | 'unknown';

const TITLE_PATTERNS: Array<[RegExp, WorkdayPage]> = [
  [/find course sections/i, 'find-course-sections'],
  [/saved schedule/i, 'saved-schedule'],
  [/view my saved schedules?/i, 'saved-schedule'],
  [/academic (history|record|progress)/i, 'academic-history'],
  [/view my academic/i, 'academic-history'],
  [/unofficial transcript/i, 'academic-history'],
  [/view my courses/i, 'view-courses'],
  [/current classes/i, 'view-courses'],
];

const URL_PATTERNS: Array<[RegExp, WorkdayPage]> = [
  [/find.?course.?section/i, 'find-course-sections'],
  [/saved.?schedule/i, 'saved-schedule'],
  [/academic.?(history|record|progress)/i, 'academic-history'],
];

export function detectPage(): WorkdayPage {
  const url = window.location.href;
  for (const [re, page] of URL_PATTERNS) {
    if (re.test(url)) return page;
  }
  const title = textOf(queryFirst(document, 'pageTitle')) || document.title;
  for (const [re, page] of TITLE_PATTERNS) {
    if (re.test(title)) return page;
  }
  return 'unknown';
}
