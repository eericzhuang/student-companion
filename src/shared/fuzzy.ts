/** Name normalization and fuzzy matching for instructor -> RMP teacher lookup. */

/** Lowercase, strip accents/punctuation, collapse whitespace. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s,-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cache/override key for an instructor name. */
export function nameKey(name: string): string {
  const { first, last } = splitName(name);
  return `${first}|${last}`;
}

/** Handle "Last, First Middle" and "First Middle Last". */
export function splitName(raw: string): { first: string; last: string; middle: string[] } {
  const norm = normalizeName(raw);
  if (norm.includes(',')) {
    const [last = '', rest = ''] = norm.split(',', 2).map((s) => s.trim());
    const parts = rest.split(' ').filter(Boolean);
    return { first: parts[0] ?? '', middle: parts.slice(1), last };
  }
  const parts = norm.split(' ').filter(Boolean);
  if (parts.length === 1) return { first: '', middle: [], last: parts[0] ?? '' };
  return {
    first: parts[0] ?? '',
    middle: parts.slice(1, -1),
    last: parts[parts.length - 1] ?? '',
  };
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[n]!;
}

/** Similarity in [0,1] tolerant of typos/diacritics. */
function stringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

/**
 * Score how well an RMP candidate matches a Workday instructor name.
 * Returns [0,1]; >= 0.85 is treated as confident.
 * Last name dominates; first name may be an initial in either source.
 */
export function scoreNameMatch(
  instructor: { first: string; last: string },
  candidate: { first: string; last: string },
): number {
  const lastScore = stringSimilarity(instructor.last, candidate.last);
  if (lastScore < 0.7) return lastScore * 0.5;

  let firstScore: number;
  const iFirst = instructor.first;
  const cFirst = candidate.first;
  if (!iFirst || !cFirst) {
    firstScore = 0.5; // missing first name: neutral
  } else if (iFirst.length === 1 || cFirst.length === 1) {
    firstScore = iFirst[0] === cFirst[0] ? 0.9 : 0;
  } else if (iFirst === cFirst) {
    firstScore = 1;
  } else if (iFirst.startsWith(cFirst) || cFirst.startsWith(iFirst)) {
    firstScore = 0.85; // nickname/shortened form
  } else {
    firstScore = stringSimilarity(iFirst, cFirst);
  }

  return lastScore * 0.6 + firstScore * 0.4;
}

export const CONFIDENT_MATCH = 0.85;
export const PLAUSIBLE_MATCH = 0.6;
