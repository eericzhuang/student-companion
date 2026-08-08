/**
 * Canvas LMS helpers: domain validation, URL builders, and matching a Workday
 * course code ("CS 2110") against the messy course codes Canvas returns
 * ("2026SP-CS-2110-LEC001"). Pure functions — the fetch lives in the
 * background worker.
 */
import type { CanvasCourse } from './types';

/**
 * Turn whatever the user pastes ("https://canvas.cornell.edu/courses", with
 * spaces, etc.) into a bare hostname, or null when it isn't one.
 */
export function normalizeCanvasDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0]!;
  // hostname with at least one dot; letters/digits/hyphens per label
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(s)) return null;
  return s;
}

export function canvasCoursesUrl(domain: string): string {
  return `https://${domain}/courses`;
}

export function canvasCourseUrl(domain: string, courseId: number): string {
  return `https://${domain}/courses/${courseId}`;
}

/** The user's own active courses; 100 per page covers any real course load. */
export function canvasApiCoursesUrl(domain: string): string {
  return `https://${domain}/api/v1/courses?enrollment_state=active&per_page=100`;
}

/**
 * Find the Canvas course for a Workday course code. Canvas codes bury the
 * subject + number in term/section junk ("2026SP-CS-2110-LEC001"), so we look
 * for subject + number with any separators between them — but bounded, so
 * "CS 211" never matches CS 2110 and "CS" never matches inside "PHYSICS".
 */
export function matchCanvasCourse(courseCode: string, courses: CanvasCourse[]): CanvasCourse | null {
  const m = courseCode.toUpperCase().match(/([A-Z]{2,6})\s*-?\s*(\d{3,5}[A-Z]?)/);
  if (!m) return null;
  const re = new RegExp(`(?<![A-Z])${m[1]}[^A-Z0-9]*${m[2]}(?![0-9])`, 'i');
  return courses.find((c) => re.test(c.code)) ?? courses.find((c) => re.test(c.name)) ?? null;
}
