/**
 * Build the public RateMyProfessors URL for a teacher. RMP GraphQL node ids
 * are base64 of "Teacher-<numericId>"; the site URL uses that numeric id.
 */
export function rmpProfessorUrl(teacherId: string): string | null {
  try {
    const decoded = atob(teacherId); // e.g. "Teacher-2109847"
    const m = decoded.match(/Teacher-(\d+)/);
    if (m) return `https://www.ratemyprofessors.com/professor/${m[1]}`;
  } catch {
    // not base64 — fall through
  }
  // Some ids are already numeric
  if (/^\d+$/.test(teacherId)) return `https://www.ratemyprofessors.com/professor/${teacherId}`;
  return null;
}

/** RMP-style color bucket for a rating (matches the badge thresholds). */
export function ratingClass(rating: number | null | undefined): 'good' | 'mid' | 'bad' | 'none' {
  if (rating == null) return 'none';
  if (rating >= 3.8) return 'good';
  if (rating >= 2.8) return 'mid';
  return 'bad';
}
