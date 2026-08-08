/**
 * Canvas course links. When the user has configured their school's Canvas host
 * (and granted that host), we fetch THEIR course list from Canvas's own API —
 * the request rides the user's existing Canvas login session, is read-only,
 * and only id/code/name are cached. A course-code match deep-links the event
 * popup straight to the course; anything else falls back to the course list.
 */
import { getAllStored, setStored } from '../shared/storage';
import {
  canvasApiCoursesUrl,
  canvasCourseUrl,
  canvasCoursesUrl,
  matchCanvasCourse,
  normalizeCanvasDomain,
} from '../shared/canvas';
import type { CanvasCourse, CanvasCourseCache } from '../shared/types';
import type { CanvasLookupResult } from './messages';

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // course list barely changes mid-term

async function fetchCourseList(domain: string): Promise<CanvasCourse[] | null> {
  const granted = await chrome.permissions.contains({ origins: [`https://${domain}/*`] });
  if (!granted) return null;
  try {
    const res = await fetch(canvasApiCoursesUrl(domain), { credentials: 'include' });
    if (!res.ok) return null; // 401 = not logged into Canvas right now
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return null;
    const courses: CanvasCourse[] = [];
    for (const c of body as Array<Record<string, unknown>>) {
      if (typeof c?.id !== 'number') continue;
      courses.push({
        id: c.id,
        code: typeof c.course_code === 'string' ? c.course_code : '',
        name: typeof c.name === 'string' ? c.name : '',
      });
    }
    return courses;
  } catch {
    return null;
  }
}

export async function canvasLookup(courseCode: string): Promise<CanvasLookupResult> {
  const { settings, canvasCourses } = await getAllStored();
  const domain = normalizeCanvasDomain(settings.canvasDomain);
  if (!domain) return { url: null, matched: false, needsSetup: true };

  let cache: CanvasCourseCache | null = canvasCourses;
  if (!cache || cache.domain !== domain || Date.now() - cache.fetchedAt > CACHE_TTL_MS) {
    const courses = await fetchCourseList(domain);
    if (courses && courses.length > 0) {
      cache = { domain, courses, fetchedAt: Date.now() };
      await setStored('canvasCourses', cache);
    } else if (!cache || cache.domain !== domain) {
      // No usable list (never granted, logged out, or API blocked): still give
      // the user their Canvas course list to click through.
      return {
        url: canvasCoursesUrl(domain),
        matched: false,
        needsSetup: false,
        note: 'course match unavailable — open Canvas and sign in, then try again',
      };
    }
    // else: keep serving the stale same-domain cache
  }
  if (!cache) return { url: canvasCoursesUrl(domain), matched: false, needsSetup: false };

  const hit = matchCanvasCourse(courseCode, cache.courses);
  return hit
    ? { url: canvasCourseUrl(domain, hit.id), matched: true, needsSetup: false }
    : { url: canvasCoursesUrl(domain), matched: false, needsSetup: false };
}
