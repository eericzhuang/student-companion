/**
 * Instructor-name -> RMP teacher resolution: override map, 7-day cache,
 * fuzzy-matched search, and a small concurrency-limited queue so a page of 50
 * sections doesn't burst RMP with 50 parallel requests.
 */
import type { RmpCacheEntry } from '../../shared/types';
import { getStored, updateStored } from '../../shared/storage';
import {
  CONFIDENT_MATCH,
  PLAUSIBLE_MATCH,
  nameKey,
  scoreNameMatch,
  splitName,
} from '../../shared/fuzzy';
import { fetchTeacher, searchTeachers } from './client';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CONCURRENT = 2;

let active = 0;
const waiters: Array<() => void> = [];
const inFlight = new Map<string, Promise<RmpCacheEntry | null>>();

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}

export function cacheKey(instructorName: string): string {
  return nameKey(instructorName);
}

export async function lookupInstructor(
  instructorName: string,
): Promise<{ entry: RmpCacheEntry | null; needsSetup: boolean }> {
  const settings = await getStored('settings');
  const school = settings.rmpSchool;
  if (!school) return { entry: null, needsSetup: true };

  const key = cacheKey(instructorName);

  // Manual override wins
  const overrides = await getStored('rmpOverrides');
  const overrideId = overrides[key];

  const cache = await getStored('rmpCache');
  const cached = cache[key];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    if (!overrideId || cached.teacher?.teacherId === overrideId) {
      return { entry: cached, needsSetup: false };
    }
  }

  const existing = inFlight.get(key);
  if (existing) return { entry: await existing, needsSetup: false };

  const promise = withSlot(() => resolve(instructorName, key, school.id, overrideId));
  inFlight.set(key, promise);
  try {
    return { entry: await promise, needsSetup: false };
  } finally {
    inFlight.delete(key);
  }
}

async function resolve(
  instructorName: string,
  key: string,
  schoolId: string,
  overrideId: string | undefined,
): Promise<RmpCacheEntry | null> {
  try {
    let entry: RmpCacheEntry;
    if (overrideId) {
      const teacher = await fetchTeacher(overrideId);
      entry = { teacher, candidates: [], uncertain: false, fetchedAt: Date.now() };
    } else {
      const parts = splitName(instructorName);
      const searchText = [parts.first, parts.last].filter(Boolean).join(' ');
      const candidates = await searchTeachers(searchText || instructorName, schoolId);

      const scored = candidates
        .map((c) => ({
          c,
          score: scoreNameMatch(parts, {
            first: c.firstName.toLowerCase(),
            last: c.lastName.toLowerCase(),
          }),
        }))
        .sort((a, b) => b.score - a.score);

      const best = scored[0];
      if (!best || best.score < PLAUSIBLE_MATCH) {
        entry = { teacher: null, candidates: [], uncertain: false, fetchedAt: Date.now() };
      } else {
        const second = scored[1];
        const uncertain =
          best.score < CONFIDENT_MATCH ||
          (second !== undefined && best.score - second.score < 0.05 && second.score >= PLAUSIBLE_MATCH);
        const teacher = await fetchTeacher(best.c.id);
        entry = {
          teacher,
          candidates: scored
            .filter((s) => s.score >= PLAUSIBLE_MATCH)
            .slice(0, 5)
            .map((s) => ({
              teacherId: s.c.id,
              firstName: s.c.firstName,
              lastName: s.c.lastName,
              department: s.c.department,
              avgRating: s.c.avgRating,
              numRatings: s.c.numRatings,
            })),
          uncertain,
          fetchedAt: Date.now(),
        };
      }
    }
    await updateStored('rmpCache', (cache) => ({ ...cache, [key]: entry }));
    return entry;
  } catch (err) {
    console.warn('[wd-companion] RMP lookup failed for', instructorName, err);
    return null; // transient failure: do not cache, badge degrades gracefully
  }
}

export async function setOverride(instructorName: string, teacherId: string): Promise<RmpCacheEntry | null> {
  const key = cacheKey(instructorName);
  await updateStored('rmpOverrides', (o) => ({ ...o, [key]: teacherId }));
  const teacher = await fetchTeacher(teacherId);
  const entry: RmpCacheEntry = { teacher, candidates: [], uncertain: false, fetchedAt: Date.now() };
  await updateStored('rmpCache', (cache) => ({ ...cache, [key]: entry }));
  return entry;
}

/** Purge expired cache entries (run from a chrome.alarms sweep). */
export async function sweepCache(): Promise<void> {
  const now = Date.now();
  await updateStored('rmpCache', (cache) => {
    const next: typeof cache = {};
    for (const [k, v] of Object.entries(cache)) {
      if (now - v.fetchedAt < CACHE_TTL_MS) next[k] = v;
    }
    return next;
  });
}
